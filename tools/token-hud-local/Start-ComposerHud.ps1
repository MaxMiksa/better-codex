param([switch]$CheckOnly, [switch]$FunctionsOnly, [switch]$RecoveryActivation, [switch]$StartupCheckStarted, [string]$CorrelationId,
    [ValidateSet('Launch','Monitor','Reload')][string]$TaskMode = 'Launch')
# Stable compatibility command; no business logic here.
. (Join-Path $PSScriptRoot '../../src/app/Start-ComposerHud.ps1') @PSBoundParameters
