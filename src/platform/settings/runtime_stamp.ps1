param([string]$SettingsPath)
. (Join-Path $PSScriptRoot '../paths.ps1')

function Get-BetterCodexRuntimeStamp($Settings) {
    $workspace = $script:BetterCodexRoot
    $manifest = Get-Content -LiteralPath (Join-Path $workspace 'release/public-files.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $files = @($manifest.runtime | Where-Object { $_ -like 'src/*' -and $_ -match '\.(py|ps1|cjs|js|json)$' }) +
        @('VERSION','tools/token-hud-local/embedded/supervisor.py')
    $hash = [Security.Cryptography.SHA256]::Create()
    try {
        $parts = @($files | Sort-Object | ForEach-Object {
            $_ + ':' + [BitConverter]::ToString($hash.ComputeHash([IO.File]::ReadAllBytes((Join-Path $workspace $_))))
        })
        foreach ($key in @('python','node','playwright','collectorDir','port')) { $parts += $key + ':' + $Settings.$key }
        return [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes(($parts -join "`n")))).Replace('-','')
    } finally { $hash.Dispose() }
}

if ($SettingsPath) {
    $ErrorActionPreference = 'Stop'
    Get-BetterCodexRuntimeStamp (Get-Content -LiteralPath $SettingsPath -Raw -Encoding UTF8 | ConvertFrom-Json)
}
