param([ValidateSet('Wide','Default')][string]$Mode = 'Wide')
# Stable compatibility command; no business logic here.
. (Join-Path $PSScriptRoot '../../src/interface/reading/Set-ReadingWidth.ps1') @PSBoundParameters
