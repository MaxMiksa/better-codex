param(
    [string]$NodeExecutable,
    [ValidateRange(1024,65535)][int]$DisplayPort = 19163,
    [ValidateSet('auto','en','zh-CN')][string]$Language = 'auto',
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
if ($Language -ne 'auto') { $env:BETTER_CODEX_LANGUAGE = $Language }
. (Join-Path $PSScriptRoot 'src/platform/i18n/i18n.ps1')
$bundled = Join-Path $PSScriptRoot 'runtime/node/node.exe'
$bootstrap = Join-Path $PSScriptRoot 'src/app/portable-bootstrap.cjs'
$mode = if ($CheckOnly) { '--check' } else { '--prepare-only' }
$nodeArguments = @('--no-warnings=ExperimentalWarning', $bootstrap, $mode)
if (Test-Path -LiteralPath $bundled -PathType Leaf) {
    $node = $bundled
} else {
    $preferred = $NodeExecutable
    if ($preferred -and -not [IO.Path]::IsPathRooted($preferred)) {
        try { $preferred = (Get-Command $preferred -CommandType Application -ErrorAction Stop).Source }
        catch { throw (Get-BetterCodexText 'install.nodeMissing') }
    }
    if ($NodeExecutable -and -not (Test-Path -LiteralPath $preferred -PathType Leaf)) { throw (Get-BetterCodexText 'install.nodeMissing') }
    if (-not $preferred) {
        try { $preferred = (Get-Content -LiteralPath (Get-BetterCodexSettingsPath -ReadLegacy) -Raw -Encoding UTF8 | ConvertFrom-Json).node } catch { }
    }
    try { $node = Resolve-BetterCodexNode $preferred } catch { throw (Get-BetterCodexText 'install.nodeMissing') }
    $nodeArguments += @('--source-install','--node',$node)
}
if ($PSBoundParameters.ContainsKey('DisplayPort') -and -not $CheckOnly) { $nodeArguments += @('--port',"$DisplayPort") }
& $node @nodeArguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
