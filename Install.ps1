[CmdletBinding()]
param(
    [string]$PythonExecutable = 'python',
    [string]$NodeExecutable = 'node',
    [ValidateRange(1024,65535)][int]$DisplayPort = 19163,
    [switch]$CheckOnly,
    [switch]$SkipDependencies,
    [string]$PlaywrightPath
)
$ErrorActionPreference = 'Stop'
$workspace = $PSScriptRoot
$runtime = Join-Path $workspace '.runtime/token-hud/embedded'
$settingsPath = Join-Path $runtime 'settings.json'
$bundledPython = Join-Path $workspace 'runtime/python/python.exe'
if (Test-Path -LiteralPath $bundledPython) {
    $mode = $(if ($CheckOnly) { '--check' } else { '--prepare-only' })
    & $bundledPython -B -X utf8 (Join-Path $workspace 'tools/token-hud-local/portable_bootstrap.py') $mode
    if ($LASTEXITCODE -ne 0) { throw 'Portable preparation failed. Extract the full portable ZIP again.' }
    return
}
$basePython = (Get-Command $PythonExecutable -CommandType Application -ErrorAction Stop).Source
$node = (Get-Command $NodeExecutable -CommandType Application -ErrorAction Stop).Source
& $basePython -c 'import sys; assert sys.version_info >= (3, 11), "Python 3.11 or newer is required"'
if ($LASTEXITCODE -ne 0) { throw 'Python 3.11 or newer is required. Pass -PythonExecutable with its path.' }
$nodeVersion = & $node --version
if ($LASTEXITCODE -ne 0 -or [int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 20) { throw 'Node.js 20 or newer is required.' }
$package = & $basePython -B -X utf8 (Join-Path $workspace 'tools/token-hud-local/shared/desktop_package.py') | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $package.executable) { throw 'Install the official Codex Windows Store app first.' }
if ($CheckOnly) {
    [pscustomobject]@{python=$basePython;node=$node;codexVersion=$package.packageVersion;writesPerformed=$false} | ConvertTo-Json
    return
}
$launcher = Join-Path $runtime 'runtime/launcher.json'
if (Test-Path -LiteralPath $launcher) {
    $previous = Get-Content -LiteralPath $launcher -Raw -Encoding UTF8 | ConvertFrom-Json
    $running = Get-Process -Id $previous.supervisorPid -ErrorAction SilentlyContinue
    if ($running -and $running.StartTime.ToUniversalTime() -eq ([DateTimeOffset]$previous.startedAt).UtcDateTime) {
        throw 'This HUD is running. Run Stop.cmd, wait for it to stop, then install again. Keep Codex open.'
    }
}
if ($SkipDependencies) {
    $python = $basePython
    & $python -c 'import psutil, win32com.client'
    if ($LASTEXITCODE -ne 0) { throw 'The supplied Python needs psutil and pywin32.' }
    if (-not $PlaywrightPath) { throw '-SkipDependencies requires -PlaywrightPath.' }
} else {
    $pythonHome = Join-Path $workspace '.runtime/token-hud/python'
    $python = Join-Path $pythonHome 'Scripts/python.exe'
    if (-not (Test-Path -LiteralPath $python)) {
        & $basePython -m venv $pythonHome
        if ($LASTEXITCODE -ne 0) { throw 'Unable to create the private Python environment.' }
    }
    & $python -m pip install --disable-pip-version-check -r (Join-Path $workspace 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
    $npm = Join-Path (Split-Path -Parent $node) 'npm.cmd'
    if (-not (Test-Path -LiteralPath $npm)) { $npm = (Get-Command npm.cmd -CommandType Application -ErrorAction Stop).Source }
    $nodeHome = Join-Path $workspace '.runtime/token-hud/node'
    $packageInfo = Get-Content -LiteralPath (Join-Path $workspace 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    & $npm install --prefix $nodeHome --ignore-scripts --no-audit --no-fund --package-lock=false "playwright@$($packageInfo.dependencies.playwright)"
    if ($LASTEXITCODE -ne 0) { throw 'Playwright installation failed.' }
    $PlaywrightPath = Join-Path $nodeHome 'node_modules/playwright'
}
& $node -e 'require(process.argv[1]).chromium || process.exit(1)' $PlaywrightPath
if ($LASTEXITCODE -ne 0) { throw 'Playwright is unavailable.' }
[IO.Directory]::CreateDirectory($runtime) | Out-Null
$codexHome = $(if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' })
$settings = @{port=$DisplayPort;python=$python;node=$node;playwright=[IO.Path]::GetFullPath($PlaywrightPath);codexHome=$codexHome;collectorDir=(Join-Path $workspace 'tools/token-hud-local/collector')}
if (Test-Path -LiteralPath $settingsPath) {
    $current = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($null -ne $current.readingWidth) { $settings.readingWidth = $current.readingWidth }
}
Add-Type -AssemblyName System.Drawing
$icon = [Drawing.Icon]::ExtractAssociatedIcon($package.executable)
if (-not $icon) { throw 'Unable to read the installed Codex icon.' }
$iconStream = [IO.File]::Create((Join-Path $runtime 'codex.ico'))
try { $icon.Save($iconStream) } finally { $iconStream.Dispose(); $icon.Dispose() }
[IO.File]::WriteAllText("$settingsPath.next", ($settings | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath "$settingsPath.next" -Destination $settingsPath -Force
& $python -B -X utf8 (Join-Path $workspace 'tools/token-hud-local/install_taskbar_entry.py')
if ($LASTEXITCODE -ne 0) { throw 'Shortcut setup failed.' }
Write-Output 'Installed. Open launchers\Codex.lnk to start. Codex has not been restarted; login startup is unchanged.'
