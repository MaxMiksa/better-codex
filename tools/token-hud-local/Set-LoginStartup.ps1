param([ValidateSet('Enable','Disable','Status')][string]$Mode = 'Status')
# Stable compatibility command; no business logic here.
. (Join-Path $PSScriptRoot '../../src/lifecycle/installation/Set-LoginStartup.ps1') @PSBoundParameters
