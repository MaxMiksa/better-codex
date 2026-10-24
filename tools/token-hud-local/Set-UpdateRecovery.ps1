param([ValidateSet('Enable','Disable','Status')][string]$Mode = 'Status')
# Stable compatibility command; no business logic here.
. (Join-Path $PSScriptRoot '../../src/lifecycle/recovery/Set-UpdateRecovery.ps1') @PSBoundParameters
