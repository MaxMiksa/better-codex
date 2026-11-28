param([ValidateSet('Prepare','Check','Apply','Finalize')][string]$Mode = 'Apply', [switch]$Wait)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../platform/i18n/i18n.ps1')
$workspace = $script:BetterCodexRoot
$settingsPath = Get-BetterCodexSettingsPath -ReadLegacy
$exitCode = 1
$mutex = [Threading.Mutex]::new($false, 'Local\BetterCodexWorkspaceRename')
$held = $false
try {
    try { $held = $mutex.WaitOne(15000) } catch [Threading.AbandonedMutexException] { $held = $true }
    if (-not $held) { throw 'rename-already-in-progress' }
    $settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $node = $settings.node
    $planPath = Join-Path (Get-BetterCodexStatePath (Get-BetterCodexSettingsPath)) 'workspace-rename/plan.json'
    if (-not (Test-Path -LiteralPath $planPath)) {
        $planPath = Join-Path $workspace '.runtime/token-hud/embedded/workspace-rename/plan.json'
    }
    if ($node -and -not (Test-Path -LiteralPath $node) -and (Test-Path -LiteralPath $planPath)) {
        $plan = Get-Content -LiteralPath $planPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $prefix = $plan.previousRoot.TrimEnd('\') + '\'
        if ($node.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
            $node = Join-Path $workspace $node.Substring($prefix.Length)
        }
    }
    $node = Resolve-BetterCodexNode $node
    $output = & $node --no-warnings=ExperimentalWarning (Join-Path $PSScriptRoot 'workspace-relocation.cjs') --mode $Mode.ToLowerInvariant()
    $exitCode = $LASTEXITCODE
    $result = $output | ConvertFrom-Json
    Write-Output $result.message
    if ($result.reason) { Write-Output $result.reason }
} catch {
    $exitCode = 1
    Write-Output (Get-BetterCodexText 'rename.failed')
    Write-Output $_.Exception.GetType().Name
} finally {
    if ($held) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
    if ($Wait) { Read-Host (Get-BetterCodexText 'pressEnter') | Out-Null }
}
exit $exitCode
