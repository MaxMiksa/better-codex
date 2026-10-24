param([switch]$Preview, [switch]$AfterUpdate,
    [ValidateSet('Healthy','Failed','Checking','Partial','Enhancements','Updated')][string]$PreviewState = 'Healthy',
    [ValidateSet('auto','light','dark')][string]$PreviewTheme = 'auto',
    [string]$SettingsPath)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../platform/i18n/i18n.ps1')
if (-not [Environment]::UserInteractive) { exit 3 }
if (-not $SettingsPath) { $SettingsPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../.runtime/token-hud/embedded/settings.json')) }
Add-Type -AssemblyName System.Windows.Forms,System.Drawing,System.Web.Extensions
Add-Type -Path @((Join-Path $PSScriptRoot 'Controls.cs'),(Join-Path $PSScriptRoot 'StartupCheckDialog.cs')) -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions
[BetterCodex.StartupCheckDialog]::EnableDpiAwareness()
[Windows.Forms.Application]::EnableVisualStyles()
$words = $script:BetterCodexMessages.($script:BetterCodexLanguage) | ConvertTo-Json -Compress
$state = if ($Preview) { $PreviewState } else { '' }
$theme = if ($Preview -and $PreviewTheme -ne 'auto') { $PreviewTheme } else { '' }
[BetterCodex.StartupCheckDialog]::Run($SettingsPath, (Join-Path $PSScriptRoot '../../../tools/token-hud-local/diagnostics/checks.py'), $words,
    $script:BetterCodexLanguage, $state, $theme, [bool]$AfterUpdate)
