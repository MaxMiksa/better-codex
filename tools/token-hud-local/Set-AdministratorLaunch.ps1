param([ValidateSet('Enable','Disable','Status','Verify')][string]$Mode = 'Status', [string]$Report)
# Stable compatibility command; no business logic here.
. (Join-Path $PSScriptRoot '../../src/lifecycle/startup/Set-AdministratorLaunch.ps1') @PSBoundParameters
