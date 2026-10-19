[CmdletBinding()]
param(
    [string]$PythonExecutable = 'python',
    [string]$NodeExecutable = 'node',
    [ValidateRange(1024,65535)][int]$DisplayPort = 19163,
    [switch]$CheckOnly,
    [switch]$SkipDependencies,
    [string]$PlaywrightPath,
    [ValidateSet('auto','en','zh-CN')][string]$Language = 'auto'
)
$ErrorActionPreference = 'Stop'
if ($Language -ne 'auto') { $env:BETTER_CODEX_LANGUAGE = $Language }
. (Join-Path $PSScriptRoot 'tools/token-hud-local/shared/i18n.ps1')
$workspace = $PSScriptRoot
$runtime = Join-Path $workspace '.runtime/token-hud/embedded'
$settingsPath = Join-Path $runtime 'settings.json'
$bundledPython = Join-Path $workspace 'runtime/python/python.exe'
if (Test-Path -LiteralPath $bundledPython) {
    $mode = $(if ($CheckOnly) { '--check' } else { '--prepare-only' })
    & $bundledPython -B -X utf8 (Join-Path $workspace 'tools/token-hud-local/portable_bootstrap.py') $mode
    if ($LASTEXITCODE -ne 0) { throw (Get-BetterCodexText 'install.portableFailed') }
    return
}
try { $basePython = (Get-Command $PythonExecutable -CommandType Application -ErrorAction Stop).Source }
catch { throw (Get-BetterCodexText 'install.pythonMissing') }
try { $node = (Get-Command $NodeExecutable -CommandType Application -ErrorAction Stop).Source }
catch { throw (Get-BetterCodexText 'install.nodeMissing') }
& $basePython -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'
if ($LASTEXITCODE -ne 0) { throw (Get-BetterCodexText 'install.pythonVersion') }
$nodeVersion = & $node --version
if ($LASTEXITCODE -ne 0 -or [int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 20) { throw (Get-BetterCodexText 'install.nodeVersion') }
$package = & $basePython -B -X utf8 (Join-Path $workspace 'tools/token-hud-local/shared/desktop_package.py') | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $package.executable) { throw (Get-BetterCodexText 'install.codexMissing') }
if ($CheckOnly) {
    [pscustomobject]@{python=$basePython;node=$node;codexVersion=$package.packageVersion;writesPerformed=$false;locale=$script:BetterCodexLanguage;message=(Get-BetterCodexText 'install.checkReady')} | ConvertTo-Json
    return
}
$launcher = Join-Path $runtime 'runtime/launcher.json'
if (Test-Path -LiteralPath $launcher) {
    $previous = Get-Content -LiteralPath $launcher -Raw -Encoding UTF8 | ConvertFrom-Json
    $running = Get-Process -Id $previous.supervisorPid -ErrorAction SilentlyContinue
    if ($running -and $running.StartTime.ToUniversalTime() -eq ([DateTimeOffset]$previous.startedAt).UtcDateTime) {
        throw (Get-BetterCodexText 'install.running')
    }
}
if ($SkipDependencies) {
    $python = $basePython
    & $python -c 'import psutil, win32com.client'
    if ($LASTEXITCODE -ne 0) { throw (Get-BetterCodexText 'install.pythonModules') }
    if (-not $PlaywrightPath) { throw (Get-BetterCodexText 'install.playwrightPath') }
} else {
    $pythonHome = Join-Path $workspace '.runtime/token-hud/python'
    $python = Join-Path $pythonHome 'Scripts/python.exe'
    if (-not (Test-Path -LiteralPath $python)) {
        & $basePython -m venv $pythonHome
        if ($LASTEXITCODE -ne 0) { throw (Get-BetterCodexText 'install.venvFailed') }
    }
    & $python -m pip install --disable-pip-version-check -r (Join-Path $workspace 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw (Get-BetterCodexText 'install.pythonFailed') }
    $npm = Join-Path (Split-Path -Parent $node) 'npm.cmd'
    if (-not (Test-Path -LiteralPath $npm)) {
        try { $npm = (Get-Command npm.cmd -CommandType Application -ErrorAction Stop).Source }
        catch { throw (Get-BetterCodexText 'install.npmMissing') }
    }
    $nodeHome = Join-Path $workspace '.runtime/token-hud/node'
    $packageInfo = Get-Content -LiteralPath (Join-Path $workspace 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    & $npm install --prefix $nodeHome --ignore-scripts --no-audit --no-fund --package-lock=false "playwright@$($packageInfo.dependencies.playwright)"
    if ($LASTEXITCODE -ne 0) { throw (Get-BetterCodexText 'install.playwrightFailed') }
    $PlaywrightPath = Join-Path $nodeHome 'node_modules/playwright'
}
& $node -e 'require(process.argv[1]).chromium || process.exit(1)' $PlaywrightPath
if ($LASTEXITCODE -ne 0) { throw (Get-BetterCodexText 'install.playwrightMissing') }
[IO.Directory]::CreateDirectory($runtime) | Out-Null
$codexHome = $(if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' })
$settings = @{port=$DisplayPort;python=$python;node=$node;playwright=[IO.Path]::GetFullPath($PlaywrightPath);codexHome=$codexHome;collectorDir=(Join-Path $workspace 'tools/token-hud-local/collector')}
Add-Type -AssemblyName System.Drawing
$icon = [Drawing.Icon]::ExtractAssociatedIcon($package.executable)
if (-not $icon) { throw (Get-BetterCodexText 'install.iconFailed') }
$iconStream = [IO.File]::Create((Join-Path $runtime 'codex.ico'))
try { $icon.Save($iconStream) } finally { $iconStream.Dispose(); $icon.Dispose() }
$encodedSettings = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($settings | ConvertTo-Json -Compress)))
& $python -I -X utf8 (Join-Path $workspace 'tools/token-hud-local/shared/settings_store.py') --file $settingsPath --patch-base64 $encodedSettings --create
if ($LASTEXITCODE -ne 0) { throw (Get-BetterCodexText 'settings.saveFailed') }
& $python -B -X utf8 (Join-Path $workspace 'tools/token-hud-local/install_taskbar_entry.py')
if ($LASTEXITCODE -ne 0) { throw (Get-BetterCodexText 'install.shortcutFailed') }
Write-Output (Get-BetterCodexText 'install.complete')
