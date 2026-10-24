param([ValidateSet('Prepare','Check','Apply','Finalize')][string]$Mode = 'Apply', [switch]$Wait)
# Stable compatibility command; no business logic here.
. (Join-Path $PSScriptRoot '../../src/lifecycle/installation/Repair-WorkspacePaths.ps1') @PSBoundParameters
