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

# Parse a real JSON receipt in each shell, then exercise reuse without launching.
& {
    $current = Get-Process -Id $PID
    $record = @{supervisorPid=$PID;startedAt=$current.StartTime.ToUniversalTime().ToString('o')}
    $testSettings = @{python=$current.Path}
    $script:spawnedForCheck = 0
    function Get-Content { $record | ConvertTo-Json }
    function Test-Path { param($LiteralPath) return $LiteralPath.EndsWith('launcher.json') }
    function Start-Process {
        $script:spawnedForCheck++
        return [pscustomobject]@{Id=987;StartTime=$current.StartTime}
    }
    function Set-Content { }
    $reused = Start-ComposerSupervisor $testSettings 'unused-settings.json' $PSScriptRoot
    Assert-Launch 'live-supervisor-json-receipt-is-reused' ($reused -eq $PID -and $script:spawnedForCheck -eq 0)
    $record.startedAt = $current.StartTime.AddSeconds(-1).ToUniversalTime().ToString('o')
    $replacement = Start-ComposerSupervisor $testSettings 'unused-settings.json' $PSScriptRoot
    Assert-Launch 'recycled-pid-with-different-start-is-refused' ($replacement -eq 987 -and $script:spawnedForCheck -eq 1)
    $record.startedAt = $current.StartTime.ToUniversalTime().ToString('o')
    $testSettings.python = 'C:\unrelated-python.exe'
    $replacement = Start-ComposerSupervisor $testSettings 'unused-settings.json' $PSScriptRoot
    Assert-Launch 'different-executable-is-refused' ($replacement -eq 987 -and $script:spawnedForCheck -eq 2)
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
# Administrator routing, with no scheduled task or desktop launch.
function Get-Content { '{"runAsAdministrator":true}' }
function Test-BetterCodexAdministrator { $false }
function Invoke-BetterCodexAdministratorTask { $script:dispatched++; return 'fixture-instance' }
function Invoke-CodexActivation { throw 'must not activate an ordinary desktop' }
$script:dispatched = 0
$receipt = Invoke-ComposerLaunch
Assert-Launch 'ordinary-wrapper-dispatches-highest-task-only' ($receipt.administratorDispatched -and -not $receipt.activationSucceeded -and $script:dispatched -eq 1)
$receipt = Invoke-ComposerLaunch -CheckOnly
Assert-Launch 'administrator-check-does-not-dispatch' ($script:dispatched -eq 1 -and -not $receipt.activationSucceeded)
function Test-BetterCodexAdministrator { $true }
function Get-Process { @() }
function Start-InstructionReviewCheck { }
function Invoke-CodexAdministratorActivation([string]$Arguments) { $script:elevatedActivations++; return 456 }
$script:elevatedActivations = 0
$receipt = Invoke-ComposerLaunch
Assert-Launch 'elevated-cold-start-survives-hud-preparation-failure' ($receipt.activationSucceeded -and $receipt.administratorState -eq 'launched' -and $script:elevatedActivations -eq 1)
function Get-Process { [pscustomobject]@{Id=123} }
function Get-BetterCodexDesktopElevation { $false }
function Invoke-CodexActivation { return 123 }
$receipt = Invoke-ComposerLaunch
Assert-Launch 'existing-ordinary-session-preserved-with-explicit-pending-elevation' ($receipt.activationSucceeded -and $receipt.administratorState -eq 'restart-required' -and $script:elevatedActivations -eq 1)
function Get-BetterCodexDesktopElevation { $true }
$receipt = Invoke-ComposerLaunch
Assert-Launch 'existing-administrator-session-reused' ($receipt.administratorState -eq 'active' -and $script:elevatedActivations -eq 1)

& {
    function Get-Content { '{"python":"Get-FixturePackage","node":"fixture","playwright":"fixture","collectorDir":"fixture","port":19163,"recoverAfterUpdate":true,"runAsAdministrator":true}' }
    function Test-Path { $true }
    function Get-FixturePackage { $global:LASTEXITCODE=0; '{"executable":"C:\\Codex\\ChatGPT.exe","packageVersion":"99.1.0.0"}' }
    function Get-Process { [pscustomobject]@{Id=123;Path='C:\Codex\ChatGPT.exe'} }
    function Get-NetTCPConnection { @() }
    function Start-ComposerSupervisor { $script:monitorStarts++; return 999 }
    $script:monitorStarts = 0
    $receipt = Invoke-ComposerLaunch
    Assert-Launch 'update-monitor-starts-without-desktop-interface' ($script:monitorStarts -eq 1 -and $receipt.hudReason -eq 'restart-required')
    $receipt = Invoke-ComposerLaunch -CheckOnly
    Assert-Launch 'read-only-check-never-starts-update-monitor' ($script:monitorStarts -eq 1)
    $RecoveryActivation = $true
    function Get-Process { @() }
    $receipt = Invoke-ComposerLaunch
    Assert-Launch 'recovery-reopen-does-not-start-another-supervisor' ($script:monitorStarts -eq 1 -and $receipt.activationSucceeded)
}

# Exercise the real cold-start function against a future registered package.
. (Join-Path $PSScriptRoot '../../src/lifecycle/startup/codex_activation.ps1')
function Get-AppxPackage { [pscustomobject]@{PackageFamilyName='OpenAI.Codex_2p2nqsd0c76g0';Status='Ok';SignatureKind='Store';InstallLocation='C:\WindowsApps\Codex_future';Version='99.1'} }
function Test-Path { $true }
function Start-Process { param($FilePath,$ArgumentList,[switch]$PassThru); $script:startedFile=$FilePath;$script:startedArguments=$ArgumentList;return [pscustomobject]@{Id=456} }
$null = Invoke-CodexAdministratorActivation '--remote-debugging-address=127.0.0.1 --remote-debugging-port=19163'
Assert-Launch 'administrator-start-resolves-future-package-and-preserves-hud-flags' ($script:startedFile -eq 'C:\WindowsApps\Codex_future\app\ChatGPT.exe' -and $script:startedArguments -match '19163')
function Test-BetterCodexAdministrator { $false }
$refused = $false
try { Invoke-CodexAdministratorActivation '' } catch { $refused = $true }
Assert-Launch 'administrator-cold-start-requires-real-elevation' $refused
& {
    $script:diagnosticStarts = 0
    function Start-Process { param($FilePath,$ArgumentList,$WindowStyle)
        $script:diagnosticStarts++
        Assert-Launch 'startup-check-uses-independent-hidden-sta-host' ($WindowStyle -eq 'Hidden' -and $ArgumentList -match '-STA' -and $ArgumentList -match 'Show-StartupCheck.ps1')
    }
    Start-ComposerStartupCheck
    Assert-Launch 'startup-check-does-not-wait-for-diagnostics' ($script:diagnosticStarts -eq 1)
    function Start-Process { throw 'fixture diagnostic launch failure' }
    Start-ComposerStartupCheck
    Assert-Launch 'diagnostic-failure-does-not-escape-into-activation' $true
}
& {
    function Get-Content { '{"python":"Invoke-FixtureRelaunch","runAsAdministrator":true}' }
    function Test-BetterCodexAdministrator { $false }
    function Invoke-BetterCodexAdministratorTask { param($Mode); $script:reloadMode=$Mode }
    function Invoke-FixtureRelaunch { throw 'Must dispatch before executing helper' }
    Invoke-ComposerRelaunch
    Assert-Launch 'reload-dispatches-existing-verified-administrator-task' ($script:reloadMode -eq 'Reload')
    function Test-BetterCodexAdministrator { $true }
    function Invoke-FixtureRelaunch { $script:reloadArguments=$args; $global:LASTEXITCODE=0 }
    Invoke-ComposerRelaunch
    Assert-Launch 'reload-executes-only-fixed-helper-and-settings' ($script:reloadArguments -contains '--execute' -and
        @($script:reloadArguments | Where-Object { $_ -like '*relaunch.py' } | ForEach-Object { [IO.Path]::GetFullPath($_) }) -contains (Join-Path $script:BetterCodexRoot 'tools/token-hud-local/diagnostics/relaunch.py') -and
        $script:reloadArguments -contains ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../.runtime/token-hud/embedded/settings.json'))))
}
& {
    $AdministratorTask = $false
    $script:monitorStarts = 0
    $script:monitorDispatch = $null
    function Get-Content { '{"recoverAfterUpdate":true,"runAsAdministrator":false}' }
    function Start-ComposerSupervisor { $script:monitorStarts++; return 999 }
    function Invoke-CodexActivation { throw 'Monitor must not activate Codex' }
    function Invoke-CodexAdministratorActivation { throw 'Monitor must not activate Codex' }
    function Start-ComposerStartupCheck { throw 'Monitor must not open diagnostics' }
    function Start-InstructionReviewCheck { }
    function Test-BetterCodexAdministrator { $false }
    function Invoke-BetterCodexAdministratorTask { param($Mode); $script:monitorDispatch=$Mode; return 'fixture-instance' }
    $receipt = Invoke-ComposerMonitor
    Assert-Launch 'ordinary-monitor-requests-only-supervisor' ($script:monitorStarts -eq 1 -and $receipt.supervisorPid -eq 999 -and -not $receipt.activationSucceeded)
    function Get-Content { '{"recoverAfterUpdate":false}' }
    $receipt = Invoke-ComposerMonitor
    Assert-Launch 'disabled-monitor-keeps-supervisor-stopped' ($script:monitorStarts -eq 1 -and -not $receipt.activationSucceeded)
    function Get-Content { '{"recoverAfterUpdate":true,"runAsAdministrator":true}' }
    $receipt = Invoke-ComposerMonitor
    Assert-Launch 'ordinary-monitor-dispatches-administrator-preference' ($script:monitorStarts -eq 1 -and $script:monitorDispatch -eq 'Monitor' -and -not $receipt.activationSucceeded)
    $AdministratorTask = $true
    $refused = $false
    try { Invoke-ComposerMonitor } catch { $refused = $true }
    Assert-Launch 'administrator-monitor-requires-elevation' $refused
    function Test-BetterCodexAdministrator { $true }
    $receipt = Invoke-ComposerMonitor
    Assert-Launch 'administrator-monitor-requests-only-supervisor' ($script:monitorStarts -eq 2 -and $receipt.supervisorPid -eq 999 -and -not $receipt.activationSucceeded)
}
& {
    # Execute the real settings command's request block with command transport mocked.
    $tokens = $null; $parseErrors = $null
    $recovery = Join-Path $PSScriptRoot '../../src/lifecycle/recovery/Set-UpdateRecovery.ps1'
    $ast = [Management.Automation.Language.Parser]::ParseFile($recovery, [ref]$tokens, [ref]$parseErrors)
    $requests = @($ast.FindAll({param($node) $node -is [Management.Automation.Language.IfStatementAst] -and $node.Extent.Text -match '\$result.monitorRequest'}, $true))
    $request = [ScriptBlock]::Create($requests[0].Extent.Text)
    $Mode = 'Enable'; $workspace = 'fixture'; $settings = @{runAsAdministrator=$false}; $result = @{}
    function Join-Path { param($Path,$ChildPath); Assert-Launch 'monitor-consumer-uses-stable-command' ($ChildPath -eq 'tools/token-hud-local/Start-ComposerHud.ps1'); return 'Invoke-FixtureMonitor' }
    function Invoke-FixtureMonitor { param($TaskMode); $script:requestedMode=$TaskMode; '{"supervisorPid":999,"activationSucceeded":false}' }
    function Invoke-BetterCodexAdministratorTask { param($Mode); $script:requestedMode=$Mode; return 'fixture-instance' }
    . $request
    Assert-Launch 'settings-consumes-ordinary-monitor-json' ($script:requestedMode -eq 'Monitor' -and $result.supervisorPid -eq 999)
    $settings.runAsAdministrator = $true; $result = @{}; $script:requestedMode = $null
    . $request
    Assert-Launch 'settings-consumes-administrator-monitor-request' ($script:requestedMode -eq 'Monitor' -and $result.monitorRequest -eq 'fixture-instance')
}
@{passed=$checks.Count;checks=@($checks)} | ConvertTo-Json
