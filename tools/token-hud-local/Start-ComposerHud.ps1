param([switch]$CheckOnly, [switch]$FunctionsOnly, [switch]$AdministratorTask, [switch]$RecoveryActivation, [switch]$StartupCheckStarted,
    [ValidateSet('Launch','Check','Monitor','Reload')][string]$TaskMode = 'Launch')
# Stable compatibility command; no business logic here.
. (Join-Path $PSScriptRoot '../../src/app/Start-ComposerHud.ps1') @PSBoundParameters
