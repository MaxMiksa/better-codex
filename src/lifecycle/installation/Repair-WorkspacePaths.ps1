param([ValidateSet('Prepare','Check','Apply','Finalize')][string]$Mode = 'Apply', [switch]$Wait)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../platform/i18n/i18n.ps1')
$workspace = $script:BetterCodexRoot
$runtime = Join-Path $workspace '.runtime/token-hud/embedded'
$exitCode = 1
$mutex = [Threading.Mutex]::new($false, 'Local\BetterCodexWorkspaceRename')
$held = $false
try {
    try { $held = $mutex.WaitOne(15000) } catch [Threading.AbandonedMutexException] { $held = $true }
    if (-not $held) { throw 'rename-already-in-progress' }
    $settings = Get-Content -LiteralPath (Join-Path $runtime 'settings.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $python = $settings.python
    $planPath = Join-Path $runtime 'workspace-rename/plan.json'
    if (-not (Test-Path -LiteralPath $python) -and (Test-Path -LiteralPath $planPath)) {
        $plan = Get-Content -LiteralPath $planPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $prefix = $plan.previousRoot.TrimEnd('\') + '\'
        if ($python.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
            $python = Join-Path $workspace $python.Substring($prefix.Length)
        }
    }
    $output = & $python -B -X utf8 (Join-Path $PSScriptRoot '../../../tools/token-hud-local/workspace_relocation.py') --mode $Mode.ToLowerInvariant()
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
