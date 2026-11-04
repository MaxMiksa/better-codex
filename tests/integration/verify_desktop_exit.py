"""Exercise Restart Manager on owned, restart-unregistered window processes only."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import psutil
import win32api
import win32con
import win32gui

from src.platform.windows import desktop_windows
from tests.lifecycle.verify_close import protected_processes


def fixture(mode, receipt):
    counts = {'query': 0, 'end': 0, 'accepted': mode == 'accept'}
    def record():
        receipt.write_text(json.dumps(counts), encoding='utf-8')
    def procedure(window, message, wparam, lparam):
        if message == win32con.WM_QUERYENDSESSION:
            counts['query'] += 1
            record()
            return int(mode == 'accept')
        if message == win32con.WM_ENDSESSION:
            if wparam:
                counts['end'] += 1
                record()
                win32gui.DestroyWindow(window)
            return 0
        if message == win32con.WM_DESTROY:
            win32gui.PostQuitMessage(0)
            return 0
        return win32gui.DefWindowProc(window, message, wparam, lparam)
    cls = win32gui.WNDCLASS()
    cls.hInstance = win32api.GetModuleHandle(None)
    cls.lpszClassName = 'BetterCodexExitFixture'
    cls.lpfnWndProc = procedure
    atom = win32gui.RegisterClass(cls)
    # A visible top-level window off screen; no activation, taskbar or user input.
    win32gui.CreateWindowEx(win32con.WS_EX_NOACTIVATE | win32con.WS_EX_TOOLWINDOW,
        atom, 'Better-Codex isolated exit fixture', win32con.WS_OVERLAPPEDWINDOW | win32con.WS_VISIBLE,
        -20000, -20000, 300, 120, 0, 0, cls.hInstance, None)
    record()
    win32gui.PumpMessages()


def verify(output):
    output.mkdir(parents=True, exist_ok=True)
    before = protected_processes()
    checks = []
    for mode in ['accept', 'veto']:
        receipt = output / (mode + '.json')
        child = subprocess.Popen([sys.executable, '-B', '-X', 'utf8', str(Path(__file__).resolve()),
            '--fixture', mode, str(receipt)], cwd=Path(__file__).resolve().parents[2],
            env={**os.environ, 'PYTHONPATH': str(Path(__file__).resolve().parents[2])},
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            deadline = time.monotonic() + 8
            while not receipt.exists() and time.monotonic() < deadline:
                if child.poll() is not None:
                    raise AssertionError(child.stderr.read().decode('utf-8', errors='replace'))
                time.sleep(.05)
            assert receipt.exists()
            started = psutil.Process(child.pid).create_time()
            assert not desktop_windows.request_close(child.pid, started - 1)
            assert child.poll() is None
            checks.append(mode + '-reused-pid-time-rejected')
            result = desktop_windows.request_close(child.pid, started)
            if mode == 'accept':
                assert result, 'Normal exit of restart-unregistered fixture was rejected'
                assert child.wait(timeout=8) == 0
                counts = json.loads(receipt.read_text())
                assert counts['query'] > 0 and counts['end'] == 1
                checks.append('restart-unregistered-app-exits-through-normal-session-messages')
            else:
                assert not result and child.poll() is None
                counts = json.loads(receipt.read_text())
                assert counts['query'] > 0 and counts['end'] == 0
                checks.append('vetoed-exit-keeps-owned-fixture-alive')
        finally:
            if child.poll() is None:
                child.terminate()  # Only the process created by this test.
                child.wait(timeout=5)
    assert all(psutil.Process(pid).create_time() == started for pid, started in before.items())
    checks.append('existing-codex-hud-vpn-process-identities-preserved')
    result = {'passed': len(checks), 'checks': checks, 'protectedProcessCount': len(before),
              'scope': 'owned off-screen native fixture processes only; no Codex shutdown'}
    (output / 'results.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result))


if __name__ == '__main__':
    if sys.argv[1] == '--fixture':
        fixture(sys.argv[2], Path(sys.argv[3]))
    else:
        verify(Path(sys.argv[1]).resolve())
