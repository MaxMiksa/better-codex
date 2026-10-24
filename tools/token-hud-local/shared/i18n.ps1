param([string]$MessageKey, [switch]$Wait)
# Stable compatibility command; no business logic here.
. (Join-Path $PSScriptRoot '../../../src/platform/i18n/i18n.ps1') @PSBoundParameters
