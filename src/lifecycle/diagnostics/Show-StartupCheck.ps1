param([switch]$Preview, [switch]$AfterUpdate,
    [ValidateSet('Healthy','Failed','Checking','Partial','Enhancements','Updated','Busy','UnknownActivity')][string]$PreviewState = 'Healthy',
    [ValidateSet('auto','light','dark')][string]$PreviewTheme = 'auto',
    [string]$SettingsPath)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../platform/i18n/i18n.ps1')
if (-not [Environment]::UserInteractive) { exit 3 }
if (-not $SettingsPath) {
    if ($Preview) { $SettingsPath = Get-BetterCodexSettingsPath }
    else { $SettingsPath = Initialize-BetterCodexSettings }
}
$preferred = $null
if (Test-Path -LiteralPath $SettingsPath) {
    try { $preferred = (Get-Content -LiteralPath $SettingsPath -Raw -Encoding UTF8 | ConvertFrom-Json).node } catch { }
}
$nodePath = $null
try { $nodePath = Resolve-BetterCodexNode $preferred } catch { }
Add-Type -AssemblyName System.Windows.Forms,System.Drawing,System.Web.Extensions
Add-Type -Path @((Join-Path $PSScriptRoot 'Controls.cs'),(Join-Path $PSScriptRoot 'StartupCheckDialog.cs')) -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions
[BetterCodex.StartupCheckDialog]::EnableDpiAwareness()
[Windows.Forms.Application]::EnableVisualStyles()
$words = $script:BetterCodexMessages.($script:BetterCodexLanguage) | ConvertTo-Json -Compress
$state = if ($Preview) { $PreviewState } else { '' }
$theme = if ($Preview -and $PreviewTheme -ne 'auto') { $PreviewTheme } else { '' }
[BetterCodex.StartupCheckDialog]::Run($SettingsPath, (Join-Path $PSScriptRoot '../../app/startup-diagnostics.cjs'), $nodePath, $words,
    $script:BetterCodexLanguage, $state, $theme, [bool]$AfterUpdate)
