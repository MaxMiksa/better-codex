param([ValidateSet('Enable','Disable','Status')][string]$Mode = 'Status')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'shared/i18n.ps1')
. (Join-Path $PSScriptRoot 'shared/administrator_launch.ps1')
. (Join-Path $PSScriptRoot 'shared/settings_store.ps1')
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$settingsPath = Join-Path $workspace '.runtime/token-hud/embedded/settings.json'
$runtime = Join-Path (Split-Path -Parent $settingsPath) 'runtime'
$settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($Mode -eq 'Enable') {
    # Establish the current version before enabling: this is never permission to
    # restart an ordinary instance that was already running during installation.
    $null = & $settings.python -B -X utf8 (Join-Path $PSScriptRoot 'embedded/update_recovery.py') --initialize --settings $settingsPath --runtime $runtime
    if ($LASTEXITCODE -ne 0) { throw (Get-BetterCodexText 'settings.saveFailed') }
    Update-BetterCodexSettings $settingsPath @{recoverAfterUpdate=$true}
} elseif ($Mode -eq 'Disable') {
    Update-BetterCodexSettings $settingsPath @{recoverAfterUpdate=$false}
}
$settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
$result = @{enabled=$settings.recoverAfterUpdate -eq $true;countdownSeconds=15;message=(Get-BetterCodexText "recovery.$($Mode.ToLowerInvariant())")}
if ($Mode -eq 'Enable') {
    if ($settings.runAsAdministrator -eq $true) {
        $result.monitorRequest = Invoke-BetterCodexAdministratorTask 'Monitor'
    } else {
        . (Join-Path $PSScriptRoot 'Start-ComposerHud.ps1') -FunctionsOnly
        $result.supervisorPid = Start-ComposerSupervisor $settings $settingsPath $runtime
    }
}
$statePath = Join-Path $runtime 'update-recovery.json'
if (Test-Path -LiteralPath $statePath) { $result.state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json }
$result | ConvertTo-Json -Depth 5
