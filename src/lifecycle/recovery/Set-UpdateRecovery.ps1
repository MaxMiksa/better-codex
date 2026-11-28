param([ValidateSet('Enable','Disable','Status')][string]$Mode = 'Status')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../platform/i18n/i18n.ps1')
. (Join-Path $PSScriptRoot '../../platform/settings/settings_store.ps1')
$workspace = $script:BetterCodexRoot
$settingsPath = Initialize-BetterCodexSettings
$runtime = Get-BetterCodexStatePath $settingsPath
$settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($Mode -eq 'Enable') {
    # Establish the current version before enabling: this is never permission to
    # restart an ordinary instance that was already running during installation.
    $null = & $settings.node --no-warnings=ExperimentalWarning (Join-Path $PSScriptRoot 'update-recovery.cjs') --initialize --settings $settingsPath --runtime $runtime
    if ($LASTEXITCODE -ne 0) { throw (Get-BetterCodexText 'settings.saveFailed') }
    Update-BetterCodexSettings $settingsPath @{recoverAfterUpdate=$true}
} elseif ($Mode -eq 'Disable') {
    Update-BetterCodexSettings $settingsPath @{recoverAfterUpdate=$false}
}
$settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
$result = @{enabled=$settings.recoverAfterUpdate -eq $true;countdownSeconds=15;message=(Get-BetterCodexText "recovery.$($Mode.ToLowerInvariant())")}
if ($Mode -eq 'Enable') {
    $monitor = & (Join-Path $workspace 'src/app/Start-ComposerHud.ps1') -TaskMode Monitor | ConvertFrom-Json
    $result.supervisorPid = $monitor.supervisorPid
}
$statePath = Join-Path $runtime 'update-recovery.json'
if (Test-Path -LiteralPath $statePath) { $result.state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json }
$result | ConvertTo-Json -Depth 5
