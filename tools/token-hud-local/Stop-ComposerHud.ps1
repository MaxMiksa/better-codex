. (Join-Path $PSScriptRoot 'shared/i18n.ps1')
$runtime = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../.runtime/token-hud/embedded/runtime'))
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
Set-Content -LiteralPath (Join-Path $runtime 'stop') -Value ''
Write-Output (Get-BetterCodexText 'stop.requested')
