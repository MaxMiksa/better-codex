"""Exercise the full 15-second countdown only in non-executing previews."""
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

from tests.lifecycle.verify_close import protected_processes
from tests.lifecycle.verify_ui import HERE, children, window_for, capture


def verify(output):
    user = ctypes.WinDLL('user32')
    user.SetThreadDpiAwarenessContext.argtypes = [ctypes.c_void_p]
    user.SetThreadDpiAwarenessContext.restype = ctypes.c_void_p
    user.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))
    output.mkdir(parents=True, exist_ok=True)
    before = protected_processes()
    shell = str(Path(os.environ['WINDIR']) / 'System32/WindowsPowerShell/v1.0/powershell.exe')
    checks = []
    for theme, scenario in [('dark', 'Updated'), ('light', 'Enhancements')]:
        child = subprocess.Popen([shell, '-NoProfile', '-NonInteractive', '-STA', '-WindowStyle', 'Hidden',
            '-ExecutionPolicy', 'Bypass', '-File', str(HERE.parent / 'Show-StartupCheck.ps1'),
            '-Preview', '-PreviewState', scenario, '-PreviewTheme', theme,
            '-SettingsPath', str(output / (scenario + '.json'))], env={**os.environ, 'BETTER_CODEX_LANGUAGE': 'zh-CN'},
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            window = window_for(child)
            buttons = [h for h in children(window) if 'BUTTON' in win32gui.GetClassName(h).upper()]
            launch = next(h for h in buttons if win32gui.GetWindowText(h).startswith('重新加载并启动'))
            recheck = next(h for h in buttons if win32gui.GetWindowText(h) == '重新检测')
            close = next(h for h in buttons if not win32gui.GetWindowText(h))
            ready = time.monotonic() + 3
            while win32gui.GetWindowText(launch) == '重新加载并启动' and time.monotonic() < ready:
                time.sleep(.05)
            assert win32gui.GetWindowText(launch) == '重新加载并启动（15s）'
            time.sleep(.35)  # Allow the first native layout and paint to complete.
            capture(window, output / (theme + '-' + scenario.lower() + '-countdown.png'))
            time.sleep(.9)
            assert win32gui.GetWindowText(launch) == '重新加载并启动（14s）'
            checks.append(scenario + '-countdown-starts-at-15-and-advances')
            if scenario == 'Updated':
                win32gui.SendMessage(recheck, win32con.BM_CLICK, 0, 0)
                assert win32gui.GetWindowText(launch) == '重新加载并启动（15s）'
                checks.append('recheck-replaces-old-countdown')
                win32gui.SendMessage(launch, win32con.BM_CLICK, 0, 0)
                assert win32gui.GetWindowText(launch) == '重新加载并启动'
                checks.append('button-immediately-simulates-full-enhanced-launch')
            else:
                deadline = time.monotonic() + 18
                while 's）' in win32gui.GetWindowText(launch) and time.monotonic() < deadline:
                    time.sleep(.15)
                assert win32gui.GetWindowText(launch) == '重新加载并启动'
                time.sleep(1.2)
                assert win32gui.GetWindowText(launch) == '重新加载并启动'
                checks.append('15-second-expiry-simulates-once-without-loop')
            assert win32gui.IsWindow(window)
            win32gui.SendMessage(close, win32con.BM_CLICK, 0, 0)
            assert child.wait(timeout=10) == 0
        finally:
            if child.poll() is None:
                child.terminate()
                child.wait(timeout=5)
    assert all(psutil.Process(pid).create_time() == started for pid, started in before.items())
    checks.append('existing-codex-hud-vpn-process-identities-preserved')
    result = {'passed': len(checks), 'checks': checks, 'scope': 'preview only; launch actions simulated'}
    (output / 'results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    verify(Path(sys.argv[1]).resolve())
