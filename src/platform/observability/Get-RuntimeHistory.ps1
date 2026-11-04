param([string]$Since, [string]$Until, [string]$Kind, [string]$Source,
    [string]$CorrelationId, [ValidateRange(1,1000)][int]$Limit = 100,
    [string]$SettingsPath, [string]$Runtime)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
if (-not $SettingsPath) { $SettingsPath = Join-Path $root '.runtime/token-hud/embedded/settings.json' }
if (-not $Runtime) { $Runtime = Join-Path (Split-Path -Parent $SettingsPath) 'runtime' }
try {
    $settings = Get-Content -LiteralPath $SettingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $arguments = @('-B','-X','utf8','-c','import sys; sys.path.insert(0, sys.argv.pop(1)); from src.platform.observability.cli import main; raise SystemExit(main())', $root, '--runtime', $Runtime, 'query', '--limit', "$Limit")
    foreach ($entry in @(@('since',$Since),@('until',$Until),@('kind',$Kind),@('source',$Source),@('correlation-id',$CorrelationId))) {
        if ($entry[1]) { $arguments += @("--$($entry[0])", $entry[1]) }
    }
    & $settings.python @arguments
} catch {
    '{"schema_version":1,"ok":false,"error_category":"query_runtime_unavailable","events":[],"health":{"state":"unknown"},"coverage":{"retention_days":5,"since":null,"until":null,"continuous":false,"note":"query_runtime_unavailable"},"truncated":false}'
}
