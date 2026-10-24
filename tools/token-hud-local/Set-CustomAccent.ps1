param([ValidateSet('Enable','Disable','Status')][string]$Mode = 'Status')
# Stable compatibility command; no business logic here.
. (Join-Path $PSScriptRoot '../../src/interface/appearance/Set-CustomAccent.ps1') @PSBoundParameters
