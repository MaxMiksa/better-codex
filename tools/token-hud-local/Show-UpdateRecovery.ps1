param([ValidateSet('Countdown','Failed')][string]$Mode = 'Countdown', [switch]$Preview,
    [ValidateRange(1,30)][int]$Seconds = 30,
    [ValidateSet('auto','light','dark')][string]$PreviewTheme = 'auto')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'shared/i18n.ps1')
if (-not [Environment]::UserInteractive) { exit 3 }
if ($Mode -eq 'Failed') {
    $popup = New-Object -ComObject WScript.Shell
    $popup.Popup((Get-BetterCodexText 'recovery.failed'), 30, 'Better-Codex', 48) | Out-Null
    exit 0
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
Add-Type -Path (Join-Path $PSScriptRoot 'shared/RecoveryDialog.cs') -ReferencedAssemblies System.Windows.Forms,System.Drawing
$fontFamily = if ($script:BetterCodexLanguage -eq 'zh-CN') { 'Microsoft YaHei UI' } else { 'Segoe UI' }
$form = [BetterCodex.RecoveryDialog]::new((Get-BetterCodexText 'recovery.title'),
    (Get-BetterCodexText 'recovery.description'), (Get-BetterCodexText 'recovery.cancel'),
    (Get-BetterCodexText 'recovery.restartNow'), (Get-BetterCodexText 'recovery.close'), $fontFamily)
$remaining = $form.Remaining
$cancel = $form.Cancel

# The interface may be unavailable here, so read Codex's saved appearance locally.
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$settingsPath = Join-Path $workspace '.runtime/token-hud/embedded/settings.json'
$settings = $null
try { $settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { }
$codexHome = Join-Path $env:USERPROFILE '.codex'
if ($settings.codexHome) { $codexHome = $settings.codexHome }
$configPath = Join-Path $codexHome 'config.toml'

function Update-RecoveryAppearance {
    $dark = $false
    try {
        $personalize = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
        $dark = $personalize.AppsUseLightTheme -eq 0
    } catch { }
    $stamp = "$dark|$((Get-Item -LiteralPath $configPath -ErrorAction SilentlyContinue).LastWriteTimeUtc.Ticks)"
    if ($stamp -eq $script:appearanceStamp) { return }
    $script:appearanceStamp = $stamp
    $surface = if ($dark) { '#111111' } else { '#ffffff' }
    if ($Preview -and $PreviewTheme -ne 'auto') {
        $dark = $PreviewTheme -eq 'dark'
        $surface = if ($dark) { '#111111' } else { '#ffffff' }
    } elseif ($settings.python) {
        try {
            $appearance = & $settings.python -B -X utf8 (Join-Path $PSScriptRoot 'shared/recovery_appearance.py') $configPath 2>$null | ConvertFrom-Json
            if ($LASTEXITCODE -eq 0 -and $appearance.surface -match '^#[0-9a-fA-F]{6}$') {
                $dark = $appearance.dark -eq $true
                $surface = $appearance.surface
            }
        } catch { } # A theme read failure must not prevent cancelling the dialog.
    }
    $form.ApplyAppearance($dark, $surface)
}
Update-RecoveryAppearance
$script:remainingSeconds = $Seconds
$remaining.Text = Get-BetterCodexText 'recovery.countdown' @{count=$script:remainingSeconds}
$form.RestartNow.Add_Click({
    $script:restartRequested = $true
    $timer.Stop()
    $form.Close()
})
$script:restartRequested = $false
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 1000
$timer.Add_Tick({
    Update-RecoveryAppearance
    # Count displayed ticks, so suspension does not silently use up the countdown.
    $script:remainingSeconds--
    $remaining.Text = Get-BetterCodexText 'recovery.countdown' @{count=$script:remainingSeconds}
    if ($script:remainingSeconds -le 0) {
        $script:restartRequested = $true
        $timer.Stop()
        $form.Close()
    }
})
$form.Add_Shown({ $cancel.Focus(); $timer.Start() })
try { $null = $form.ShowDialog() }
finally { $timer.Dispose(); $form.Dispose() }
if ($script:restartRequested) { exit 0 }
exit 2
