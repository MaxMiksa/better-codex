function Test-BetterCodexAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-BetterCodexAdministratorTaskSpec {
    $workspace = $script:BetterCodexRoot
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    return @{
        name = "Better-Codex-Administrator-$sid"
        user = $sid
        executable = Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'
        arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -AdministratorTask -TaskMode "$(Arg0)"' -f (Join-Path $workspace 'tools/token-hud-local/Start-ComposerHud.ps1')
        workspace = $workspace
        description = "Better-Codex administrator launcher: $workspace"
    }
}

function Get-BetterCodexAdministratorTask {
    $spec = Get-BetterCodexAdministratorTaskSpec
    $task = Get-ScheduledTask -TaskName $spec.name -TaskPath '\' -ErrorAction SilentlyContinue
    if (-not $task) { return $null }
    $taskUser = $task.Principal.UserId
    if ($taskUser -notmatch '^S-1-') {
        $taskUser = ([Security.Principal.NTAccount]$taskUser).Translate([Security.Principal.SecurityIdentifier]).Value
    }
    if ($task.Description -ne $spec.description -or @($task.Actions).Count -ne 1 -or
        $task.Actions[0].Execute -ne $spec.executable -or $task.Actions[0].Arguments -ne $spec.arguments -or
        $task.Actions[0].WorkingDirectory -ne $spec.workspace -or $taskUser -ne $spec.user -or
        $task.Principal.RunLevel -ne 'Highest' -or $task.Principal.LogonType -ne 'Interactive' -or
        -not $task.Settings.AllowDemandStart -or $task.Settings.ExecutionTimeLimit -ne 'PT0S' -or
        $task.Settings.MultipleInstances -ne 'Parallel' -or
        @($task.Triggers | Where-Object { $_ }).Count -ne 0) {
        throw (Get-BetterCodexText 'administrator.taskMismatch')
    }
    return $task
}

function Invoke-BetterCodexAdministratorTask([ValidateSet('Launch','Check','Monitor','Reload')][string]$Mode = 'Launch') {
    $task = Get-BetterCodexAdministratorTask
    if (-not $task -or $task.State -eq 'Disabled') { throw (Get-BetterCodexText 'administrator.taskMissing') }
    $scheduler = New-Object -ComObject 'Schedule.Service'
    $scheduler.Connect()
    $registered = $scheduler.GetFolder('\').GetTask($task.TaskName)
    $running = $registered.Run($Mode)
    return $running.InstanceGuid
}

function Get-BetterCodexProcessElevation([int]$ProcessId) {
    if (-not ('BetterCodexProcessToken' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class BetterCodexProcessToken {
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int id);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr token, int kind, out int value, int length, out int returned);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    public static bool Elevated(int id) {
        IntPtr process = OpenProcess(0x1000, false, id), token = IntPtr.Zero;
        if (process == IntPtr.Zero) throw new Win32Exception();
        try {
            if (!OpenProcessToken(process, 8, out token)) throw new Win32Exception();
            int value, returned;
            if (!GetTokenInformation(token, 20, out value, 4, out returned)) throw new Win32Exception();
            return value != 0;
        } finally { if (token != IntPtr.Zero) CloseHandle(token); CloseHandle(process); }
    }
}
'@
    }
    try { return [BetterCodexProcessToken]::Elevated($ProcessId) } catch { return $null }
}

function Get-BetterCodexDesktopElevation($Desktops) {
    if (-not $Desktops.Count) { return }
    # Electron renderers may have restricted tokens even with an elevated main
    # process. Only the roots of the registered desktop process tree count.
    $ids = @($Desktops | Select-Object -ExpandProperty Id)
    Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe'" |
        Where-Object { $_.ProcessId -in $ids -and $_.ParentProcessId -notin $ids } |
        ForEach-Object { Get-BetterCodexProcessElevation $_.ProcessId }
}
