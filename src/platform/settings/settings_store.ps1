function Update-BetterCodexSettings([string]$Path, [hashtable]$Patch) {
    $current = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    # Use the same kernel lock and read/merge/write operation as the controller.
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($Patch | ConvertTo-Json -Compress)))
    $node = Resolve-BetterCodexNode $current.node
    & $node --no-warnings=ExperimentalWarning (Join-Path $PSScriptRoot 'settings-store.cjs') --file $Path --patch-base64 $encoded
    if ($LASTEXITCODE -ne 0) { throw (Get-BetterCodexText 'settings.saveFailed') }
}
