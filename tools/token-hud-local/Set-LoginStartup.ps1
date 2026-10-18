param([ValidateSet('Enable','Disable','Status')][string]$Mode = 'Status')
$ErrorActionPreference = 'Stop'
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
    throw 'Startup shortcut belongs to another target; refusing to replace or remove it.'
}
if ($Mode -eq 'Enable') {
    if (-not (Test-Path -LiteralPath $source) -or -not (Test-Path -LiteralPath $wrapper)) {
        throw 'HUD launcher missing. Restore the existing entry before enabling login startup.'
    }
    if (-not (Test-OwnedShortcut $source)) { throw 'Project shortcut does not match the HUD entry.' }
    [IO.Directory]::CreateDirectory($startup) | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
} elseif ($Mode -eq 'Disable' -and (Test-Path -LiteralPath $destination)) {
    Remove-Item -LiteralPath $destination
}

$present = Test-Path -LiteralPath $destination
$approval = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder' -Name 'Codex with HUD.lnk' -ErrorAction SilentlyContinue
$approvalBytes = $approval.'Codex with HUD.lnk'
[pscustomobject]@{
    shortcutPresent = $present
    owned = $present -and (Test-OwnedShortcut $destination)
    path = $destination
    windowsApprovalState = $(if ($approvalBytes) { [int]$approvalBytes[0] } else { $null })
} | ConvertTo-Json
