"""Click close controls on isolated previews without manipulating existing apps."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import psutil
import win32con
import win32gui

from verify_ui import HERE, children, window_for


def protected_processes():
    result = {}
    for process in psutil.process_iter(['name', 'cmdline']):
        name = (process.info['name'] or '').lower()
        arguments = [value.replace('\\', '/').lower() for value in process.info['cmdline'] or []]
        hud = any(value.endswith(('/embedded/supervisor.py', '/embedded/controller.cjs', '/collector/metrics.py'))
                  for value in arguments)
        if name == 'chatgpt.exe' or 'luyucloud' in name or (
                name in ('python.exe', 'pythonw.exe', 'node.exe') and hud):
            result[process.pid] = process.create_time()
    return result


def verify(output):
    output.mkdir(parents=True, exist_ok=True)
    before = protected_processes()
    powershell = str(Path(os.environ['WINDIR']) / 'System32/WindowsPowerShell/v1.0/powershell.exe')
    checks = []
    for theme, state in [('dark', 'Healthy'), ('light', 'Healthy'),
                          ('dark', 'Checking'), ('light', 'Checking'),
                          ('dark', 'Updated'), ('light', 'Enhancements')]:
        child = subprocess.Popen([powershell, '-NoProfile', '-NonInteractive', '-STA',
            '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File',
            str(HERE.parent / 'Show-StartupCheck.ps1'), '-Preview', '-PreviewTheme', theme,
            '-PreviewState', state, '-SettingsPath', str(output / 'isolated.json')],
            env={**os.environ, 'BETTER_CODEX_LANGUAGE': 'zh-CN'},
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            window = window_for(child)
            buttons = [handle for handle in children(window)
                       if 'BUTTON' in win32gui.GetClassName(handle).upper()]
            target = next(handle for handle in buttons
                          if win32gui.GetWindowText(handle) == '')
            assert not any(win32gui.GetWindowText(handle) == '关闭' for handle in buttons)
            assert win32gui.IsWindowEnabled(target)
            if state in ('Updated', 'Enhancements'):
                ready = time.monotonic() + 3
                while not any('（15s）' in win32gui.GetWindowText(h) for h in buttons) and time.monotonic() < ready:
                    time.sleep(.05)
                assert any('（15s）' in win32gui.GetWindowText(h) for h in buttons)
            win32gui.SendMessage(target, win32con.BM_CLICK, 0, 0)
            assert child.wait(timeout=10) == 0
            assert not win32gui.IsWindow(window)
            checks.append(theme + '-' + state + '-close-glyph')
        finally:
            if child.poll() is None:
                child.terminate()
                child.wait(timeout=5)
    assert all(psutil.Process(pid).create_time() == started for pid, started in before.items())
    checks.append('existing-codex-hud-vpn-process-identities-preserved')
    result = {'passed': len(checks), 'checks': checks, 'protectedProcessCount': len(before)}
    (output / 'close-results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    verify(Path(sys.argv[1]).resolve())
