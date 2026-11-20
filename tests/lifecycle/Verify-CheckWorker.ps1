param([Parameter(Mandatory=$true)][string]$WorkDirectory)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$work = [IO.Path]::GetFullPath($WorkDirectory)
if (-not $work.StartsWith((Join-Path $root '.validation-runtime/'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Work must be isolated' }
New-Item -ItemType Directory -Path $work -Force | Out-Null
Add-Type -AssemblyName System.Windows.Forms,System.Drawing,System.Web.Extensions
Add-Type -Path @((Join-Path $root 'src/lifecycle/diagnostics/Controls.cs'), (Join-Path $root 'src/lifecycle/diagnostics/StartupCheckDialog.cs')) -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions
$catalog = Get-Content -LiteralPath (Join-Path $root 'src/platform/i18n/messages.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$words = $catalog.'zh-CN' | ConvertTo-Json -Compress
$type = [BetterCodex.StartupCheckDialog]
$flags = [Reflection.BindingFlags]'Instance,NonPublic'
$checks = [Collections.Generic.List[string]]::new()
function Assert-Worker($Name, $Condition) {
    if (-not $Condition) { throw "Failed: $Name" }
    $checks.Add($Name)
}
function Set-Field($Dialog, $Name, $Value) { $type.GetField($Name,$flags).SetValue($Dialog,$Value) }
function Get-Field($Dialog, $Name) { $type.GetField($Name,$flags).GetValue($Dialog) }
foreach ($scenario in @('early-exit','blocked-read-timeout','completed-at-deadline')) {
    # Never show a window or invoke production checks/recovery. Exercise the real
    # timer with only an owned child and a synthetic report in the work directory.
    $dialog = [BetterCodex.StartupCheckDialog]::new((Join-Path $work 'settings.json'), (Join-Path $work 'unused.py'), $words, 'zh-CN', '', 'dark', $null, $null, $false)
    $process = $null; $reader = $null
    try {
        $report = $type.GetMethod('Initial',$flags).Invoke($dialog,@('pending',''))
        $report.rows[2].state = 'pass'; $report.rows[2].detail = 'fixture passed'
        Set-Field $dialog 'current' $report
        Set-Field $dialog 'started' ([DateTime]::UtcNow)
        $output = Join-Path $work ($scenario + '.json')
        Set-Field $dialog 'outputPath' $output
        $command = if ($scenario -eq 'blocked-read-timeout') { 'Start-Sleep -Seconds 30' } else { 'exit 7' }
        $start = [Diagnostics.ProcessStartInfo]::new((Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'), ('-NoProfile -NonInteractive -WindowStyle Hidden -Command "' + $command + '"'))
        $start.UseShellExecute = $false; $start.CreateNoWindow = $true
        $process = [Diagnostics.Process]::Start($start)
        Set-Field $dialog 'worker' $process
        if ($scenario -ne 'blocked-read-timeout') { $process.WaitForExit() }
        if ($scenario -eq 'blocked-read-timeout') {
            [IO.File]::WriteAllText($output, '{}')
            $reader = [IO.FileStream]::new($output,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
        }
        if ($scenario -eq 'completed-at-deadline') {
            $complete = $type.GetMethod('Initial',$flags).Invoke($dialog,@('pass','fixture complete'))
            $complete.state = 'healthy'; $complete.title = $catalog.'zh-CN'.'check.healthy'
            [IO.File]::WriteAllText($output, ($complete | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
        }
        if ($scenario -ne 'early-exit') { Set-Field $dialog 'started' ([DateTime]::UtcNow.AddSeconds(-49)) }
        $null = $type.GetMethod('Tick',$flags).Invoke($dialog,@($null,[EventArgs]::Empty))
        $result = Get-Field $dialog 'current'
        if ($scenario -eq 'completed-at-deadline') {
            Assert-Worker 'final-report-read-before-exit-and-deadline-decision' ($result.state -eq 'healthy')
        } else {
            $expected = if ($scenario -eq 'early-exit') { $catalog.'zh-CN'.'check.workerStopped'.Replace('{code}','7') } else { $catalog.'zh-CN'.'check.workerTimeout' }
            Assert-Worker ($scenario + '-reason') ($result.rows[0].detail -eq $expected)
            Assert-Worker ($scenario + '-preserves-completed-row') ($result.rows[2].state -eq 'pass' -and $result.rows[2].detail -eq 'fixture passed')
            Assert-Worker ($scenario + '-leaves-unfinished-management-unconfirmed') ($result.managementRows[0].state -eq 'unknown')
        }
        Assert-Worker ($scenario + '-releases-owned-worker') ($null -eq (Get-Field $dialog 'worker'))
    } finally {
        if ($reader) { $reader.Dispose() }
        $null = $type.GetMethod('StopOwnWorker',$flags).Invoke($dialog,@())
        (Get-Field $dialog 'timer').Dispose()
        $dialog.Dispose()
    }
}
$dialog = [BetterCodex.StartupCheckDialog]::new((Join-Path $work 'settings.json'), (Join-Path $work 'unused.py'), $words, 'zh-CN', '', 'dark', $null, $null, $false)
try {
    $report = $type.GetMethod('Initial',$flags).Invoke($dialog,@('pending',''))
    $null = $type.GetMethod('SetReport',$flags).Invoke($dialog,@($report))
    $originalRows = @(Get-Field $dialog 'rows')
    $originalHandles = @($originalRows | ForEach-Object { $_.Handle })
    $report.rows[0].state = 'fail'; $report.rows[0].status = 'fixture failed'
    $report.rows[0].detail = 'updated detail'; $report.rows[0].suggestion = 'fixture suggestion'
    $null = $type.GetMethod('SetReport',$flags).Invoke($dialog,@($report))
    $updatedRows = Get-Field $dialog 'rows'
    Assert-Worker 'refresh-keeps-eight-rows' ($updatedRows.Count -eq 8)
    for ($i = 0; $i -lt $originalRows.Count; $i++) {
        Assert-Worker ('refresh-preserves-row-and-handle-' + $i) ([object]::ReferenceEquals($originalRows[$i],$updatedRows[$i]) -and $originalHandles[$i] -eq $updatedRows[$i].Handle)
    }
    Assert-Worker 'refresh-updates-visible-text' (@($updatedRows[0].Controls | Where-Object { $_.Text -eq 'updated detail' }).Count -eq 1)
    Assert-Worker 'refresh-updates-suggestion' (@($updatedRows[0].Controls | Where-Object { $_.Text -eq 'fixture suggestion' }).Count -eq 1)
    Assert-Worker 'refresh-updates-report' ($dialog.ReportText().Contains('updated detail'))
    $report.rows[0].suggestion = ''
    $null = $type.GetMethod('SetReport',$flags).Invoke($dialog,@($report))
    Assert-Worker 'refresh-clears-old-suggestion' (@($updatedRows[0].Controls | Where-Object { $_.Text -eq 'fixture suggestion' }).Count -eq 0)
    Set-Field $dialog 'fontDpi' 0
    $null = $type.GetMethod('SetReport',$flags).Invoke($dialog,@($report))
    Assert-Worker 'dpi-change-rebuilds-and-disposes-old-rows' ($originalRows[0].IsDisposed -and -not [object]::ReferenceEquals($originalRows[0],(Get-Field $dialog 'rows')[0]))
    $first = [BetterCodex.StartupCheckRowData]::new()
    $first.id = 'enhancements'; $first.label = $catalog.'zh-CN'.'check.enhancements'; $first.state = 'notApplicable'; $first.status = $catalog.'zh-CN'.'check.pass'; $first.detail = $catalog.'zh-CN'.'check.hudWaiting'
    $extra = [BetterCodex.StartupCheckRowData]::new()
    $extra.label = $catalog.'zh-CN'.'check.runtime'; $extra.status = $catalog.'zh-CN'.'check.pass'; $extra.detail = $catalog.'zh-CN'.'check.runtimeDependenciesReady'
    foreach ($state in @('pass','warning','unknown','fail','notApplicable')) {
        $extra.state = $state
        $merged = $type.GetMethod('MergeRow',$flags).Invoke($dialog,@($first,$extra,$catalog.'zh-CN'.'check.enhancementsAndRuntime'))
        Assert-Worker ('enhancement-summary-preserves-' + $state) ($merged.state -eq $state)
        Assert-Worker ('enhancement-evidence-remains-not-applicable-' + $state) ($first.state -eq 'notApplicable')
        if ($state -ne 'pass') { continue }
        foreach ($dark in @($true,$false)) {
            $row = [BetterCodex.StartupCheckRow]::new($merged,'Microsoft YaHei UI',$false,1)
            try {
                $background = if ($dark) { [Drawing.Color]::FromArgb(34,34,34) } else { [Drawing.Color]::White }
                $expected = if ($dark) { [Drawing.Color]::FromArgb(111,218,130) } else { [Drawing.Color]::FromArgb(30,120,49) }
                $row.Arrange(504,$false); $row.ApplyAppearance($dark,$background)
                $status = @($row.Controls | Where-Object { $_ -is [BetterCodex.StartupStatusLabel] })[0]
                Assert-Worker ('normal-enhancement-text-and-dot-green-' + $dark) ($status.ForeColor -eq $expected -and $status.DotColor -eq $expected)
                $bitmap = [Drawing.Bitmap]::new($row.Width,$row.Height)
                try {
                    $row.DrawToBitmap($bitmap,[Drawing.Rectangle]::new(0,0,$row.Width,$row.Height))
                    $bitmap.Save((Join-Path $work ('enhancement-green-' + $dark + '.png')))
                } finally { $bitmap.Dispose() }
            } finally { $row.Dispose() }
        }
    }
} finally {
    (Get-Field $dialog 'timer').Dispose()
    $dialog.Dispose()
}
# Exercise automatic window closure without running probes or recovery.
$dialog = [BetterCodex.StartupCheckDialog]::new((Join-Path $work 'settings.json'), (Join-Path $work 'unused.py'), $words, 'zh-CN', 'Healthy', 'dark', $null, $null, $false)
try {
    $report = $type.GetMethod('PreviewReport',$flags).Invoke($dialog,@())
    $null = $type.GetMethod('SetReport',$flags).Invoke($dialog,@($report))
    Assert-Worker 'healthy-result-arms-auto-close' (Get-Field $dialog 'autoCloseArmed')
    Set-Field $dialog 'autoCloseElapsed' ([double]29)
    $null = $type.GetMethod('SetReport',$flags).Invoke($dialog,@($report))
    Assert-Worker 'report-refresh-preserves-auto-close-progress' ((Get-Field $dialog 'autoCloseElapsed') -eq 29)
    foreach ($state in @('pending','unknown','warning','fail')) {
        $report.managementRows[0].state = $state
        $null = $type.GetMethod('SetReport',$flags).Invoke($dialog,@($report))
        Assert-Worker ('unfinished-or-problem-row-blocks-auto-close-' + $state) (-not (Get-Field $dialog 'autoCloseArmed'))
    }
    $report.managementRows[0].state = 'notApplicable'
    $null = $type.GetMethod('SetReport',$flags).Invoke($dialog,@($report))
    Assert-Worker 'not-applicable-does-not-block-auto-close' (Get-Field $dialog 'autoCloseArmed')
    $report.relaunch.needed = $true
    $null = $type.GetMethod('SetReport',$flags).Invoke($dialog,@($report))
    Assert-Worker 'recovery-needed-blocks-auto-close' (-not (Get-Field $dialog 'autoCloseArmed'))
    $report.relaunch.needed = $false
    Set-Field $dialog 'reloading' $true
    $null = $type.GetMethod('SetReport',$flags).Invoke($dialog,@($report))
    Assert-Worker 'recovery-in-progress-blocks-auto-close' (-not (Get-Field $dialog 'autoCloseArmed'))
    Set-Field $dialog 'reloading' $false
    $null = $type.GetMethod('StartCheck',$flags).Invoke($dialog,@())
    Assert-Worker 'recheck-starts-fresh-auto-close' ((Get-Field $dialog 'autoCloseArmed') -and (Get-Field $dialog 'autoCloseElapsed') -eq 0)
    Set-Field $dialog 'autoCloseElapsed' ([double]29)
    Set-Field $dialog 'autoCloseTick' ([long]([Diagnostics.Stopwatch]::GetTimestamp() - 60 * [Diagnostics.Stopwatch]::Frequency))
    $null = $type.GetMethod('Tick',$flags).Invoke($dialog,@($null,[EventArgs]::Empty))
    Assert-Worker 'suspend-does-not-consume-auto-close-delay' (-not $dialog.IsDisposed -and (Get-Field $dialog 'autoCloseElapsed') -le 29.25)
    for ($i = 0; $i -lt 4; $i++) {
        Set-Field $dialog 'autoCloseTick' ([long]([Diagnostics.Stopwatch]::GetTimestamp() - [Diagnostics.Stopwatch]::Frequency))
        $null = $type.GetMethod('Tick',$flags).Invoke($dialog,@($null,[EventArgs]::Empty))
    }
    Assert-Worker 'healthy-window-closes-at-thirty-seconds' $dialog.IsDisposed
} finally {
    if (-not $dialog.IsDisposed) { (Get-Field $dialog 'timer').Dispose(); $dialog.Dispose() }
}
# Exercise the real terminal-history handoff without running a diagnostic probe.
$history = Join-Path $work 'history-fixture'
[IO.Directory]::CreateDirectory($history) | Out-Null
$settings = Join-Path $history 'settings.json'
$python = (Get-Command python -ErrorAction Stop).Source
@{python=$python} | ConvertTo-Json | Set-Content -LiteralPath $settings -Encoding utf8
$scriptPath = Join-Path $root 'tools/token-hud-local/diagnostics/checks.py'
$dialog = [BetterCodex.StartupCheckDialog]::new($settings, $scriptPath, $words, 'zh-CN', '', 'dark', $null, $null, $false)
try {
    $report = $type.GetMethod('Initial',$flags).Invoke($dialog,@('pending',''))
    $report.correlation_id = [Guid]::NewGuid().ToString('N')
    $session = Join-Path $history ([Guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($session) | Out-Null
    Set-Field $dialog 'current' $report
    Set-Field $dialog 'python' $python
    Set-Field $dialog 'sessionDirectory' $session
    Set-Field $dialog 'outputPath' (Join-Path $session 'result.json')
    $null = $type.GetMethod('RecordWorkerEnd',$flags).Invoke($dialog,@('workerTimeout'))
    $deadline = [DateTime]::UtcNow.AddSeconds(8)
    do {
        Start-Sleep -Milliseconds 100
        $found = & (Join-Path $root 'tools/token-hud-local/Get-RuntimeHistory.ps1') -SettingsPath $settings -Kind diagnostic-completed -CorrelationId $report.correlation_id | ConvertFrom-Json
    } while (-not $found.events.Count -and [DateTime]::UtcNow -lt $deadline)
    Assert-Worker 'terminal-handoff-records-once-without-probing' ($found.events.Count -eq 1)
    Assert-Worker 'terminal-handoff-keeps-ten-underlying-checks' ($found.events[0].payload.checks.Count -eq 10)
    Assert-Worker 'terminal-handoff-retains-timeout-reason' ($found.events[0].payload.checks[0].codes[0] -eq 'workerTimeout')
    Assert-Worker 'terminal-handoff-does-not-create-launch-receipt' (-not (Test-Path -LiteralPath (Join-Path $history 'runtime/launch-receipt.json')))
} finally {
    (Get-Field $dialog 'timer').Dispose()
    $dialog.Dispose()
}
# Check real window state with synthetic reports and no runnable worker.
Add-Type 'public static class TestStartupWindow {
    [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr hwnd);
    [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
}'
$refresh = [Threading.AutoResetEvent]::new($false)
$update = [Threading.AutoResetEvent]::new($false)
$dialog = [BetterCodex.StartupCheckDialog]::new((Join-Path $work 'missing-settings.json'), '', $words, 'zh-CN', '', 'dark', $refresh, $update, $false)
try {
    $dialog.Show()
    [Windows.Forms.Application]::DoEvents()
    (Get-Field $dialog 'timer').Stop()
    Assert-Worker 'checking-starts-minimized' ([TestStartupWindow]::IsIconic($dialog.Handle))
    Assert-Worker 'minimized-start-does-not-activate' ([TestStartupWindow]::GetForegroundWindow() -ne $dialog.Handle)
    $pending = Get-Field $dialog 'current'
    $pending.rows[0].state = 'warning'
    $null = $type.GetMethod('SetReport',$flags).Invoke($dialog,@($pending))
    Assert-Worker 'incomplete-result-stays-minimized' ([TestStartupWindow]::IsIconic($dialog.Handle))
    $healthy = $type.GetMethod('Initial',$flags).Invoke($dialog,@('pass','fixture'))
    $healthy.state = 'healthy'
    $null = $type.GetMethod('SetReport',$flags).Invoke($dialog,@($healthy))
    Assert-Worker 'healthy-result-stays-minimized-and-arms-close' (([TestStartupWindow]::IsIconic($dialog.Handle)) -and (Get-Field $dialog 'autoCloseArmed'))
    $null = $refresh.Set()
    $null = $type.GetMethod('Tick',$flags).Invoke($dialog,@($null,[EventArgs]::Empty))
    Assert-Worker 'repeat-entry-rechecks-without-restoring' ([TestStartupWindow]::IsIconic($dialog.Handle) -and (Get-Field $dialog 'current').state -eq 'checking')
    $healthy.managementRows[0].state = 'warning'
    $null = $type.GetMethod('SetReport',$flags).Invoke($dialog,@($healthy))
    Assert-Worker 'completed-warning-restores-without-activation' ($dialog.WindowState -eq 'Normal' -and -not [TestStartupWindow]::IsIconic($dialog.Handle) -and [TestStartupWindow]::GetForegroundWindow() -ne $dialog.Handle)
    $dialog.WindowState = 'Minimized'
    $null = $type.GetMethod('SetReport',$flags).Invoke($dialog,@($healthy))
    Assert-Worker 'same-problem-refresh-does-not-restore-again' ([TestStartupWindow]::IsIconic($dialog.Handle))
} finally {
    $dialog.Close()
    $refresh.Dispose()
    $update.Dispose()
}
@{passed=$checks.Count;checks=@($checks)} | ConvertTo-Json
