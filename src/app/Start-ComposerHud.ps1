param([switch]$CheckOnly, [switch]$FunctionsOnly, [switch]$RecoveryActivation, [switch]$StartupCheckStarted, [string]$CorrelationId,
    [ValidateSet('Launch','Monitor','Reload')][string]$TaskMode = 'Launch')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../platform/i18n/i18n.ps1')
. (Join-Path $PSScriptRoot '../platform/settings/settings_store.ps1')
. (Join-Path $PSScriptRoot '../platform/settings/runtime_stamp.ps1')
. (Join-Path $PSScriptRoot '../lifecycle/startup/codex_activation.ps1')

function Start-ComposerStartupCheck {
    param([switch]$AfterUpdate)
    try {
        $dialog = Join-Path $PSScriptRoot '../lifecycle/diagnostics/Show-StartupCheck.ps1'
        if (-not (Test-Path -LiteralPath $dialog)) { return }
        $powershell = Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'
        $arguments = '-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $dialog
        if ($AfterUpdate) { $arguments += ' -AfterUpdate' }
        Start-Process -FilePath $powershell -ArgumentList $arguments -WindowStyle Hidden | Out-Null
    } catch { } # An independent diagnostic window must never prevent activation.
}

function Invoke-ComposerRelaunch {
    $settingsPath = Initialize-BetterCodexSettings
    $settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    & $settings.node --no-warnings=ExperimentalWarning (Join-Path $PSScriptRoot '../lifecycle/recovery/relaunch.cjs') --settings $settingsPath --execute
    if ($LASTEXITCODE -ne 0) { throw (Get-BetterCodexText 'check.relaunchFailed') }
}

function Get-ComposerLaunchPlan($Package, $Settings, $Desktops, $Listeners) {
    if ($Settings.port -lt 1024 -or $Settings.port -gt 65535) { throw (Get-BetterCodexText 'launch.invalidPort') }
    $verified = @($Desktops | Where-Object { $_.Path -eq $Package.executable })
    if ($verified.Count -ne $Desktops.Count) { return @{arguments='';reason='desktop-identity-unverified';attach=$false} }
    if ($Listeners.Count) {
        $listener = $Listeners[0]
        $owners = @($verified | Where-Object { $_.Id -eq $listener.OwningProcess -and $_.Created -eq $listener.Created })
        if ($Listeners.Count -ne 1 -or $listener.LocalAddress -ne '127.0.0.1' -or -not $listener.CurrentSession -or
            $listener.Executable -ne $Package.executable -or $listener.PackageFullName -ne $Package.packageFullName -or
            -not $listener.Created -or $owners.Count -ne 1) {
            return @{arguments='';reason='unverified-listener';attach=$false}
        }
    }
    if ($Desktops.Count) {
        return @{arguments='';reason=$(if ($Listeners.Count) {'reuse-desktop'} else {'restart-required'});attach=[bool]$Listeners.Count}
    }
    return @{arguments="--remote-debugging-address=127.0.0.1 --remote-debugging-port=$($Settings.port)";reason='connecting';attach=$true}
}

function Resolve-ComposerLaunchPlan($Package, $Settings, $Desktops, $Listeners, [string]$SettingsPath, [switch]$CheckOnly) {
    $plan = Get-ComposerLaunchPlan $Package $Settings $Desktops $Listeners
    if (-not $CheckOnly -and -not $Desktops.Count -and $plan.reason -eq 'unverified-listener') {
        # Bypass the occupied port; never contact or stop its unverified owner.
        $port = Get-CodexAvailableDisplayPort
        Update-BetterCodexSettings $SettingsPath @{port=$port} | Out-Null
        $previousPort = $Settings.port
        $Settings.port = $port
        $plan = Get-ComposerLaunchPlan $Package $Settings @() @()
        $plan.previousPort = $previousPort
    }
    return $plan
}

function Get-ComposerSupervisorStamp($Settings) {
    return Get-BetterCodexRuntimeStamp $Settings
}

function Invoke-ComposerNative([string[]]$Arguments) {
    $helper = Join-Path $script:BetterCodexRoot 'src/generated/native/BetterCodexNative.exe'
    $receipt = & $helper @Arguments | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or -not $receipt.ok) { throw (Get-BetterCodexText 'launch.packageFailed') }
    return $receipt
}

function Get-ComposerPackage {
    return (Invoke-ComposerNative @('codex-package')).package
}

function Get-ComposerDesktopSnapshot($Package) {
    $verified = @((Invoke-ComposerNative @('codex-processes')).processes | Where-Object {
        $_.executable -eq $Package.executable -and $_.packageFullName -eq $Package.packageFullName
    })
    # A same-name process without verified package and kernel identity is a conflict.
    Get-Process -Name ChatGPT -ErrorAction SilentlyContinue | ForEach-Object {
        $candidate = $_
        $trusted = @($verified | Where-Object {
            $_.pid -eq $candidate.Id -and $_.created -eq $candidate.StartTime.ToUniversalTime().ToFileTimeUtc().ToString()
        })
        $owner = if ($trusted.Count -eq 1) { $trusted[0] }
        [pscustomobject]@{Id=$candidate.Id;Path=$owner.executable;Created=$owner.created}
    }
}

function Get-ComposerListenerSnapshot($Port) {
    if ($Port -lt 1024 -or $Port -gt 65535) { throw (Get-BetterCodexText 'launch.invalidPort') }
    (Invoke-ComposerNative @('port-listeners','--port',"$Port")).listeners | ForEach-Object {
        [pscustomobject]@{LocalAddress=$_.address;OwningProcess=$_.pid;Created=$_.created;
            Executable=$_.executable;PackageFullName=$_.packageFullName;CurrentSession=$_.currentSession}
    }
}

function Get-ComposerSupervisorRuntime($Process, $Settings, [string]$SettingsPath, [string]$Runtime) {
    $command = (Get-CimInstance Win32_Process -Filter "ProcessId=$($Process.Id)" -ErrorAction Stop).CommandLine
    $nodeScript = Join-Path $PSScriptRoot 'supervisor.cjs'
    $bound = $command -match ('(?i)(?:^|\s)--settings\s+"' + [regex]::Escape($SettingsPath) + '"(?=\s|$)') -and
        $command -match ('(?i)(?:^|\s)--runtime\s+"' + [regex]::Escape($Runtime) + '"(?=\s|$)')
    if (-not $bound) { return }
    if ($Process.Path -eq $Settings.node -and $command -match ('(?i)(?:^|\s)"' + [regex]::Escape($nodeScript) + '"(?=\s|$)')) { return 'node' }
}

function Start-ComposerSupervisor($Settings, [string]$SettingsPath, [string]$Runtime) {
    if (Test-Path -LiteralPath (Join-Path $script:BetterCodexRoot '.runtime/token-hud/embedded/runtime/launcher.json')) {
        & $Settings.node --no-warnings=ExperimentalWarning (Join-Path $PSScriptRoot 'portable-bootstrap.cjs') --guard-legacy | Out-Null
        if ($LASTEXITCODE -ne 0) { throw (Get-BetterCodexText 'launch.dependencyMissing') }
    }
    [IO.Directory]::CreateDirectory($Runtime) | Out-Null
    $pidPath = Join-Path $Runtime 'launcher.json'
    $stamp = Get-ComposerSupervisorStamp $Settings
    $alreadyRunning = $false
    if (Test-Path -LiteralPath $pidPath) {
        try {
            $previous = Get-Content -LiteralPath $pidPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $process = Get-Process -Id $previous.supervisorPid -ErrorAction SilentlyContinue
            # PowerShell 7 can deserialize ISO timestamps as DateTime, unlike 5.1.
            if ($process -and $process.StartTime.ToUniversalTime() -eq ([DateTimeOffset]$previous.startedAt).UtcDateTime) {
                $hostRuntime = Get-ComposerSupervisorRuntime $process $Settings $SettingsPath $Runtime
                $alreadyRunning = [bool]$hostRuntime
            }
        } catch { }
    }
    $stop = Join-Path $Runtime 'stop'
    if ($alreadyRunning -and ($previous.stamp -ne $stamp -or (Test-Path -LiteralPath $stop))) {
        Set-Content -LiteralPath $stop -Value '' -Encoding utf8
        # Only the verified enhancement host exits; Codex and independent recovery
        # executors are not children to clean up. A timeout must not spawn a duplicate.
        Wait-Process -InputObject $process -Timeout 15 -ErrorAction Stop
        $alreadyRunning = $false
    }
    if (Test-Path -LiteralPath $stop) { Remove-Item -LiteralPath $stop }
    if (-not $alreadyRunning) {
        $arguments = '--no-warnings=ExperimentalWarning "{0}" --settings "{1}" --runtime "{2}"' -f (Join-Path $PSScriptRoot 'supervisor.cjs'),$SettingsPath,$Runtime
        $env:BETTER_CODEX_LANGUAGE = $script:BetterCodexLanguage
        $process = Start-Process -FilePath $Settings.node -ArgumentList $arguments -WindowStyle Hidden -PassThru
        @{supervisorPid=$process.Id;startedAt=$process.StartTime.ToUniversalTime().ToString('o');stamp=$stamp} | ConvertTo-Json | Set-Content -LiteralPath $pidPath -Encoding utf8
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

function Write-ComposerLaunchEvent($Settings, [string]$Runtime, $Receipt, [string]$Kind = 'launch-request-result') {
    if (-not $Settings.node) { return }
    $previousExitCode = $global:LASTEXITCODE
    try {
        $id = $Receipt.correlation_id
        if ($id -notmatch '^[a-f0-9]{32,64}$') { $id = [Guid]::NewGuid().ToString('N') }
        $event = @{kind=$Kind;status=$(if ($Kind -eq 'launch-requested') {'observed'} elseif ($Receipt.activationSucceeded) {'success'} else {'failed'});
            source='launcher';correlation_id=$id;instance=$id;
            context=@{reason=$Receipt.hudReason;package_version=$Receipt.packageVersion}}
        $event | ConvertTo-Json -Depth 4 -Compress | & $Settings.node --no-warnings=ExperimentalWarning (Join-Path $PSScriptRoot '../platform/observability/cli.cjs') --runtime $Runtime append 2>$null | Out-Null
    } catch { } # Neither storage nor serialization failure may block activation.
    finally { $global:LASTEXITCODE = $previousExitCode }
}

function Invoke-ComposerMonitor {
    $settingsPath = Initialize-BetterCodexSettings
    $runtime = Get-BetterCodexStatePath $settingsPath
    $settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($settings.recoverAfterUpdate -eq $true) {
        $supervisorPid = Start-ComposerSupervisor $settings $settingsPath $runtime
        return @{supervisorPid=$supervisorPid;activationSucceeded=$false}
    }
    return @{activationSucceeded=$false}
}

function Wait-ComposerModelGateway($Settings, [string]$SettingsPath) {
    if ($env:MAGPIE_SKIP_WAIT -or -not $Settings.node) { return }
    try {
        & $Settings.node --no-warnings=ExperimentalWarning (Join-Path $PSScriptRoot '../lifecycle/startup/model-gateway.cjs') --settings $SettingsPath 2>$null | Out-Null
    } catch { } # Gateway/configuration failures must not prevent official activation.
}

function Invoke-ComposerLaunch([switch]$CheckOnly) {
    $settingsPath = Get-BetterCodexSettingsPath
    $runtime = Get-BetterCodexStatePath $settingsPath
    $plan = @{arguments='';reason='hud-preparation-failed';attach=$false}
    $package = $null
    $correlation = $env:BETTER_CODEX_CORRELATION_ID
    if ($correlation -notmatch '^[a-f0-9]{32,64}$') { $correlation = [Guid]::NewGuid().ToString('N') }
    $receipt = @{source='Start-ComposerHud.ps1';checkedAtUtc=[DateTime]::UtcNow.ToString('o');activationSucceeded=$false;correlation_id=$correlation}
    $settings = $null
    $coldStart = $false
    try {
        if ($CheckOnly) { $settingsPath = Get-BetterCodexSettingsPath -ReadLegacy }
        else { $settingsPath = Initialize-BetterCodexSettings }
        if (-not $CheckOnly -and -not $RecoveryActivation -and -not $StartupCheckStarted -and
            -not (Test-CodexRunning)) { Start-ComposerStartupCheck }
        $settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($dependency in @($settings.node,(Join-Path $script:BetterCodexRoot 'src/generated/native/BetterCodexNative.exe'))) {
            if (-not $dependency -or -not (Test-Path -LiteralPath $dependency)) { throw (Get-BetterCodexText 'launch.dependencyMissing') }
        }
        $package = Get-ComposerPackage
        $desktops = @(Get-ComposerDesktopSnapshot $package)
        $coldStart = -not $desktops.Count
        $listeners = @(Get-ComposerListenerSnapshot $settings.port)
        $plan = Resolve-ComposerLaunchPlan $package $settings $desktops $listeners $settingsPath -CheckOnly:$CheckOnly
        $receipt.displayPort = $settings.port
        if ($plan.previousPort) { $receipt.previousDisplayPort = $plan.previousPort }
        if (($plan.attach -or $settings.recoverAfterUpdate -eq $true) -and -not $CheckOnly -and -not $RecoveryActivation) {
            $receipt.supervisorPid = Start-ComposerSupervisor $settings $settingsPath $runtime
        }
    } catch {
        # Preserve valid cold-start flags if only the enhancement host failed.
        $plan.reason = 'hud-preparation-failed'
        $plan.attach = $false
        $receipt.errorType = $_.Exception.GetType().Name
    }
    $receipt.hudReason = $plan.reason
    $receipt.packageVersion = $package.packageVersion
    $receipt.locale = $script:BetterCodexLanguage
    if ($CheckOnly) { $receipt.message = Get-BetterCodexText 'launch.checked'; return $receipt }
    if ($coldStart) { Wait-ComposerModelGateway $settings $settingsPath }
    Write-ComposerLaunchReceipt $runtime $receipt 'launch-request.json'
    Write-ComposerLaunchEvent $settings $runtime $receipt 'launch-requested'
    # Every normal click activates the app, including HUD failure and existing instances.
    try {
        $receipt.activationProcessId = Invoke-CodexActivation $plan.arguments
        $receipt.activationSucceeded = $true
    } catch {
        $receipt.hudReason = 'activation-failed'
        $receipt.errorType = $_.Exception.GetType().Name
    }
    $receipt.message = Get-BetterCodexText "launch.$($receipt.hudReason)"
    Write-ComposerLaunchReceipt $runtime $receipt
    Write-ComposerLaunchEvent $settings $runtime $receipt
    return $receipt
}

if (-not $FunctionsOnly) {
    if (-not $CheckOnly) {
        if ($CorrelationId -match '^[a-f0-9]{32,64}$') { $env:BETTER_CODEX_CORRELATION_ID = $CorrelationId }
        elseif ($env:BETTER_CODEX_CORRELATION_ID -notmatch '^[a-f0-9]{32,64}$') { $env:BETTER_CODEX_CORRELATION_ID = [Guid]::NewGuid().ToString('N') }
    }
    if ($TaskMode -eq 'Reload') {
        Invoke-ComposerRelaunch
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
        if (-not $CheckOnly -and -not $result.activationSucceeded) { exit 1 }
    } finally {
        if ($held) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}
