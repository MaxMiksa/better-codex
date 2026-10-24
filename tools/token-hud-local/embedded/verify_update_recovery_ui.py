"""Test native dialogs and graceful close using only newly created test windows."""
import ctypes
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import psutil
import win32gui
import win32process
import win32ui
from PIL import Image

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / 'shared'))
from desktop_windows import request_close
from recovery_appearance import appearance


def window_for(process):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        found = []
        win32gui.EnumWindows(lambda window, _: found.append(window)
            if win32process.GetWindowThreadProcessId(window)[1] == process.pid
            and win32gui.IsWindowVisible(window) else None, None)
        if found:
            return found[0]
        if process.poll() is not None:
            raise AssertionError('Test window exited before showing')
        time.sleep(0.1)
    raise AssertionError('Test window did not show')


def capture(window, path):
    left, top, right, bottom = win32gui.GetWindowRect(window)
    width, height = right-left, bottom-top
    handle = win32gui.GetWindowDC(window)
    original = win32ui.CreateDCFromHandle(handle)
    memory = original.CreateCompatibleDC()
    bitmap = win32ui.CreateBitmap()
    bitmap.CreateCompatibleBitmap(original, width, height)
    memory.SelectObject(bitmap)
    try:
        assert ctypes.windll.user32.PrintWindow(window, memory.GetSafeHdc(), 2)
        Image.frombuffer('RGB', (width, height), bitmap.GetBitmapBits(True), 'raw', 'BGRX', 0, 1).save(path)
    finally:
        win32gui.DeleteObject(bitmap.GetHandle())
        memory.DeleteDC(); original.DeleteDC(); win32gui.ReleaseDC(window, handle)


def verify(root, dialogs_only=False):
    root.mkdir(parents=True, exist_ok=False)
    powershell = str(Path(os.environ['WINDIR']) / 'System32/WindowsPowerShell/v1.0/powershell.exe')
    before = {p.pid: p.create_time() for p in psutil.process_iter(['name'])
              if (p.info['name'] or '').lower() == 'chatgpt.exe'}
    children, checks = [], []
    messages = json.loads((ROOT.parent / 'shared/messages.json').read_text(encoding='utf-8'))
    try:
        config = root / 'appearance.toml'
        for name, content, system_dark, expected in [
            ('explicit-dark', '[desktop]\nappearanceTheme="dark"', False, {'dark': True, 'surface': '#111111'}),
            ('explicit-light', '[desktop]\nappearanceTheme="light"', True, {'dark': False, 'surface': '#ffffff'}),
            ('system-dark', '[desktop]\nappearanceTheme="system"', True, {'dark': True, 'surface': '#111111'}),
            ('system-light', '[desktop]\nappearanceTheme="system"', False, {'dark': False, 'surface': '#ffffff'}),
            ('custom-surface', '[desktop]\nappearanceTheme="dark"\nappearanceDarkChromeTheme=\'{"surface":"#202124"}\'', False,
                {'dark': True, 'surface': '#202124'}),
            ('invalid-surface', '[desktop]\nappearanceTheme="light"\nappearanceLightChromeTheme=\'{"surface":"invalid"}\'', False,
                {'dark': False, 'surface': '#ffffff'}),
            ('invalid-config', '[desktop', True, {'dark': True, 'surface': '#111111'}),
        ]:
            config.write_text(content, encoding='utf-8')
            assert appearance(config, system_dark) == expected
            checks.append('appearance-' + name)

        def dialog(*args, language='zh-CN'):
            child = subprocess.Popen([powershell, '-NoProfile', '-NonInteractive', '-STA', '-WindowStyle',
                'Hidden', '-ExecutionPolicy', 'Bypass', '-File', str(ROOT.parent / 'Show-UpdateRecovery.ps1'),
                '-Preview', *args], env={**os.environ, 'BETTER_CODEX_LANGUAGE': language},
                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW)
            children.append(child)
            return child

        child = dialog('-PreviewTheme', 'dark')
        window = window_for(child)
        time.sleep(0.3)
        capture(window, root / 'countdown-preview-zh.png')
        buttons = []
        win32gui.EnumChildWindows(window, lambda handle, _: buttons.append(handle)
            if 'BUTTON' in win32gui.GetClassName(handle).upper() else None, None)
        assert len(buttons) == 3
        cancel = next(handle for handle in buttons if win32gui.GetWindowText(handle) == messages['zh-CN']['recovery.cancel'])
        win32gui.SendMessage(cancel, 0x00F5, 0, 0)
        assert child.wait(timeout=10) == 2
        checks.append('native-cancel-button-returns-cancel')

        for language in ['zh-CN', 'en']:
            child = dialog('-PreviewTheme', 'light', language=language)
            window = window_for(child)
            time.sleep(0.3)
            capture(window, root / ('countdown-light-' + language + '.png'))
            buttons = []
            win32gui.EnumChildWindows(window, lambda handle, _: buttons.append(handle)
                if 'BUTTON' in win32gui.GetClassName(handle).upper() else None, None)
            restart = next(handle for handle in buttons if win32gui.GetWindowText(handle) == messages[language]['recovery.restartNow'])
            clicked = time.monotonic()
            win32gui.SendMessage(restart, 0x00F5, 0, 0)
            assert child.wait(timeout=10) == 0 and time.monotonic()-clicked < 10
            checks.append('native-restart-now-skips-countdown-' + language)

        child = dialog(language='en')
        window = window_for(child)
        win32gui.PostMessage(window, 0x0010, 0, 0)
        assert child.wait(timeout=10) == 2
        checks.append('native-window-close-returns-cancel')

        child = dialog('-PreviewTheme', 'dark')
        window = window_for(child)
        # Deliver Enter only to the test window; never send global keyboard input.
        win32gui.PostMessage(window, 0x0100, 0x0D, 0)
        win32gui.PostMessage(window, 0x0101, 0x0D, 0)
        assert child.wait(timeout=10) == 2
        checks.append('native-default-enter-cancels')

        child = dialog()
        window = window_for(child)
        time.sleep(0.3)
        capture(window, root / 'countdown-codex-theme.png')
        win32gui.PostMessage(window, 0x0100, 0x1B, 0)
        win32gui.PostMessage(window, 0x0101, 0x1B, 0)
        assert child.wait(timeout=10) == 2
        checks.append('native-saved-codex-theme-and-escape')

        child = dialog('-PreviewTheme', 'light')
        window = window_for(child)
        buttons = []
        win32gui.EnumChildWindows(window, lambda handle, _: buttons.append(handle)
            if 'BUTTON' in win32gui.GetClassName(handle).upper() else None, None)
        close = next(handle for handle in buttons if not win32gui.GetWindowText(handle))
        win32gui.SendMessage(close, 0x00F5, 0, 0)
        assert child.wait(timeout=10) == 2
        checks.append('native-close-glyph-cancels')

        child = dialog('-Seconds', '2')
        window_for(child)
        assert child.wait(timeout=8) == 0
        checks.append('native-countdown-returns-elapsed')

        if dialogs_only:
            assert all(psutil.Process(pid).create_time() == started for pid, started in before.items())
            checks.append('real-codex-processes-preserved')
            (root / 'results.json').write_text(json.dumps({'passed': len(checks), 'checks': checks}, indent=2), encoding='utf-8')
            print(json.dumps({'passed': len(checks), 'scope': 'native preview dialogs only; Codex preserved'}))
            return

        source = root / 'mock-desktop.cs'
        source.write_text('''using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public class MockDesktop {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern int RegisterApplicationRestart(string args, uint flags);
    [STAThread] public static void Main(string[] args) {
        if (Array.IndexOf(args, "unregistered") < 0) RegisterApplicationRestart("", 3);
        Application.EnableVisualStyles();
        Form form = new Form();
        form.Text = "Better-Codex isolated close validation";
        Label label = new Label(); label.Dock = DockStyle.Fill;
        label.Text = "Test window only. This does not control Codex.";
        form.Controls.Add(label); Application.Run(form);
    }
}''', encoding='utf-8')
        compiler = root / 'compile.ps1'
        compiler.write_text('''param($Source, $Output)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition (Get-Content -LiteralPath $Source -Raw) -ReferencedAssemblies System.Windows.Forms -OutputAssembly $Output -OutputType WindowsApplication
''', encoding='utf-8')
        executable = root / 'RecoveryMock.exe'
        subprocess.run([powershell, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(compiler),
                        '-Source', str(source), '-Output', str(executable)], check=True, capture_output=True)
        child = subprocess.Popen([str(executable)], creationflags=subprocess.CREATE_NO_WINDOW)
        children.append(child)
        window_for(child)
        started = psutil.Process(child.pid).create_time()
        assert request_close(child.pid, started-1) is False
        assert child.poll() is None
        checks.append('native-stale-process-identity-refused')
        assert request_close(child.pid, started)
        child.wait(timeout=10)
        checks.append('restart-manager-closes-only-registered-test-process')
        child = subprocess.Popen([str(executable), 'unregistered'], creationflags=subprocess.CREATE_NO_WINDOW)
        children.append(child)
        window_for(child)
        assert request_close(child.pid, psutil.Process(child.pid).create_time()) is False
        assert child.poll() is None
        win32gui.PostMessage(window_for(child), 0x0010, 0, 0)
        child.wait(timeout=10)
        checks.append('unregistered-test-app-is-preserved')
        assert all(psutil.Process(pid).create_time() == started for pid, started in before.items())
        checks.append('real-codex-processes-preserved')
        (root / 'results.json').write_text(json.dumps({'passed': len(checks), 'checks': checks}, indent=2), encoding='utf-8')
        print(json.dumps({'passed': len(checks), 'scope': 'real native helpers and owned mock desktop; Codex preserved'}))
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()  # Only test processes created by this script.
                child.wait(timeout=5)


if __name__ == '__main__':
    verify(Path(sys.argv[1]).resolve(), dialogs_only='--dialogs-only' in sys.argv[2:])
