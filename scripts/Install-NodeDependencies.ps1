[CmdletBinding()]
param(
    [string]$NodeExecutable = 'node',
    [string]$PnpmExecutable = 'pnpm',
    [string]$NodeHome = (Join-Path (Split-Path -Parent $PSScriptRoot) '.runtime/token-hud/node'),
    [switch]$Offline
)
$ErrorActionPreference = 'Stop'
$node = (Get-Command $NodeExecutable -CommandType Application -ErrorAction Stop).Source
$pnpm = (Get-Command $PnpmExecutable -CommandType Application -ErrorAction Stop).Source
$nodeVersion = & $node --version
if ($LASTEXITCODE -ne 0 -or [version]($nodeVersion.TrimStart('v')) -lt [version]'24.11.1' -or [version]($nodeVersion.TrimStart('v')) -ge [version]'25.0.0') {
    throw 'Node.js 24.11.1 or later in the 24.x line is required.'
}
$pnpmVersion = & $pnpm --pm-on-fail=error --version
if ($LASTEXITCODE -ne 0 -or $pnpmVersion.Trim() -ne '12.16.1') {
    throw 'pnpm 12.16.1 is required. Select it with -PnpmExecutable; global tools are not changed.'
}
$source = Join-Path $PSScriptRoot 'node'
$manifest = Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$product = Get-Content -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.dependencies.playwright -ne $product.devDependencies.playwright) {
    throw 'The product and locked Node runtime must use the same Playwright version.'
}
[IO.Directory]::CreateDirectory($NodeHome) | Out-Null
foreach ($name in @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml')) {
    Copy-Item -LiteralPath (Join-Path $source $name) -Destination (Join-Path $NodeHome $name) -Force
}
$arguments = @('--pm-on-fail=error', '--dir', [IO.Path]::GetFullPath($NodeHome), 'install', '--frozen-lockfile', '--ignore-scripts', '--node-linker', 'hoisted')
if ($Offline) { $arguments += '--offline' }
& $pnpm @arguments
if ($LASTEXITCODE -ne 0) { throw 'The frozen Node dependency installation failed.' }
$playwright = Join-Path $NodeHome 'node_modules/playwright'
& $node -e 'require(process.argv[1]).chromium || process.exit(1)' $playwright
if ($LASTEXITCODE -ne 0) { throw 'The installed Playwright dependency could not be loaded.' }
[pscustomobject]@{node=$node;pnpm=$pnpmVersion.Trim();playwright=[IO.Path]::GetFullPath($playwright);offline=[bool]$Offline} | ConvertTo-Json -Compress
