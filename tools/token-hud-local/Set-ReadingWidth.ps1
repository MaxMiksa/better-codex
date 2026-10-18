param([ValidateSet('Wide','Default')][string]$Mode = 'Wide')
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$settingsPath = Join-Path $workspace '.runtime/token-hud/embedded/settings.json'
$settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
$settings | Add-Member -NotePropertyName readingWidth -NotePropertyValue $Mode.ToLowerInvariant() -Force
$temporary = "$settingsPath.next"
[IO.File]::WriteAllText($temporary, ($settings | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath $temporary -Destination $settingsPath -Force
Write-Output "Reading width: $Mode. Applied automatically while the HUD is connected."
