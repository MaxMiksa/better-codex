param([switch]$CheckOnly, [switch]$FunctionsOnly, [switch]$AdministratorTask, [switch]$RecoveryActivation, [switch]$StartupCheckStarted,
    [ValidateSet('Launch','Check','Monitor','Reload')][string]$TaskMode = 'Launch')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../platform/i18n/i18n.ps1')
. (Join-Path $PSScriptRoot '../lifecycle/startup/codex_activation.ps1')
. (Join-Path $PSScriptRoot '../lifecycle/startup/administrator_launch.ps1')
$promptMonitor = Join-Path $PSScriptRoot '../prompts/monitoring/Start-Monitor.ps1'
if (Test-Path -LiteralPath $promptMonitor) { . $promptMonitor }
else { function Start-InstructionReviewCheck { } }

function Start-ComposerStartupCheck {
    try {
        $dialog = Join-Path $PSScriptRoot '../lifecycle/diagnostics/Show-StartupCheck.ps1'
        if (-not (Test-Path -LiteralPath $dialog)) { return }
        $powershell = Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'
        $arguments = '-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $dialog
        Start-Process -FilePath $powershell -ArgumentList $arguments -WindowStyle Hidden | Out-Null
    } catch { } # An independent diagnostic window must never prevent activation.
}

function Invoke-ComposerRelaunch {
    $settingsPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../.runtime/token-hud/embedded/settings.json'))
    $settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($settings.runAsAdministrator -eq $true -and -not (Test-BetterCodexAdministrator)) {
        $null = Invoke-BetterCodexAdministratorTask -Mode Reload
    } else {
        & $settings.python -B -X utf8 (Join-Path $PSScriptRoot '../../tools/token-hud-local/diagnostics/relaunch.py') --settings $settingsPath --execute
        if ($LASTEXITCODE -ne 0) { throw (Get-BetterCodexText 'check.relaunchFailed') }
    }
}

function Get-ComposerLaunchPlan($Package, $Settings, $Desktops, $Listeners) {
    if ($Settings.port -lt 1024 -or $Settings.port -gt 65535) { throw (Get-BetterCodexText 'launch.invalidPort') }
    $verified = @($Desktops | Where-Object { $_.Path -eq $Package.executable })
    if ($verified.Count -ne $Desktops.Count) { return @{arguments='';reason='desktop-identity-unverified';attach=$false} }
    if ($Listeners.Count -and ($Listeners.Count -ne 1 -or $Listeners[0].LocalAddress -ne '127.0.0.1' -or
        $Listeners[0].OwningProcess -notin @($verified | Select-Object -ExpandProperty Id))) {
        return @{arguments='';reason='unverified-listener';attach=$false}
    }
    if ($Desktops.Count) {
        return @{arguments='';reason=$(if ($Listeners.Count) {'reuse-desktop'} else {'restart-required'});attach=[bool]$Listeners.Count}
    }
    return @{arguments="--remote-debugging-address=127.0.0.1 --remote-debugging-port=$($Settings.port)";reason='connecting';attach=$true}
}

function Start-ComposerSupervisor($Settings, [string]$SettingsPath, [string]$Runtime) {
    [IO.Directory]::CreateDirectory($Runtime) | Out-Null
    $pidPath = Join-Path $Runtime 'launcher.json'
    $alreadyRunning = $false
    if (Test-Path -LiteralPath $pidPath) {
        try {
            $previous = Get-Content -LiteralPath $pidPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $process = Get-Process -Id $previous.supervisorPid -ErrorAction SilentlyContinue
            # PowerShell 7 can deserialize ISO timestamps as DateTime, unlike 5.1.
            $alreadyRunning = $process -and $process.Path -eq $Settings.python -and
                $process.StartTime.ToUniversalTime() -eq ([DateTimeOffset]$previous.startedAt).UtcDateTime
        } catch { }
    }
    $stop = Join-Path $Runtime 'stop'
    if ($alreadyRunning -and (Test-Path -LiteralPath $stop)) {
        Wait-Process -Id $process.Id -Timeout 10 -ErrorAction Stop
        $alreadyRunning = $false
    }
    if (Test-Path -LiteralPath $stop) { Remove-Item -LiteralPath $stop }
    if (-not $alreadyRunning) {
        $arguments = '-X utf8 "{0}" --settings "{1}" --runtime "{2}"' -f (Join-Path $PSScriptRoot '../../tools/token-hud-local/embedded/supervisor.py'),$SettingsPath,$Runtime
        $env:BETTER_CODEX_LANGUAGE = $script:BetterCodexLanguage
        $process = Start-Process -FilePath $Settings.python -ArgumentList $arguments -WindowStyle Hidden -PassThru
        @{supervisorPid=$process.Id;startedAt=$process.StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $pidPath -Encoding utf8
    }
    return $process.Id
}

function Write-ComposerLaunchReceipt([string]$Runtime, $Receipt, [string]$Name = 'launch-receipt.json') {
    try {
        [IO.Directory]::CreateDirectory($Runtime) | Out-Null
        $target = Join-Path $Runtime $Name
        $temporary = "$target.next"
        [IO.File]::WriteAllText($temporary, ($Receipt | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $temporary -Destination $target -Force
    } catch { } # Reporting must not block official activation.
}

function Invoke-ComposerMonitor {
    if ($AdministratorTask -and -not (Test-BetterCodexAdministrator)) { throw (Get-BetterCodexText 'administrator.notElevated') }
    $settingsPath = Join-Path $script:BetterCodexRoot '.runtime/token-hud/embedded/settings.json'
    $runtime = Join-Path (Split-Path -Parent $settingsPath) 'runtime'
    $settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($settings.runAsAdministrator -eq $true -and -not (Test-BetterCodexAdministrator)) {
        return @{monitorRequest=(Invoke-BetterCodexAdministratorTask 'Monitor');activationSucceeded=$false}
    }
    if ($settings.recoverAfterUpdate -eq $true) {
        $supervisorPid = Start-ComposerSupervisor $settings $settingsPath $runtime
        if ($AdministratorTask) { Start-InstructionReviewCheck $settings $supervisorPid (Join-Path $runtime 'stop') }
        return @{supervisorPid=$supervisorPid;activationSucceeded=$false}
    }
    return @{activationSucceeded=$false}
}

function Invoke-ComposerLaunch([switch]$CheckOnly) {
    $workspace = $script:BetterCodexRoot
    $settingsPath = Join-Path $workspace '.runtime/token-hud/embedded/settings.json'
    $runtime = Join-Path (Split-Path -Parent $settingsPath) 'runtime'
    $plan = @{arguments='';reason='hud-preparation-failed';attach=$false}
    $package = $null
    $receipt = @{source='Start-ComposerHud.ps1';checkedAtUtc=[DateTime]::UtcNow.ToString('o');activationSucceeded=$false}
    $receipt.launcherElevated = Test-BetterCodexAdministrator
    $settings = $null
    try { $settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { }
    $receipt.administratorRequested = $settings.runAsAdministrator -eq $true -or [bool]$AdministratorTask
    if ($receipt.administratorRequested -and -not $receipt.launcherElevated -and -not $CheckOnly) {
        # Return normally even on dispatch failure: the legacy wrapper must not
        # silently fall back to launching an ordinary-permission Codex.
        try {
            if ($AdministratorTask) { throw (Get-BetterCodexText 'administrator.notElevated') }
            $receipt.administratorInstance = Invoke-BetterCodexAdministratorTask
            $receipt.administratorDispatched = $true
            $receipt.message = Get-BetterCodexText 'administrator.dispatched'
        } catch {
            $receipt.administratorDispatched = $false
            $receipt.errorType = $_.Exception.GetType().Name
            $receipt.message = $_.Exception.Message
            $popup = New-Object -ComObject WScript.Shell
            $popup.Popup($receipt.message, 0, 'Better-Codex', 16) | Out-Null
        }
        Write-ComposerLaunchReceipt $runtime $receipt 'administrator-request.json'
        return $receipt
    }
    try {
        foreach ($dependency in @($settings.python,$settings.node,(Join-Path $settings.playwright 'package.json'),(Join-Path $settings.collectorDir 'metrics.py'))) {
            if (-not $dependency -or -not (Test-Path -LiteralPath $dependency)) { throw (Get-BetterCodexText 'launch.dependencyMissing') }
        }
        $package = & $settings.python (Join-Path $PSScriptRoot '../../tools/token-hud-local/shared/desktop_package.py') | ConvertFrom-Json
        if ($LASTEXITCODE -ne 0 -or -not $package.executable) { throw (Get-BetterCodexText 'launch.packageFailed') }
        $desktops = @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue)
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $settings.port -ErrorAction SilentlyContinue)
        $plan = Get-ComposerLaunchPlan $package $settings $desktops $listeners
        if (($plan.attach -or $settings.recoverAfterUpdate -eq $true) -and -not $CheckOnly -and -not $RecoveryActivation) {
            $receipt.supervisorPid = Start-ComposerSupervisor $settings $settingsPath $runtime
        }
    } catch {
        $plan = @{arguments='';reason='hud-preparation-failed';attach=$false}
        $receipt.errorType = $_.Exception.GetType().Name
    }
    $receipt.hudReason = $plan.reason
    $receipt.packageVersion = $package.packageVersion
    $receipt.locale = $script:BetterCodexLanguage
    $desktops = @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue)
    try { $receipt.desktopElevated = @(Get-BetterCodexDesktopElevation $desktops) }
    catch { $receipt.desktopElevated = @($null) } # Diagnostics must not block activation.
    if ($receipt.administratorRequested) {
        $receipt.administratorState = if (-not $desktops.Count) { 'next-start' } elseif (-not $receipt.desktopElevated.Count -or $receipt.desktopElevated -contains $false -or $receipt.desktopElevated -contains $null) { 'restart-required' } else { 'active' }
    }
    if ($CheckOnly) { $receipt.message = Get-BetterCodexText 'launch.checked'; return $receipt }
    # Every normal click activates the app, including HUD failure and existing instances.
    try {
        if ($receipt.administratorRequested -and -not $desktops.Count) {
            $receipt.activationProcessId = Invoke-CodexAdministratorActivation $plan.arguments
            $receipt.administratorState = 'launched'
        } else {
            # Preserve existing sessions, even if they predate elevation or an update.
            $receipt.activationProcessId = Invoke-CodexActivation $plan.arguments
        }
        $receipt.activationSucceeded = $true
    } catch {
        $receipt.hudReason = 'activation-failed'
        $receipt.errorType = $_.Exception.GetType().Name
    }
    $receipt.message = Get-BetterCodexText "launch.$($receipt.hudReason)"
    Write-ComposerLaunchReceipt $runtime $receipt
    if ($receipt.activationSucceeded -and -not $RecoveryActivation) { Start-InstructionReviewCheck $settings $receipt.supervisorPid (Join-Path $runtime 'stop') }
    return $receipt
}

if (-not $FunctionsOnly) {
    if ($TaskMode -eq 'Reload') {
        Invoke-ComposerRelaunch
        return
    }
    if (-not $CheckOnly -and -not $AdministratorTask -and -not $RecoveryActivation -and
        -not $StartupCheckStarted -and $TaskMode -eq 'Launch') { Start-ComposerStartupCheck }
    if ($AdministratorTask -and $TaskMode -eq 'Check') {
        $result = Invoke-ComposerLaunch -CheckOnly
        $runtime = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../.runtime/token-hud/embedded/runtime'))
        Write-ComposerLaunchReceipt $runtime $result 'administrator-check.json'
        return
    }
    $mutex = [Threading.Mutex]::new($false, 'Local\CodexComposerHudLauncher')
    $held = $false
    try {
        try { $held = $mutex.WaitOne(15000) } catch [Threading.AbandonedMutexException] { $held = $true }
        if (-not $held) { @{hudReason='launch-already-in-progress';locale=$script:BetterCodexLanguage;message=(Get-BetterCodexText 'launch.launch-already-in-progress')} | ConvertTo-Json; return }
        if ($TaskMode -eq 'Monitor') {
            Invoke-ComposerMonitor | ConvertTo-Json
            return
        }
        $result = Invoke-ComposerLaunch -CheckOnly:$CheckOnly
        $result | ConvertTo-Json
        if (-not $CheckOnly -and -not $result.activationSucceeded -and ($AdministratorTask -or -not $result.administratorRequested)) { exit 1 }
    } finally {
        if ($held) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}
