param([string]$Since, [string]$Until, [string]$Kind, [string]$Source,
    [string]$CorrelationId, [ValidateRange(1,1000)][int]$Limit = 100,
    [string]$SettingsPath, [string]$Runtime)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../paths.ps1')
if (-not $SettingsPath) { $SettingsPath = Get-BetterCodexSettingsPath -ReadLegacy }
if (-not $Runtime) { $Runtime = Get-BetterCodexStatePath $SettingsPath }
try {
    $settings = Get-Content -LiteralPath $SettingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $arguments = @('--no-warnings=ExperimentalWarning',(Join-Path $PSScriptRoot 'cli.cjs'), '--runtime', $Runtime, 'query', '--limit', "$Limit")
    foreach ($entry in @(@('since',$Since),@('until',$Until),@('kind',$Kind),@('source',$Source),@('correlation-id',$CorrelationId))) {
        if ($entry[1]) { $arguments += @("--$($entry[0])", $entry[1]) }
    }
    $node = Resolve-BetterCodexNode $settings.node
    & $node @arguments
} catch {
    '{"schema_version":1,"ok":false,"error_category":"query_runtime_unavailable","events":[],"health":{"state":"unknown"},"coverage":{"retention_days":5,"since":null,"until":null,"continuous":false,"note":"query_runtime_unavailable"},"truncated":false}'
}
