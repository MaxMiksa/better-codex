# Shared installation identity; legacy files are only read during cutover.
$script:BetterCodexRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))

function Get-BetterCodexSettingsPath([switch]$ReadLegacy) {
    $new = Join-Path $script:BetterCodexRoot '.runtime/settings.json'
    if ($ReadLegacy -and -not (Test-Path -LiteralPath $new)) {
        $old = Join-Path $script:BetterCodexRoot '.runtime/token-hud/embedded/settings.json'
        if (Test-Path -LiteralPath $old) { return $old }
    }
    return $new
}

function Get-BetterCodexStatePath([string]$SettingsPath) {
    $dir = Split-Path -Parent $SettingsPath
    return Join-Path $dir $(if ((Split-Path -Leaf $dir) -eq '.runtime') { 'state' } else { 'runtime' })
}

function Resolve-BetterCodexNode([string]$Preferred) {
    $bundled = Join-Path $script:BetterCodexRoot 'runtime/node/node.exe'
    foreach ($candidate in @($Preferred,$bundled)) {
        if ($candidate -and [IO.Path]::IsPathRooted($candidate) -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
    }
    return (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
}

function Initialize-BetterCodexSettings {
    $target = Get-BetterCodexSettingsPath
    $source = Get-BetterCodexSettingsPath -ReadLegacy
    if ($source -ne $target) {
        $config = Get-Content -LiteralPath $source -Raw -Encoding UTF8 | ConvertFrom-Json
        $node = Resolve-BetterCodexNode $config.node
        if (Test-Path -LiteralPath (Join-Path $script:BetterCodexRoot '.runtime/token-hud/embedded/runtime/launcher.json')) {
            & $node --no-warnings=ExperimentalWarning (Join-Path $script:BetterCodexRoot 'src/app/portable-bootstrap.cjs') --guard-legacy | Out-Null
            if ($LASTEXITCODE -ne 0) { throw (Get-BetterCodexText 'launch.dependencyMissing') }
        }
        & $node --no-warnings=ExperimentalWarning (Join-Path $script:BetterCodexRoot 'src/platform/settings/settings-store.cjs') --migrate | Out-Null
        if ($LASTEXITCODE -ne 0) { throw (Get-BetterCodexText 'settings.saveFailed') }
    }
    return $target
}
