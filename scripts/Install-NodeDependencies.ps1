[CmdletBinding()]
param(
    [string]$NodeExecutable = 'node',
    [string]$PnpmExecutable = 'pnpm',
    [string]$NodeHome = (Join-Path (Split-Path -Parent $PSScriptRoot) '.validation-runtime/test-node'),
    [switch]$Offline
)
$ErrorActionPreference = 'Stop'
$node = (Get-Command $NodeExecutable -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$pnpm = (Get-Command $PnpmExecutable -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$nodeVersion = & $node --version
if ($LASTEXITCODE -ne 0 -or [version]($nodeVersion.TrimStart('v')) -lt [version]'24.11.1' -or [version]($nodeVersion.TrimStart('v')) -ge [version]'25.0.0') {
    throw 'Node.js 24.11.1 or later in the 24.x line is required.'
}
$pnpmVersion = & $pnpm --pm-on-fail=error --version
if ($LASTEXITCODE -ne 0 -or $pnpmVersion.Trim() -ne '12.16.1') {
    throw 'pnpm 12.16.1 is required. Select it with -PnpmExecutable; global tools are not changed.'
}
$root = Split-Path -Parent $PSScriptRoot
$prefix = [IO.Path]::GetFullPath($NodeHome)
foreach ($name in @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'scripts/node/package.json', 'scripts/workspace-tree/package.json')) {
    $destination = Join-Path $prefix $name
    [IO.Directory]::CreateDirectory((Split-Path -Parent $destination)) | Out-Null
    if ($prefix -ne $root) {
        Copy-Item -LiteralPath (Join-Path $root $name) -Destination $destination -Force
    }
}
$arguments = @('--pm-on-fail=error', '--dir', $prefix, 'install', '--frozen-lockfile', '--ignore-scripts', '--node-linker', 'hoisted')
if ($Offline) { $arguments += '--offline' }
& $pnpm @arguments
if ($LASTEXITCODE -ne 0) { throw 'The frozen Node dependency installation failed.' }
$playwright = @('node_modules/playwright', 'scripts/node/node_modules/playwright') |
    ForEach-Object { Join-Path $prefix $_ } |
    Where-Object { Test-Path -LiteralPath (Join-Path $_ 'package.json') } |
    Select-Object -First 1
if (-not $playwright) { throw 'The installed Playwright dependency could not be found.' }
& $node -e 'require(process.argv[1]).chromium || process.exit(1)' $playwright
if ($LASTEXITCODE -ne 0) { throw 'The installed Playwright dependency could not be loaded.' }
[pscustomobject]@{node=$node;pnpm=$pnpmVersion.Trim();playwright=[IO.Path]::GetFullPath($playwright);offline=[bool]$Offline} | ConvertTo-Json -Compress
