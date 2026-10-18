$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Start-ComposerHud.ps1') -FunctionsOnly
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
@{passed=$checks.Count;checks=@($checks)} | ConvertTo-Json
