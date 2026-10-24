param([ValidateSet('Enable','Disable','Status','Verify')][string]$Mode = 'Status', [string]$Report)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'shared/i18n.ps1')
. (Join-Path $PSScriptRoot 'shared/administrator_launch.ps1')
. (Join-Path $PSScriptRoot 'shared/settings_store.ps1')
$spec = Get-BetterCodexAdministratorTaskSpec
$settingsPath = Join-Path $spec.workspace '.runtime/token-hud/embedded/settings.json'
$runtime = Join-Path $spec.workspace '.runtime/token-hud/embedded/runtime'

$existing = Get-BetterCodexAdministratorTask
$needsElevation = $Mode -eq 'Disable' -or ($Mode -eq 'Enable' -and (-not $existing -or $existing.State -eq 'Disabled'))
if ($needsElevation -and -not (Test-BetterCodexAdministrator)) {
    if (-not $Report) { $Report = Join-Path $runtime 'administrator-setup.json' }
    [IO.Directory]::CreateDirectory((Split-Path -Parent $Report)) | Out-Null
    if (Test-Path -LiteralPath $Report) { Remove-Item -LiteralPath $Report }
    $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Mode {1} -Report "{2}"' -f $PSCommandPath,$Mode,$Report
    $process = Start-Process -FilePath $spec.executable -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -Wait -PassThru
    if (Test-Path -LiteralPath $Report) { Get-Content -LiteralPath $Report -Raw -Encoding UTF8 }
    if ($process.ExitCode -ne 0) { throw (Get-BetterCodexText 'administrator.setupFailed') }
    return
}

$result = @{mode=$Mode;taskName=$spec.name;checkedAtUtc=[DateTime]::UtcNow.ToString('o');success=$false}
try {
    $task = Get-BetterCodexAdministratorTask
    if ($Mode -eq 'Enable') {
        if (-not $task) {
            $action = New-ScheduledTaskAction -Execute $spec.executable -Argument $spec.arguments -WorkingDirectory $spec.workspace
            $principal = New-ScheduledTaskPrincipal -UserId $spec.user -LogonType Interactive -RunLevel Highest
            # Desktop and supervisor children may outlive the launcher. Never time
            # out their task; the launcher's mutex serializes concurrent clicks.
            $options = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances Parallel -ExecutionTimeLimit ([TimeSpan]::Zero)
            Register-ScheduledTask -TaskName $spec.name -TaskPath '\' -Action $action -Principal $principal -Settings $options -Description $spec.description -Force | Out-Null
        } elseif ($task.State -eq 'Disabled') {
            Enable-ScheduledTask -TaskName $spec.name -TaskPath '\' | Out-Null
        }
        $task = Get-BetterCodexAdministratorTask
        Update-BetterCodexSettings $settingsPath @{runAsAdministrator=$true}
    } elseif ($Mode -eq 'Disable') {
        Update-BetterCodexSettings $settingsPath @{runAsAdministrator=$false}
        if ($task) { Unregister-ScheduledTask -TaskName $spec.name -TaskPath '\' -Confirm:$false }
        $task = $null
    } elseif ($Mode -eq 'Verify') {
        $probe = Join-Path $runtime 'administrator-check.json'
        $requested = [DateTime]::UtcNow
        $result.instance = Invoke-BetterCodexAdministratorTask 'Check'
        $deadline = $requested.AddSeconds(45)
        do {
            if (Test-Path -LiteralPath $probe) {
                $check = Get-Content -LiteralPath $probe -Raw -Encoding UTF8 | ConvertFrom-Json
                if ([DateTimeOffset]$check.checkedAtUtc -ge [DateTimeOffset]$requested) { break }
                $check = $null
            }
            Start-Sleep -Milliseconds 250
        } while ([DateTime]::UtcNow -lt $deadline)
        if (-not $check -or -not $check.launcherElevated -or $check.activationSucceeded) { throw (Get-BetterCodexText 'administrator.verifyFailed') }
        $result.check = $check
    }
    $settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($Mode -in @('Enable','Disable')) {
        $entryResult = & $settings.python -B -X utf8 (Join-Path $PSScriptRoot 'install_taskbar_entry.py')
        if ($LASTEXITCODE -ne 0) { throw (Get-BetterCodexText 'shortcut.identity') }
        $result.shortcuts = $entryResult | ConvertFrom-Json
    }
    $result.enabled = $settings.runAsAdministrator -eq $true
    $result.taskPresent = [bool]$task
    $result.success = $true
    $result.message = Get-BetterCodexText "administrator.$($Mode.ToLowerInvariant())"
} catch {
    $result.errorType = $_.Exception.GetType().Name
    $result.message = $_.Exception.Message
}
if ($Report) {
    [IO.Directory]::CreateDirectory((Split-Path -Parent $Report)) | Out-Null
    $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Report -Encoding UTF8
}
$result | ConvertTo-Json -Depth 8
if (-not $result.success) { exit 1 }
