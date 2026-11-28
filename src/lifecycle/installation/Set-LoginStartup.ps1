param([ValidateSet('Enable','Disable','Status')][string]$Mode = 'Status')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../platform/i18n/i18n.ps1')
$workspace = $script:BetterCodexRoot
$startup = Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs/Startup'
$destination = Join-Path $startup 'Codex with HUD.lnk'
$source = Join-Path $workspace 'launchers/Codex.lnk'
$wrapper = Join-Path $workspace '.runtime/launchers/start-better-codex.vbs'
$expectedTarget = Join-Path $env:WINDIR 'System32/wscript.exe'
$expectedArguments = '"{0}"' -f $wrapper
$helper = Join-Path $workspace 'src/generated/native/BetterCodexNative.exe'

function Test-OwnedShortcut([string]$Path) {
    $receipt = & $helper shortcut-inspect --path $Path | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or -not $receipt.ok) { return $false }
    $link = $receipt.shortcut
    $allowed = @($expectedArguments, ('"{0}"' -f (Join-Path $workspace '.runtime/token-hud/embedded/start-composer.vbs')),
        ('"{0}"' -f (Join-Path $workspace '.runtime/hud/service/start-embedded.vbs')))
    return $link.target -eq $expectedTarget -and $link.arguments -in $allowed -and
        $link.appId -in @('OpenAI.Codex_2p2nqsd0c76g0!App','com.openai.codex')
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
