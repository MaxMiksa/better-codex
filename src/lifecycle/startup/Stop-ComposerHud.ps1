. (Join-Path $PSScriptRoot '../../platform/i18n/i18n.ps1')
$ErrorActionPreference = 'Stop'
$preferred = $null
try { $preferred = (Get-Content -LiteralPath (Get-BetterCodexSettingsPath -ReadLegacy) -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json).node } catch { }
$node = Resolve-BetterCodexNode $preferred
$receipt = & $node --no-warnings=ExperimentalWarning (Join-Path $script:BetterCodexRoot 'src/app/portable-bootstrap.cjs') --stop | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output $receipt.message
