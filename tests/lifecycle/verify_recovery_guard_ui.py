"""Inspect owned previews and a real dialog backed exclusively by fake workers."""
import ctypes
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import psutil
import win32con
import win32gui
from PIL import Image

from src.platform.paths import ROOT
from tests.lifecycle.verify_close import protected_processes
from tests.lifecycle.verify_ui import HERE, children, window_for, capture


def wait_for(predicate, timeout=8):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.05)
    raise AssertionError('Owned dialog did not reach the expected state')


def controls(window):
    buttons = [h for h in children(window) if 'BUTTON' in win32gui.GetClassName(h).upper()]
    return (next(h for h in buttons if win32gui.GetWindowText(h).startswith('重新加载并启动')),
            next(h for h in buttons if win32gui.GetWindowText(h) == '重新检测'),
            next(h for h in buttons if not win32gui.GetWindowText(h)))


def width(window):
    left, _, right, _ = win32gui.GetWindowRect(window)
    return right - left


def spawn(shell, script, *args):
    return subprocess.Popen([shell, '-NoProfile', '-NonInteractive', '-STA', '-WindowStyle', 'Hidden',
        '-ExecutionPolicy', 'Bypass', '-File', str(script), *args],
        env={**os.environ, 'BETTER_CODEX_LANGUAGE': 'zh-CN'}, stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW)


def close(child, glyph):
    win32gui.SendMessage(glyph, win32con.BM_CLICK, 0, 0)
    assert child.wait(timeout=10) == 0


def verify(output):
    output.mkdir(parents=True, exist_ok=True)
    user = ctypes.WinDLL('user32')
    user.SetThreadDpiAwarenessContext.argtypes = [ctypes.c_void_p]
    user.SetThreadDpiAwarenessContext.restype = ctypes.c_void_p
    user.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))
    shell = str(Path(os.environ['WINDIR']) / 'System32/WindowsPowerShell/v1.0/powershell.exe')
    before, checks, widths, screenshots = protected_processes(), [], {}, []
    for theme, state in [('dark', 'Healthy'), ('light', 'Healthy'), ('dark', 'Updated'),
                         ('dark', 'Busy'), ('light', 'UnknownActivity')]:
        child = spawn(shell, HERE.parent / 'Show-StartupCheck.ps1', '-Preview', '-PreviewTheme', theme,
                      '-PreviewState', state, '-SettingsPath', str(output / (theme + state + '.json')))
        try:
            window = window_for(child)
            wait_for(lambda: any(win32gui.GetWindowText(h).startswith('重新加载并启动') for h in children(window)))
            time.sleep(.35)
            launch, recheck, glyph = controls(window)
            assert win32gui.GetWindowLong(window, win32con.GWL_EXSTYLE) & win32con.WS_EX_TOPMOST
            assert win32gui.IsWindowEnabled(launch) == (state in ('Healthy', 'Updated'))
            assert ('s）' in win32gui.GetWindowText(launch)) == (state == 'Updated')
            path = output / (theme + '-' + state.lower() + '.png')
            capture(window, path)
            screenshots.append(path.name)
            # Sample blank button interiors, away from text, borders and hover.
            image = Image.open(path).convert('RGB')
            left, top, _, _ = win32gui.GetWindowRect(window)
            def fill(button):
                x, y, _, bottom = win32gui.GetWindowRect(button)
                return image.getpixel((x - left + 12, y - top + (bottom-y)//2))
            assert (fill(launch) != fill(recheck)) == (state == 'Updated')
            widths[theme + state] = width(launch)
            checks.append(theme + '-' + state + '-topmost-style-and-width')
            if state == 'Healthy' and theme == 'dark':
                win32gui.ShowWindow(window, win32con.SW_MINIMIZE)
                assert win32gui.IsIconic(window)
                duplicate = subprocess.Popen(child.args, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                    env={**os.environ, 'BETTER_CODEX_LANGUAGE': 'zh-CN'}, creationflags=subprocess.CREATE_NO_WINDOW)
                assert duplicate.wait(timeout=10) == 0
                wait_for(lambda: not win32gui.IsIconic(window))
                assert win32gui.GetWindowLong(window, win32con.GWL_EXSTYLE) & win32con.WS_EX_TOPMOST
                checks.append('duplicate-entry-restores-topmost-window')
            close(child, glyph)
        finally:
            if child.poll() is None:
                child.terminate()
                child.wait(timeout=5)
    assert widths['darkHealthy'] < widths['darkUpdated']
    checks.append('no-countdown-button-shrinks-to-label')

    # Run the actual timer/guard path without any production probe or recovery code.
    fake = output / 'fake-workers'
    fake.mkdir()
    settings = fake / 'settings.json'
    settings.write_text(json.dumps({'python': sys.executable, 'codexHome': str(fake / 'home')}), encoding='utf-8')
    catalog = json.loads((ROOT / 'src/platform/i18n/messages.json').read_text(encoding='utf-8'))['zh-CN']
    rows = [{'id': key, 'label': catalog['check.' + key], 'state': 'pass',
             'status': catalog['check.pass'], 'detail': '隔离验证'}
            for key in ['app', 'sessions', 'sandbox', 'network', 'enhancements', 'permissions']]
    report = {'state': 'healthy', 'title': catalog['check.healthy'], 'rows': rows,
              'relaunch': {'allowed': True, 'needed': True, 'automatic': True, 'pluginFailure': True,
                          'reason': 'updated', 'key': 'update:26.1.2.0', 'packageVersion': '26.1.2.0',
                          'activity': {'state': 'idle', 'activeCount': 0}}}
    (fake / 'report.json').write_text(json.dumps(report), encoding='utf-8')
    (fake / 'worker.py').write_text('''import sys
from pathlib import Path
out=Path(sys.argv[sys.argv.index('--output')+1])
tmp=out.with_suffix('.next')
tmp.write_bytes(Path(__file__).with_name('report.json').read_bytes())
tmp.replace(out)
''', encoding='utf-8')
    (fake / 'relaunch.py').write_text('''import json,sys,time
from pathlib import Path
args=sys.argv[1:]
base=Path(__file__).parent
if '--activity' in args:
    time.sleep(.4)
    out=Path(args[args.index('--output')+1])
    tmp=out.with_suffix('.next')
    tmp.write_text(json.dumps({'state':'busy','activeCount':1,'checkedAt':time.time()}))
    tmp.replace(out)
else:
    base.joinpath('action-arguments.json').write_text(json.dumps(args))
''', encoding='utf-8')
    def quoted(value):
        return "'" + str(value).replace("'", "''") + "'"
    script = fake / 'host.ps1'
    script.write_text('''$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms,System.Drawing,System.Web.Extensions
Add-Type -Path @(''' + quoted(ROOT / 'src/lifecycle/diagnostics/Controls.cs') + ',' +
        quoted(ROOT / 'src/lifecycle/diagnostics/StartupCheckDialog.cs') + ''') -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions
[BetterCodex.StartupCheckDialog]::EnableDpiAwareness()
[Windows.Forms.Application]::EnableVisualStyles()
$catalog=Get-Content -LiteralPath ''' + quoted(ROOT / 'src/platform/i18n/messages.json') + ''' -Raw -Encoding UTF8 | ConvertFrom-Json
$words=$catalog.'zh-CN' | ConvertTo-Json -Compress
[BetterCodex.StartupCheckDialog]::Run(''' + quoted(settings) + ',' + quoted(fake / 'worker.py') + ''',$words,'zh-CN','','dark',$false)
''', encoding='utf-8-sig')
    child = spawn(shell, script)
    try:
        window = window_for(child)
        wait_for(lambda: any('s）' in win32gui.GetWindowText(h) for h in children(window)))
        time.sleep(.2)  # The label changes before the same UI tick finishes layout.
        launch, _, glyph = controls(window)
        countdown_width = width(launch)
        wait_for(lambda: not win32gui.IsWindowEnabled(launch))
        assert win32gui.GetWindowText(launch) == '重新加载并启动'
        wait_for(lambda: width(launch) < countdown_width)
        wait_for(lambda: any('本次自动重开已取消' in win32gui.GetWindowText(h) for h in children(window)))
        receipt = fake / 'action-arguments.json'
        wait_for(receipt.exists)
        arguments = json.loads(receipt.read_text())
        assert '--cancel' in arguments and '--plugin-failure' in arguments and '--execute' not in arguments
        time.sleep(2.2)
        assert not win32gui.IsWindowEnabled(launch) and 's）' not in win32gui.GetWindowText(launch)
        path = output / 'dark-countdown-cancelled.png'
        capture(window, path)
        screenshots.append(path.name)
        checks.extend(['new-task-cancels-countdown-and-shrinks-button', 'cancellation-covers-confirmed-concurrent-reasons',
                       'cancelled-countdown-does-not-rearm'])
        close(child, glyph)
    finally:
        if child.poll() is None:
            child.terminate()
            child.wait(timeout=5)
    # An exited worker after a partial report shares the timeout finalization
    # branch. Every new pending row must converge, and merged permission evidence
    # must retain its own status even when entry diagnostics take precedence.
    report.update(state='checking', title=catalog['check.checking'])
    report.pop('relaunch', None)
    report['rows'][5].update(status=catalog['check.ordinary'], detail='synthetic token read')
    report['managementRows'] = [{'id': key, 'label': catalog['check.' + key], 'state': 'pending',
                                 'status': catalog['check.pending'], 'detail': ''}
                                for key in ['prompts', 'updates', 'entries', 'runtime']]
    (fake / 'report.json').write_text(json.dumps(report), encoding='utf-8')
    exported = fake / 'final-report.txt'
    host = script.read_text(encoding='utf-8-sig').split('[BetterCodex.StartupCheckDialog]::Run(')[0]
    host += '$form=[BetterCodex.StartupCheckDialog]::new(' + quoted(settings) + ',' + quoted(fake / 'worker.py') + ''',$words,'zh-CN','','dark',$null,$null,$false)
$snapshot=[Windows.Forms.Timer]::new()
$snapshot.Interval=100
$snapshot.add_Tick({ if ($form.ReportText().Contains('启动检查待确认')) { [IO.File]::WriteAllText(''' + quoted(exported) + ''',$form.ReportText()); $snapshot.Stop() } })
$snapshot.Start()
[Windows.Forms.Application]::Run($form)
$snapshot.Dispose()
'''
    script.write_text(host, encoding='utf-8-sig')
    child = spawn(shell, script)
    try:
        window = window_for(child)
        wait_for(exported.exists)
        text = exported.read_text(encoding='utf-8-sig')
        assert catalog['check.ordinary'] in text
        assert all(catalog['check.' + key] in text for key in ['prompts', 'updates', 'entries', 'runtime'])
        assert not any(win32gui.GetWindowText(h) == catalog['check.pending'] for h in children(window))
        checks.extend(['unfinished-management-worker-exit-finalizes-all-pending-rows',
                       'merged-report-preserves-underlying-permission-status'])
        _, _, glyph = controls(window)
        close(child, glyph)
    finally:
        if child.poll() is None:
            child.terminate()
            child.wait(timeout=5)
    assert all(psutil.Process(pid).create_time() == started for pid, started in before.items())
    checks.append('existing-codex-hud-vpn-process-identities-preserved')
    result = {'passed': len(checks), 'checks': checks, 'buttonWidthsPx': widths, 'screenshots': screenshots,
              'protectedProcessCount': len(before), 'scope': 'owned previews and fake workers only'}
    (output / 'results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    verify(Path(sys.argv[1]).resolve())
