param([ValidateSet('Enable','Disable','Status')][string]$Mode = 'Status')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'shared/i18n.ps1')
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$startup = [Environment]::GetFolderPath('Startup')
$destination = Join-Path $startup 'Codex with HUD.lnk'
$source = Join-Path $workspace 'launchers/Codex.lnk'
$wrapper = Join-Path $workspace '.runtime/token-hud/embedded/start-composer.vbs'
$expectedTarget = Join-Path $env:WINDIR 'System32/wscript.exe'
$expectedArguments = '"{0}"' -f $wrapper
$shell = New-Object -ComObject WScript.Shell

function Test-OwnedShortcut([string]$Path) {
    $link = $shell.CreateShortcut($Path)
    return $link.TargetPath -eq $expectedTarget -and $link.Arguments -eq $expectedArguments
}

if ((Test-Path -LiteralPath $destination) -and -not (Test-OwnedShortcut $destination)) {
    throw (Get-BetterCodexText 'startup.unowned')
}
if ($Mode -eq 'Enable') {
    if (-not (Test-Path -LiteralPath $source) -or -not (Test-Path -LiteralPath $wrapper)) {
        throw (Get-BetterCodexText 'startup.missing')
    }
    if (-not (Test-OwnedShortcut $source)) { throw (Get-BetterCodexText 'startup.mismatch') }
    [IO.Directory]::CreateDirectory($startup) | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
} elseif ($Mode -eq 'Disable' -and (Test-Path -LiteralPath $destination)) {
    Remove-Item -LiteralPath $destination
}

$present = Test-Path -LiteralPath $destination
$approval = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder' -Name 'Codex with HUD.lnk' -ErrorAction SilentlyContinue
$approvalBytes = $approval.'Codex with HUD.lnk'
[pscustomobject]@{
    locale = $script:BetterCodexLanguage
    message = Get-BetterCodexText $(if ($Mode -eq 'Enable') { 'startup.enabled' } elseif ($Mode -eq 'Disable') { 'startup.disabled' } elseif ($present) { 'startup.present' } else { 'startup.absent' })
    shortcutPresent = $present
    owned = $present -and (Test-OwnedShortcut $destination)
    path = $destination
    windowsApprovalState = $(if ($approvalBytes) { [int]$approvalBytes[0] } else { $null })
} | ConvertTo-Json
