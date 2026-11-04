$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../src/lifecycle/diagnostics/Read-StartupEntries.ps1') -FunctionsOnly
$work = $env:BETTER_CODEX_TEST_WORK
if (-not $work -or -not ([IO.Path]::GetFullPath($work)).StartsWith((Join-Path $script:BetterCodexRoot '.validation-runtime/').Replace('/','\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid fixture root' }
[IO.Directory]::CreateDirectory($work) | Out-Null
$expected = Get-ExpectedWrapperContent $script:BetterCodexRoot
$path = Join-Path $work 'owned.vbs'
[IO.File]::WriteAllText($path, $expected.Replace("`n","`r`n"), [Text.Encoding]::Unicode)
if (-not (Test-WrapperContent $path $expected)) { throw 'Current wrapper rejected' }
[IO.File]::WriteAllText($path, $expected.Replace($script:BetterCodexRoot, 'D:\OtherCopy'), [Text.Encoding]::Unicode)
if (Test-WrapperContent $path $expected) { throw 'Other copy wrapper accepted' }
[IO.File]::WriteAllText($path, 'truncated', [Text.Encoding]::Unicode)
if (Test-WrapperContent $path $expected) { throw 'Truncated wrapper accepted' }
function Get-ItemProperty {
    param($LiteralPath, $Name, $ErrorAction)
    if ($LiteralPath -notlike '*SystemAppData\OpenAI.Codex_2p2nqsd0c76g0\App' -or $Name -ne 'State') { throw 'Unexpected registry read' }
    if ($script:fixtureUnavailable) { throw 'Registry unavailable' }
    return @{State=$script:fixtureState}
}
$passed = 3
foreach ($state in @(2,4)) {
    $script:fixtureState = $state
    $result = Get-NativeStartupResult $true
    if ($result.code -ne 'entryNativeConflict' -or $result.state -ne 'warning') { throw 'Enabled conflict missed' }
    $result = Get-NativeStartupResult $false
    if ($result.code -ne 'entryNativeEnabled' -or $result.state -ne 'notApplicable') { throw 'Disabled managed entry is not a conflict' }
    $passed += 2
}
foreach ($state in @(0,1,3)) {
    $script:fixtureState = $state
    $result = Get-NativeStartupResult $true
    if ($result.code -ne 'entryNativeDisabled' -or $result.state -ne 'pass') { throw 'Disabled native state misread' }
    $passed++
}
foreach ($state in @($null,99)) {
    $script:fixtureState = $state
    if ((Get-NativeStartupResult $true).state -ne 'unknown') { throw 'Unknown state claimed disabled' }
    $passed++
}
$script:fixtureUnavailable = $true
if ((Get-NativeStartupResult $true).state -ne 'unknown') { throw 'Unreadable state claimed disabled' }
$passed++
@{passed=$passed;scope='synthetic wrapper files and mocked native startup registry; no registration or live launcher calls'} | ConvertTo-Json -Compress
