param([string]$SettingsPath, [switch]$FunctionsOnly)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../platform/i18n/i18n.ps1')
function Add-EntryResult($Code, $State) { $parts.Add(@{code=$Code;state=$State}) }
function Get-ExpectedWrapperContent($Workspace) {
    $template = [IO.File]::ReadAllText((Join-Path $Workspace 'tools/token-hud-local/start-composer.vbs')).Replace("`r`n", "`n")
    return $template.Replace('@POWERSHELL@', (Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe')).Replace('@SCRIPT@', (Join-Path $Workspace 'tools/token-hud-local/Start-ComposerHud.ps1'))
}
function Test-WrapperContent($Path, $Expected) {
    return (Test-Path -LiteralPath $Path) -and [IO.File]::ReadAllText($Path).Replace("`r`n", "`n") -eq $Expected
}
function Test-Entry($Path, $Allowed) {
    $link = $shell.CreateShortcut($Path)
    if ($link.TargetPath -ne (Join-Path $env:WINDIR 'System32/wscript.exe') -or
        $link.Arguments -notin @($Allowed | ForEach-Object { '"{0}"' -f $_ })) { return $false }
    # ExtendedProperty reads the existing shortcut, never saves or creates it.
    $folder = (New-Object -ComObject Shell.Application).Namespace((Split-Path -Parent $Path))
    return $folder.ParseName((Split-Path -Leaf $Path)).ExtendedProperty('System.AppUserModel.ID') -eq $expectedId
}
function Get-NativeStartupResult([bool]$ManagedLoginEnabled) {
    # Read the current Codex package's known App startup task. Never change its
    # Windows-owned registration or interpret missing/unreadable state as disabled.
    $path = 'HKCU:\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\SystemAppData\OpenAI.Codex_2p2nqsd0c76g0\App'
    try {
        $state = (Get-ItemProperty -LiteralPath $path -Name State -ErrorAction Stop).State
        if ($state -in @(2,4)) {
            if ($ManagedLoginEnabled) { return @{code='entryNativeConflict';state='warning'} }
            return @{code='entryNativeEnabled';state='notApplicable'}
        }
        if ($null -ne $state -and $state -in @(0,1,3)) { return @{code='entryNativeDisabled';state='pass'} }
    } catch { }
    return @{code='entryNativeUnknown';state='unknown'}
}
if ($FunctionsOnly) { return }
$settings = Get-Content -LiteralPath $SettingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
$workspace = $script:BetterCodexRoot
$shell = New-Object -ComObject WScript.Shell
$wrapper = Join-Path $workspace '.runtime/token-hud/embedded/start-composer.vbs'
$compat = Join-Path $workspace '.runtime/hud/service/start-embedded.vbs'
$expectedId = 'OpenAI.Codex_2p2nqsd0c76g0!App'
$parts = [Collections.Generic.List[object]]::new()
$project = Join-Path $workspace 'launchers/Codex.lnk'
if (-not (Test-Path -LiteralPath $project)) { Add-EntryResult 'entryProjectMissing' 'warning' }
elseif (-not (Test-Entry $project @($wrapper))) { Add-EntryResult 'entryProjectChanged' 'warning' }
else { Add-EntryResult 'entryProjectReady' 'pass' }
if (-not (Test-Path -LiteralPath $wrapper) -or -not (Test-Path -LiteralPath $compat)) { Add-EntryResult 'entryWrapperMissing' 'warning' }
elseif (-not (Test-WrapperContent $wrapper (Get-ExpectedWrapperContent $workspace)) -or -not (Test-WrapperContent $compat (Get-ExpectedWrapperContent $workspace))) { Add-EntryResult 'entryWrapperChanged' 'warning' }
$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'Codex with HUD.lnk'
$managedLoginEnabled = $false
if (-not (Test-Path -LiteralPath $startup)) { Add-EntryResult 'entryLoginDisabled' 'notApplicable' }
elseif (-not (Test-Entry $startup @($wrapper))) { Add-EntryResult 'entryLoginUnmanaged' 'unknown' }
else {
    $approval = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder' -Name 'Codex with HUD.lnk' -ErrorAction SilentlyContinue
    $bytes = $approval.'Codex with HUD.lnk'
    if ($bytes -and $bytes[0] -in @(3,7)) { Add-EntryResult 'entryLoginBlocked' 'warning' }
    elseif (-not $bytes -or $bytes[0] -in @(2,6)) {
        Add-EntryResult 'entryLoginReady' 'pass'
        $managedLoginEnabled = $true
    }
    else { Add-EntryResult 'entryLoginUnknown' 'unknown' }
}
$parts.Add((Get-NativeStartupResult $managedLoginEnabled))
$pinned = Join-Path $env:APPDATA 'Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar'
$links = @(Get-ChildItem -LiteralPath $pinned -Filter 'Codex*.lnk' -ErrorAction SilentlyContinue)
if (-not $links.Count) { Add-EntryResult 'entryPinAbsent' 'notApplicable' }
else {
    $owned = @($links | Where-Object { Test-Entry $_.FullName @($wrapper,$compat) })
    Add-EntryResult $(if ($owned.Count) { 'entryPinReady' } else { 'entryPinUnmanaged' }) $(if ($owned.Count) { 'pass' } else { 'notApplicable' })
}
Add-EntryResult 'entryScope' 'notApplicable'
$parts | ConvertTo-Json -Compress
