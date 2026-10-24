param([string]$MessageKey, [switch]$Wait)
. (Join-Path $PSScriptRoot '../paths.ps1')

function ConvertTo-BetterCodexLanguage([string]$Value) {
    if ($Value.Trim().Replace('_','-') -match '^zh($|-(cn|sg|hans)(-|$))') { return 'zh-CN' }
    return 'en'
}

function Get-BetterCodexLanguage {
    if ($env:BETTER_CODEX_LANGUAGE -and $env:BETTER_CODEX_LANGUAGE -ne 'auto') {
        return ConvertTo-BetterCodexLanguage $env:BETTER_CODEX_LANGUAGE
    }
    try {
        if (-not ('BetterCodexUiLanguage' -as [type])) {
            Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class BetterCodexUiLanguage {
    [DllImport("kernel32.dll")] public static extern ushort GetUserDefaultUILanguage();
}
'@
        }
        return ConvertTo-BetterCodexLanguage ([Globalization.CultureInfo]::GetCultureInfo([int][BetterCodexUiLanguage]::GetUserDefaultUILanguage()).Name)
    } catch { return ConvertTo-BetterCodexLanguage ([Globalization.CultureInfo]::CurrentUICulture.Name) }
}

$script:BetterCodexLanguage = Get-BetterCodexLanguage
$script:BetterCodexMessages = $null
try {
    $script:BetterCodexMessages = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'messages.json')) | ConvertFrom-Json
} catch { } # Translation failure must not prevent official Codex activation.
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Get-BetterCodexText([string]$Key, [hashtable]$Values = @{}) {
    $message = $script:BetterCodexMessages.($script:BetterCodexLanguage).$Key
    if (-not $message) { $message = $script:BetterCodexMessages.en.$Key }
    if (-not $message) { return $Key }
    foreach ($name in $Values.Keys) { $message = $message.Replace('{'+$name+'}', [string]$Values[$name]) }
    return $message
}

if ($MessageKey) {
    Write-Output (Get-BetterCodexText $MessageKey)
    if ($Wait) { Read-Host (Get-BetterCodexText 'pressEnter') | Out-Null }
}
