param([ValidateSet('Wide','Default')][string]$Mode = 'Wide')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'shared/i18n.ps1')
. (Join-Path $PSScriptRoot 'shared/settings_store.ps1')
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$settingsPath = Join-Path $workspace '.runtime/token-hud/embedded/settings.json'
Update-BetterCodexSettings $settingsPath @{readingWidth=$Mode.ToLowerInvariant()}
$modeText = $(if ($Mode -eq 'Wide') { Get-BetterCodexText 'width.wide' } else { Get-BetterCodexText 'default' })
Write-Output (Get-BetterCodexText 'width.saved' @{mode=$modeText})
