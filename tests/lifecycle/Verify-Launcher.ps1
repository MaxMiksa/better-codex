$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../tools/token-hud-local/Start-ComposerHud.ps1') -FunctionsOnly
$checks = [Collections.Generic.List[string]]::new()
function Assert-Launch($Name, $Condition) {
    if (-not $Condition) { throw "Failed: $Name" }
    $checks.Add($Name)
}
$settings = @{port=19163}
$package = @{executable='C:\WindowsApps\Codex_future\app\ChatGPT.exe'}
$desktop = [pscustomobject]@{Id=123;Path=$package.executable}
$listener = [pscustomobject]@{LocalAddress='127.0.0.1';OwningProcess=123}
$plan = Get-ComposerLaunchPlan $package $settings @() @()
Assert-Launch 'cold-start-enables-local-display-interface' ($plan.attach -and $plan.arguments -match '19163')
$plan = Get-ComposerLaunchPlan $package $settings @($desktop) @($listener)
Assert-Launch 'future-package-path-reuses-verified-app' ($plan.attach -and $plan.arguments -eq '' -and $plan.reason -eq 'reuse-desktop')
$plan = Get-ComposerLaunchPlan $package $settings @($desktop) @()
Assert-Launch 'existing-app-without-interface-preserved' (-not $plan.attach -and $plan.reason -eq 'restart-required')
$listener.OwningProcess = 456
$plan = Get-ComposerLaunchPlan $package $settings @($desktop) @($listener)
Assert-Launch 'foreign-listener-refused' (-not $plan.attach -and $plan.reason -eq 'unverified-listener')
$desktop.Path = 'C:\WindowsApps\Codex_old\app\ChatGPT.exe'
$plan = Get-ComposerLaunchPlan $package $settings @($desktop) @()
Assert-Launch 'old-running-package-not-assumed-current' (-not $plan.attach -and $plan.reason -eq 'desktop-identity-unverified')

& {
    $port = Get-CodexAvailableDisplayPort
    $reservation = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $port)
    $reservation.ExclusiveAddressUse = $true
    try {
        $reservation.Start()
        Assert-Launch 'selected-loopback-port-is-free-and-in-range' ($port -ge 1024 -and $port -le 65535)
    } finally { $reservation.Stop() }
}

& {
    $settings = [pscustomobject]@{port=19163}
    $script:portWrites = 0
    function Get-CodexAvailableDisplayPort { 19165 }
    function Update-BetterCodexSettings { param($Path,$Patch)
        Assert-Launch 'port-repair-patches-only-port-in-settings-lock' ($Path -eq 'fixture-settings' -and $Patch.Count -eq 1 -and $Patch.port -eq 19165)
        $script:portWrites++
    }
    $plan = Resolve-ComposerLaunchPlan $package $settings @() @($listener) 'fixture-settings' -CheckOnly
    Assert-Launch 'read-only-collision-does-not-change-settings' ($plan.reason -eq 'unverified-listener' -and $settings.port -eq 19163 -and $script:portWrites -eq 0)
    $desktop.Path = $package.executable
    $plan = Resolve-ComposerLaunchPlan $package $settings @($desktop) @($listener) 'fixture-settings'
    Assert-Launch 'active-desktop-collision-does-not-move-port' ($plan.reason -eq 'unverified-listener' -and $script:portWrites -eq 0)
    $plan = Resolve-ComposerLaunchPlan $package $settings @() @($listener) 'fixture-settings'
    Assert-Launch 'cold-collision-persists-free-port-and-enables-interface' ($settings.port -eq 19165 -and $plan.previousPort -eq 19163 -and $plan.attach -and $plan.arguments -match '19165' -and $script:portWrites -eq 1)
    $plan = Resolve-ComposerLaunchPlan $package $settings @() @() 'fixture-settings'
    Assert-Launch 'free-port-does-not-rewrite-settings' ($plan.attach -and $script:portWrites -eq 1)
    function Update-BetterCodexSettings { throw 'fixture save failure' }
    $refused = $false
    try { Resolve-ComposerLaunchPlan $package $settings @() @($listener) 'fixture-settings' } catch { $refused = $true }
    Assert-Launch 'failed-save-does-not-switch-in-memory-port' ($refused -and $settings.port -eq 19165)
}
& {
    $fixture = @{python='fixture';node='fixture';playwright='fixture';collectorDir='fixture';port=19163}
    $original = Get-ComposerSupervisorStamp $fixture
    $fixture.readingWidth = 1000
    Assert-Launch 'visual-preference-does-not-refresh-supervisor' ((Get-ComposerSupervisorStamp $fixture) -eq $original)
    $fixture.port = 19165
    Assert-Launch 'changed-connection-settings-refresh-supervisor' ((Get-ComposerSupervisorStamp $fixture) -ne $original)
}

# Parse a real JSON receipt in each shell, then exercise reuse without launching.
& {
    $current = Get-Process -Id $PID
    $record = @{supervisorPid=$PID;startedAt=$current.StartTime.ToUniversalTime().ToString('o');stamp='fixture'}
    $testSettings = @{python=$current.Path}
    $script:spawnedForCheck = 0
    function Get-Content { $record | ConvertTo-Json }
    function Test-Path { param($LiteralPath) return $LiteralPath.EndsWith('launcher.json') }
    function Start-Process {
        $script:spawnedForCheck++
        return [pscustomobject]@{Id=987;StartTime=$current.StartTime}
    }
    function Set-Content { }
    function Get-ComposerSupervisorStamp { 'fixture' }
    $reused = Start-ComposerSupervisor $testSettings 'unused-settings.json' $PSScriptRoot
    Assert-Launch 'live-supervisor-json-receipt-is-reused' ($reused -eq $PID -and $script:spawnedForCheck -eq 0)
    $record.startedAt = $current.StartTime.AddSeconds(-1).ToUniversalTime().ToString('o')
    $replacement = Start-ComposerSupervisor $testSettings 'unused-settings.json' $PSScriptRoot
    Assert-Launch 'recycled-pid-with-different-start-is-refused' ($replacement -eq 987 -and $script:spawnedForCheck -eq 1)
    $record.startedAt = $current.StartTime.ToUniversalTime().ToString('o')
    $testSettings.python = 'C:\unrelated-python.exe'
    $replacement = Start-ComposerSupervisor $testSettings 'unused-settings.json' $PSScriptRoot
    Assert-Launch 'different-executable-is-refused' ($replacement -eq 987 -and $script:spawnedForCheck -eq 2)
    $testSettings.python = $current.Path
    $record.Remove('stamp')
    $script:waitedForHost = $null
    function Wait-Process { param($InputObject,$Timeout,$ErrorAction); $script:waitedForHost=$InputObject.Id }
    $replacement = Start-ComposerSupervisor $testSettings 'unused-settings.json' $PSScriptRoot
    Assert-Launch 'legacy-supervisor-gracefully-refreshed' ($script:waitedForHost -eq $PID -and $replacement -eq 987 -and $script:spawnedForCheck -eq 3)
    function Wait-Process { throw 'fixture shutdown timeout' }
    $refused = $false
    try { Start-ComposerSupervisor $testSettings 'unused-settings.json' $PSScriptRoot } catch { $refused = $true }
    Assert-Launch 'shutdown-timeout-never-spawns-duplicate' ($refused -and $script:spawnedForCheck -eq 3)
}

# Exercise orchestration with mocked IO; no app activation or production edits.
function Invoke-CodexActivation([string]$Arguments) { $script:activationArguments=$Arguments; return 987 }
function Write-ComposerLaunchReceipt($Runtime,$Receipt) { }
function Get-Content { throw 'synthetic unreadable settings' }
$receipt = Invoke-ComposerLaunch
Assert-Launch 'unreadable-hud-settings-still-activate-codex' ($receipt.activationSucceeded -and $receipt.hudReason -eq 'hud-preparation-failed' -and $script:activationArguments -eq '')
$script:activationArguments = 'untouched'
$receipt = Invoke-ComposerLaunch -CheckOnly
Assert-Launch 'check-only-never-activates' ($script:activationArguments -eq 'untouched')
function Invoke-CodexActivation([string]$Arguments) { throw 'synthetic activation failure' }
$receipt = Invoke-ComposerLaunch
Assert-Launch 'activation-error-is-explicit' (-not $receipt.activationSucceeded -and $receipt.hudReason -eq 'activation-failed')
# A stale preference from an older installation must not require a task.
function Get-Content { '{"runAsAdministrator":true}' }
function Get-Process { @() }
function Start-InstructionReviewCheck { }
function Invoke-CodexActivation([string]$Arguments) { $script:activationArguments=$Arguments; return 123 }
$receipt = Invoke-ComposerLaunch
Assert-Launch 'legacy-admin-preference-uses-ordinary-activation' ($receipt.activationSucceeded -and $receipt.activationProcessId -eq 123 -and -not $receipt.ContainsKey('administratorRequested'))
$script:activationArguments = 'untouched'
$receipt = Invoke-ComposerLaunch -CheckOnly
Assert-Launch 'legacy-admin-preference-check-is-read-only' ($script:activationArguments -eq 'untouched' -and -not $receipt.activationSucceeded)

& {
    function Get-Content { '{"python":"Get-FixturePackage","node":"fixture","playwright":"fixture","collectorDir":"fixture","port":19163,"recoverAfterUpdate":true,"runAsAdministrator":true}' }
    function Test-Path { $true }
    function Get-FixturePackage { $global:LASTEXITCODE=0; '{"executable":"C:\\Codex\\ChatGPT.exe","packageVersion":"99.1.0.0"}' }
    function Get-Process { [pscustomobject]@{Id=123;Path='C:\Codex\ChatGPT.exe'} }
    function Get-NetTCPConnection { @() }
    function Start-ComposerSupervisor { $script:monitorStarts++; return 999 }
    function Wait-ComposerModelGateway { $script:gatewayWaits++ }
    $script:monitorStarts = 0
    $script:gatewayWaits = 0
    $receipt = Invoke-ComposerLaunch
    Assert-Launch 'update-monitor-starts-without-desktop-interface' ($script:monitorStarts -eq 1 -and $receipt.hudReason -eq 'restart-required')
    $receipt = Invoke-ComposerLaunch -CheckOnly
    Assert-Launch 'read-only-check-never-starts-update-monitor' ($script:monitorStarts -eq 1)
    Assert-Launch 'existing-desktop-and-read-only-check-skip-gateway-wait' ($script:gatewayWaits -eq 0)
    $RecoveryActivation = $true
    function Get-Process { @() }
    $receipt = Invoke-ComposerLaunch
    Assert-Launch 'recovery-reopen-does-not-start-another-supervisor' ($script:monitorStarts -eq 1 -and $receipt.activationSucceeded)
    Assert-Launch 'cold-recovery-launch-waits-for-configured-gateway' ($script:gatewayWaits -eq 1)
    $RecoveryActivation = $false
    function Start-ComposerSupervisor { throw 'fixture host preparation failure' }
    function Invoke-CodexActivation { param($Arguments); $script:preservedArguments=$Arguments; return 456 }
    $receipt = Invoke-ComposerLaunch
    Assert-Launch 'host-failure-preserves-valid-cold-start-interface-flags' ($receipt.hudReason -eq 'hud-preparation-failed' -and $receipt.activationSucceeded -and $script:preservedArguments -match '19163')
    Assert-Launch 'host-failure-retains-cold-start-gateway-wait' ($script:gatewayWaits -eq 2)
    $receipt = Invoke-ComposerLaunch -CheckOnly
    Assert-Launch 'cold-check-only-skips-gateway-wait' ($script:gatewayWaits -eq 2)
}

& {
    $previousSkip = $env:MAGPIE_SKIP_WAIT
    $script:gatewayHelperCalls = 0
    function Invoke-FixtureGateway {
        $script:gatewayHelperCalls++
        Assert-Launch 'gateway-helper-uses-settings-without-hardcoded-port' ($args -contains '--settings' -and $args -contains 'fixture-settings' -and
            @($args | Where-Object { $_ -like '*model_gateway.py' }).Count -eq 1)
    }
    try {
        $env:MAGPIE_SKIP_WAIT = $null
        Wait-ComposerModelGateway @{python='Invoke-FixtureGateway'} 'fixture-settings'
        Assert-Launch 'cold-start-invokes-gateway-helper' ($script:gatewayHelperCalls -eq 1)
        $env:MAGPIE_SKIP_WAIT = '1'
        Wait-ComposerModelGateway @{python='Invoke-FixtureGateway'} 'fixture-settings'
        Assert-Launch 'explicit-gateway-wait-opt-out-is-preserved' ($script:gatewayHelperCalls -eq 1)
        $env:MAGPIE_SKIP_WAIT = $null
        function Invoke-FixtureGateway { throw 'fixture gateway helper failure' }
        Wait-ComposerModelGateway @{python='Invoke-FixtureGateway'} 'fixture-settings'
        Assert-Launch 'gateway-helper-failure-does-not-block-activation' $true
    } finally { $env:MAGPIE_SKIP_WAIT = $previousSkip }
}

function Test-Path { $true }
& {
    $script:diagnosticStarts = 0
    function Start-Process { param($FilePath,$ArgumentList,$WindowStyle)
        $script:diagnosticStarts++
        Assert-Launch 'startup-check-uses-independent-hidden-sta-host' ($WindowStyle -eq 'Hidden' -and $ArgumentList -match '-STA' -and $ArgumentList -match 'Show-StartupCheck.ps1')
    }
    Start-ComposerStartupCheck
    Assert-Launch 'startup-check-does-not-wait-for-diagnostics' ($script:diagnosticStarts -eq 1)
    function Start-Process { param($FilePath,$ArgumentList,$WindowStyle)
        Assert-Launch 'startup-check-preserves-after-update-context' ($ArgumentList -match ' -AfterUpdate$' -and $WindowStyle -eq 'Hidden')
    }
    Start-ComposerStartupCheck -AfterUpdate
    function Start-Process { throw 'fixture diagnostic launch failure' }
    Start-ComposerStartupCheck
    Assert-Launch 'diagnostic-failure-does-not-escape-into-activation' $true
}
& {
    function Get-Content { '{"python":"Invoke-FixtureRelaunch","runAsAdministrator":true}' }
    function Invoke-FixtureRelaunch { $script:reloadArguments=$args; $global:LASTEXITCODE=0 }
    function Wait-ComposerModelGateway { throw 'Reload dispatch must not wait for the gateway' }
    Invoke-ComposerRelaunch
    Assert-Launch 'reload-executes-only-fixed-helper-and-settings' ($script:reloadArguments -contains '--execute' -and
        @($script:reloadArguments | Where-Object { $_ -like '*relaunch.py' } | ForEach-Object { [IO.Path]::GetFullPath($_) }) -contains (Join-Path $script:BetterCodexRoot 'tools/token-hud-local/diagnostics/relaunch.py') -and
        $script:reloadArguments -contains ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../.runtime/token-hud/embedded/settings.json'))))
}
& {
    $script:monitorStarts = 0
    function Get-Content { '{"recoverAfterUpdate":true,"runAsAdministrator":false}' }
    function Start-ComposerSupervisor { $script:monitorStarts++; return 999 }
    function Invoke-CodexActivation { throw 'Monitor must not activate Codex' }
    function Start-ComposerStartupCheck { throw 'Monitor must not open diagnostics' }
    function Wait-ComposerModelGateway { throw 'Monitor must not wait for the gateway' }
    function Start-InstructionReviewCheck { }
    $receipt = Invoke-ComposerMonitor
    Assert-Launch 'ordinary-monitor-requests-only-supervisor' ($script:monitorStarts -eq 1 -and $receipt.supervisorPid -eq 999 -and -not $receipt.activationSucceeded)
    function Get-Content { '{"recoverAfterUpdate":false}' }
    $receipt = Invoke-ComposerMonitor
    Assert-Launch 'disabled-monitor-keeps-supervisor-stopped' ($script:monitorStarts -eq 1 -and -not $receipt.activationSucceeded)
    function Get-Content { '{"recoverAfterUpdate":true,"runAsAdministrator":true}' }
    $receipt = Invoke-ComposerMonitor
    Assert-Launch 'legacy-admin-preference-monitor-uses-supervisor' ($script:monitorStarts -eq 2 -and $receipt.supervisorPid -eq 999 -and -not $receipt.activationSucceeded)
}
& {
    # Execute the real settings command's request block with command transport mocked.
    $tokens = $null; $parseErrors = $null
    $recovery = Join-Path $PSScriptRoot '../../src/lifecycle/recovery/Set-UpdateRecovery.ps1'
    $ast = [Management.Automation.Language.Parser]::ParseFile($recovery, [ref]$tokens, [ref]$parseErrors)
    $requests = @($ast.FindAll({param($node) $node -is [Management.Automation.Language.IfStatementAst] -and $node.Extent.Text -match '\$result.supervisorPid'}, $true))
    $request = [ScriptBlock]::Create($requests[0].Extent.Text)
    $Mode = 'Enable'; $workspace = 'fixture'; $settings = @{runAsAdministrator=$false}; $result = @{}
    function Join-Path { param($Path,$ChildPath); Assert-Launch 'monitor-consumer-uses-stable-command' ($ChildPath -eq 'tools/token-hud-local/Start-ComposerHud.ps1'); return 'Invoke-FixtureMonitor' }
    function Invoke-FixtureMonitor { param($TaskMode); $script:requestedMode=$TaskMode; '{"supervisorPid":999,"activationSucceeded":false}' }
    . $request
    Assert-Launch 'settings-consumes-ordinary-monitor-json' ($script:requestedMode -eq 'Monitor' -and $result.supervisorPid -eq 999)
    $settings.runAsAdministrator = $true; $result = @{}; $script:requestedMode = $null
    . $request
    Assert-Launch 'legacy-admin-setting-consumes-ordinary-monitor-json' ($script:requestedMode -eq 'Monitor' -and $result.supervisorPid -eq 999)
}
@{passed=$checks.Count;checks=@($checks)} | ConvertTo-Json
