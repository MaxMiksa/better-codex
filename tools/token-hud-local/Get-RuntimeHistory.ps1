param([string]$Since, [string]$Until, [string]$Kind, [string]$Source,
    [string]$CorrelationId, [ValidateRange(1,1000)][int]$Limit = 100,
    [string]$SettingsPath, [string]$Runtime)
# Stable command; storage and query behavior live in platform.
. (Join-Path $PSScriptRoot '../../src/platform/observability/Get-RuntimeHistory.ps1') @PSBoundParameters
