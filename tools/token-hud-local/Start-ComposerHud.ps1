param([switch]$CheckOnly, [switch]$FunctionsOnly)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'shared/codex_activation.ps1')

function Get-ComposerLaunchPlan($Package, $Settings, $Desktops, $Listeners) {
    if ($Settings.port -lt 1024 -or $Settings.port -gt 65535) { throw 'Invalid display port.' }
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
        $arguments = '-X utf8 "{0}" --settings "{1}" --runtime "{2}"' -f (Join-Path $PSScriptRoot 'embedded/supervisor.py'),$SettingsPath,$Runtime
        $process = Start-Process -FilePath $Settings.python -ArgumentList $arguments -WindowStyle Hidden -PassThru
        @{supervisorPid=$process.Id;startedAt=$process.StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $pidPath -Encoding utf8
    }
    return $process.Id
}

function Write-ComposerLaunchReceipt([string]$Runtime, $Receipt) {
    try {
        [IO.Directory]::CreateDirectory($Runtime) | Out-Null
        $target = Join-Path $Runtime 'launch-receipt.json'
        $temporary = "$target.next"
        [IO.File]::WriteAllText($temporary, ($Receipt | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $temporary -Destination $target -Force
    } catch { } # Reporting must not block official activation.
}

function Invoke-ComposerLaunch([switch]$CheckOnly) {
    $workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
    $settingsPath = Join-Path $workspace '.runtime/token-hud/embedded/settings.json'
    $runtime = Join-Path (Split-Path -Parent $settingsPath) 'runtime'
    $plan = @{arguments='';reason='hud-preparation-failed';attach=$false}
    $package = $null
    $receipt = @{source='Start-ComposerHud.ps1';checkedAtUtc=[DateTime]::UtcNow.ToString('o');activationSucceeded=$false}
    try {
        $settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($dependency in @($settings.python,$settings.node,(Join-Path $settings.playwright 'package.json'),(Join-Path $settings.collectorDir 'metrics.py'))) {
            if (-not $dependency -or -not (Test-Path -LiteralPath $dependency)) { throw 'HUD dependency unavailable.' }
        }
        $package = & $settings.python (Join-Path $PSScriptRoot 'shared/desktop_package.py') | ConvertFrom-Json
        if ($LASTEXITCODE -ne 0 -or -not $package.executable) { throw 'Codex package verification failed.' }
        $desktops = @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue)
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $settings.port -ErrorAction SilentlyContinue)
        $plan = Get-ComposerLaunchPlan $package $settings $desktops $listeners
        if ($plan.attach -and -not $CheckOnly) {
            $receipt.supervisorPid = Start-ComposerSupervisor $settings $settingsPath $runtime
        }
    } catch {
        $plan = @{arguments='';reason='hud-preparation-failed';attach=$false}
        $receipt.errorType = $_.Exception.GetType().Name
    }
    $receipt.hudReason = $plan.reason
    $receipt.packageVersion = $package.packageVersion
    if ($CheckOnly) { return $receipt }
    # Every normal click activates the app, including HUD failure and existing instances.
    try {
        $receipt.activationProcessId = Invoke-CodexActivation $plan.arguments
        $receipt.activationSucceeded = $true
    } catch {
        $receipt.hudReason = 'activation-failed'
        $receipt.errorType = $_.Exception.GetType().Name
    }
    Write-ComposerLaunchReceipt $runtime $receipt
    return $receipt
}

if (-not $FunctionsOnly) {
    $mutex = [Threading.Mutex]::new($false, 'Local\CodexComposerHudLauncher')
    $held = $false
    try {
        try { $held = $mutex.WaitOne(15000) } catch [Threading.AbandonedMutexException] { $held = $true }
        if (-not $held) { Write-Output '{"hudReason":"launch-already-in-progress"}'; return }
        $result = Invoke-ComposerLaunch -CheckOnly:$CheckOnly
        $result | ConvertTo-Json
        if (-not $CheckOnly -and -not $result.activationSucceeded) { exit 1 }
    } finally {
        if ($held) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}
