param(
    [Parameter(Mandatory)][string]$NshExe,
    [Parameter(Mandatory)][string]$OutputDir
)
$ErrorActionPreference = 'Stop'
$nshCommand = (Get-Item -LiteralPath $NshExe).FullName
if ([IO.Path]::GetFileName($nshCommand) -ine 'nsh.exe') { throw 'Use the official nsh.exe.' }
$nshRunner = Join-Path (Split-Path (Split-Path $nshCommand)) 'runtime\windows\nsh-windows-app.exe'
if (!(Test-Path -LiteralPath $nshRunner -PathType Leaf)) { throw 'The official prebuilt Windows runner must be present.' }
$nshLicense = Join-Path (Split-Path (Split-Path $nshCommand)) 'LICENSE-APACHE'
if (!(Test-Path -LiteralPath $nshLicense -PathType Leaf)) { throw 'The official NSH license file must be present.' }
$nshOutput = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDir)
if (Test-Path -LiteralPath $nshOutput) { throw 'Choose a new output directory.' }
$nshSource = Join-Path $PSScriptRoot '..\src\interface\workspace_tree\preview'
$nshOldPath = $env:Path
Push-Location -LiteralPath $nshSource
try {
    $env:Path = "$env:SystemRoot\System32;$env:SystemRoot"
    if (Get-Command cargo,rustc -CommandType Application -ErrorAction SilentlyContinue) {
        throw 'The packaging environment must not have Rust tools on PATH.'
    }
    $nshVersion = & $nshCommand --version
    if ($LASTEXITCODE -ne 0 -or $nshVersion -notmatch '\b0\.7\.2\b') { throw "Expected NSH 0.7.2, got: $nshVersion" }
    & $nshCommand package --target windows -o $nshOutput
    if ($LASTEXITCODE -ne 0) { throw 'NSH packaging failed.' }
    $nshProduct = Join-Path $nshOutput 'BetterCodexPreview'
    Copy-Item -LiteralPath $nshLicense -Destination (Join-Path $nshProduct 'NSH-LICENSE-APACHE.txt')
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../LICENSE') -Destination (Join-Path $nshProduct 'LICENSE.txt')
    'Better Codex Preview bundles the prebuilt Windows runner from NSH v0.7.2 (Longbridge, Apache-2.0). Source: https://github.com/longbridge/nsh/tree/v0.7.2' |
        Set-Content -LiteralPath (Join-Path $nshProduct 'THIRD-PARTY-NOTICE.txt') -Encoding UTF8
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $nshZip = [IO.Compression.ZipFile]::Open((Join-Path $nshOutput 'BetterCodexPreview.zip'), [IO.Compression.ZipArchiveMode]::Update)
    try {
        $nshPrefix = ($nshZip.Entries | Where-Object Name -eq 'BetterCodexPreview.exe' | Select-Object -First 1).FullName
        $nshPrefix = $nshPrefix.Substring(0,$nshPrefix.Length - 'BetterCodexPreview.exe'.Length)
        foreach ($nshDoc in 'NSH-LICENSE-APACHE.txt','LICENSE.txt','THIRD-PARTY-NOTICE.txt') {
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($nshZip,(Join-Path $nshProduct $nshDoc),$nshPrefix+$nshDoc) | Out-Null
        }
    } finally { $nshZip.Dispose() }
} finally {
    Pop-Location
    $env:Path = $nshOldPath
}
