param([ValidateSet('Enable','Disable','Status')][string]$Mode = 'Status')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../platform/i18n/i18n.ps1')
. (Join-Path $PSScriptRoot '../../platform/settings/settings_store.ps1')
$workspace = $script:BetterCodexRoot
$settingsPath = Join-Path $workspace '.runtime/token-hud/embedded/settings.json'
if ($Mode -ne 'Status') {
    Update-BetterCodexSettings $settingsPath @{customAccent=($Mode -eq 'Enable')}
}
$settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
$enabled = $settings.customAccent -ne $false
Write-Output (Get-BetterCodexText $(if ($enabled) { 'accent.enabled' } else { 'accent.disabled' }))
