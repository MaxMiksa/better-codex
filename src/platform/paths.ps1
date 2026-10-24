# Shared installation identity; preserve the existing settings/state locations.
$script:BetterCodexRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
