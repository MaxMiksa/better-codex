param([switch]$Preview, [switch]$AfterUpdate,
    [ValidateSet('Healthy','Failed','Checking','Partial','Enhancements','Updated')][string]$PreviewState = 'Healthy',
    [ValidateSet('auto','light','dark')][string]$PreviewTheme = 'auto',
    [string]$SettingsPath)
# Stable compatibility command; no business logic here.
. (Join-Path $PSScriptRoot '../../src/lifecycle/diagnostics/Show-StartupCheck.ps1') @PSBoundParameters
