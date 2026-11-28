param([string]$SettingsPath)
. (Join-Path $PSScriptRoot '../paths.ps1')

function Get-BetterCodexRuntimeStamp($Settings) {
    $workspace = $script:BetterCodexRoot
    $sourceRoot = Join-Path $workspace 'src'
    $excludedDirs = @('prompts', 'evidence', 'files', 'private', 'archive', 'dist', 'runtime', 'node_modules', '__pycache__', 'bin', 'obj', 'native')
    $sourceDirs = [Collections.Generic.Stack[string]]::new()
    $sourceDirs.Push($sourceRoot)
    $files = @(while ($sourceDirs.Count) {
        foreach ($entry in Get-ChildItem -LiteralPath ($sourceDirs.Pop())) {
            if ($entry.Name.StartsWith('.') -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) { continue }
            if ($entry.PSIsContainer) {
                if ($entry.Name -notin $excludedDirs) { $sourceDirs.Push($entry.FullName) }
            } elseif ($entry.Name -match '\.(ps1|cjs|mjs|js|json)$') {
                $entry.FullName.Substring($workspace.Length + 1).Replace('\','/')
            }
        }
    }) + @('package.json','src/generated/native/BetterCodexNative.exe')
    $hash = [Security.Cryptography.SHA256]::Create()
    try {
        $parts = @($files | Sort-Object | ForEach-Object {
            $_ + ':' + [BitConverter]::ToString($hash.ComputeHash([IO.File]::ReadAllBytes((Join-Path $workspace $_))))
        })
        foreach ($key in @('node','port','codexHome')) { $parts += $key + ':' + $Settings.$key }
        return [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes(($parts -join "`n")))).Replace('-','')
    } finally { $hash.Dispose() }
}

if ($SettingsPath) {
    $ErrorActionPreference = 'Stop'
    Get-BetterCodexRuntimeStamp (Get-Content -LiteralPath $SettingsPath -Raw -Encoding UTF8 | ConvertFrom-Json)
}
