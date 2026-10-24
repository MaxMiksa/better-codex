"""Exercise only newly created preview windows; preserve Codex and the clipboard."""
import ctypes
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import psutil
import win32clipboard
import win32con
import win32gui
import win32process
import win32api
from PIL import ImageGrab

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'embedded'))
from verify_update_recovery_ui import window_for, capture


def children(window):
    result = []
    win32gui.EnumChildWindows(window, lambda handle, _: result.append(handle), None)
    return result


def clipboard_snapshot():
    win32clipboard.OpenClipboard()
    try:
        result = {}
        fmt = 0
        while True:
            fmt = win32clipboard.EnumClipboardFormats(fmt)
            if not fmt:
                return result
            value = win32clipboard.GetClipboardData(fmt)
            if not isinstance(value, (str, bytes)):
                return None
            result[fmt] = value
    finally:
        win32clipboard.CloseClipboard()

def capture_composited(window, path):
    # Only our preview over a plain test-owned backdrop, never the user's chats.
    left, top, right, bottom = win32gui.GetWindowRect(window)
    background = win32api.RGB(80, 80, 80)
    brush = win32gui.CreateSolidBrush(background)
    cls = win32gui.WNDCLASS()
    cls.lpszClassName = 'BetterCodexValidationBackdrop-' + str(os.getpid())
    cls.hInstance = win32api.GetModuleHandle(None)
    cls.lpfnWndProc = win32gui.DefWindowProc
    cls.hbrBackground = brush
    atom = win32gui.RegisterClass(cls)
    backdrop = None
    try:
        backdrop = win32gui.CreateWindowEx(win32con.WS_EX_NOACTIVATE | win32con.WS_EX_TOOLWINDOW,
            atom, '', win32con.WS_POPUP, left - 32, top - 32, right - left + 64, bottom - top + 64,
            0, 0, cls.hInstance, None)
        win32gui.SetWindowPos(backdrop, win32con.HWND_TOP, 0, 0, 0, 0,
            win32con.SWP_NOMOVE | win32con.SWP_NOSIZE | win32con.SWP_NOACTIVATE | win32con.SWP_SHOWWINDOW)
        win32gui.UpdateWindow(backdrop)
        win32gui.SetWindowPos(window, win32con.HWND_TOP, 0, 0, 0, 0,
            win32con.SWP_NOMOVE | win32con.SWP_NOSIZE | win32con.SWP_NOACTIVATE)
        ctypes.windll.dwmapi.DwmFlush()
        time.sleep(.15)
        image = ImageGrab.grab(bbox=(left, top, right, bottom), all_screens=True).convert('RGB')
        image.save(path)
        assert abs(image.getpixel((0, 0))[0] - image.getpixel((20, 0))[0]) > 8, 'Compositor did not round the corner'
        corner = [image.getpixel((x, y)) for x in range(20) for y in range(20)]
        assert all(r == g == b for r, g, b in corner), 'Colored fringe in the neutral corner'
        assert len(set(corner)) > 3, 'Corner does not contain composited antialiasing'
        caption = [image.getpixel((x, y)) for x in range(46, min(500, image.width - 80)) for y in range(28, 60)]
        assert all(r == g == b for r, g, b in caption), 'Caption contains colored text fringes'
    finally:
        if backdrop:
            win32gui.DestroyWindow(backdrop)
        win32gui.UnregisterClass(atom, cls.hInstance)
        # UnregisterClass releases its class background brush.


def verify(output, composited=False):
    output.mkdir(parents=True, exist_ok=True)
    user = ctypes.WinDLL('user32')
    user.SetThreadDpiAwarenessContext.argtypes = [ctypes.c_void_p]
    user.SetThreadDpiAwarenessContext.restype = ctypes.c_void_p
    user.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))
    user.GetDpiForWindow.argtypes = [ctypes.c_void_p]
    user.GetDpiForWindow.restype = ctypes.c_uint
    dwm = ctypes.WinDLL('dwmapi')
    dwm.DwmGetWindowAttribute.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_uint]
    shcore = ctypes.WinDLL('shcore')
    user.MonitorFromWindow.argtypes = [ctypes.c_void_p, ctypes.c_uint]
    user.MonitorFromWindow.restype = ctypes.c_void_p
    shcore.GetScaleFactorForMonitor.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_int)]
    before = {p.pid: p.create_time() for p in psutil.process_iter(['name']) if (p.info['name'] or '').lower() == 'chatgpt.exe'}
    powershell = str(Path(os.environ['WINDIR']) / 'System32/WindowsPowerShell/v1.0/powershell.exe')
    checks, screenshots, running = [], [], []
    try:
        for theme, state, language in [('dark', 'Healthy', 'zh-CN'), ('light', 'Healthy', 'zh-CN'),
                                       ('dark', 'Failed', 'zh-CN'), ('light', 'Partial', 'en'),
                                       ('dark', 'Checking', 'zh-CN')]:
            child = subprocess.Popen([powershell, '-NoProfile', '-NonInteractive', '-STA', '-WindowStyle', 'Hidden',
                '-ExecutionPolicy', 'Bypass', '-File', str(HERE.parent / 'Show-StartupCheck.ps1'),
                '-Preview', '-PreviewTheme', theme, '-PreviewState', state,
                '-SettingsPath', str(output / ('isolated-' + state + '.json'))],
                env={**os.environ, 'BETTER_CODEX_LANGUAGE': language}, stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW)
            running.append(child)
            try:
                window = window_for(child)
            except AssertionError:
                raise AssertionError((child.stderr.read().decode('utf-8', errors='replace') if child.poll() is not None else 'preview timeout'))
            time.sleep(.35)
            scale, corner = ctypes.c_int(), ctypes.c_int()
            assert shcore.GetScaleFactorForMonitor(user.MonitorFromWindow(window, 2), ctypes.byref(scale)) == 0
            assert user.GetDpiForWindow(window) == round(96 * scale.value / 100)
            assert dwm.DwmGetWindowAttribute(window, 33, ctypes.byref(corner), 4) == 0 and corner.value == 2
            handles = children(window)
            buttons = [h for h in handles if 'BUTTON' in win32gui.GetClassName(h).upper()]
            labels = [win32gui.GetWindowText(h) for h in handles]
            copy_name, recheck_name, reload_name = ('复制报告', '重新检测', '重新加载并启动') if language == 'zh-CN' else ('Copy report', 'Check again', 'Reload and launch')
            copy_button = next(h for h in buttons if win32gui.GetWindowText(h) == copy_name)
            recheck = next(h for h in buttons if win32gui.GetWindowText(h) == recheck_name)
            reload_button = next(h for h in buttons if win32gui.GetWindowText(h) == reload_name)
            assert win32gui.GetWindowRect(copy_button)[2] < win32gui.GetWindowRect(recheck)[0] < win32gui.GetWindowRect(reload_button)[0]
            assert win32gui.GetWindowRect(reload_button)[2] <= win32gui.GetWindowRect(window)[2]
            assert win32gui.IsWindowEnabled(reload_button) == (state != 'Checking')
            assert win32gui.IsWindowEnabled(recheck) == (state != 'Checking')
            assert not (win32gui.GetWindowLong(window, win32con.GWL_STYLE) & win32con.WS_THICKFRAME)
            assert all(not (win32gui.GetWindowLong(h, win32con.GWL_STYLE) & (win32con.WS_VSCROLL | win32con.WS_HSCROLL)) for h in handles)
            visible_text = [win32gui.GetWindowText(h) for h in handles if win32gui.IsWindowVisible(h)]
            assert not any('模型请求未实测' in text for text in visible_text)
            assert not any('启动环境检查通过' in text for text in visible_text)
            assert not any(text in ('检查完成', 'Check complete', '关闭', 'Close') for text in visible_text)
            checks.append(theme + '-' + state + '-dpi-rounded-frame-footer-and-recheck')
            path = output / (theme + '-' + state.lower() + '-' + language + '.png')
            capture(window, path)
            screenshots.append(path.name)
            if state == 'Healthy' and composited:
                composed = output / (theme + '-healthy-composited.png')
                capture_composited(window, composed)
                screenshots.append(composed.name)
                checks.append(theme + '-composited-corners-and-grayscale-text')
            if state == 'Healthy' and theme == 'dark':
                # Only replace and restore clipboard formats we can preserve exactly.
                try:
                    saved = clipboard_snapshot()
                except Exception:
                    saved = None
                if saved is not None:
                    copied = None
                    try:
                        win32gui.SendMessage(copy_button, win32con.BM_CLICK, 0, 0)
                        time.sleep(.15)
                        win32clipboard.OpenClipboard()
                        try:
                            copied = win32clipboard.GetClipboardData(win32con.CF_UNICODETEXT)
                        finally:
                            win32clipboard.CloseClipboard()
                        assert '启动检查报告' in copied and '历史会话' in copied and '模型请求未实测' in copied
                        assert 'C:\\Users\\' not in copied and 'Authorization' not in copied
                        assert win32gui.GetWindowText(copy_button) == '已复制'
                        checks.append('native-copy-button-complete-report')
                    finally:
                        win32clipboard.OpenClipboard()
                        try:
                            # Do not overwrite a new clipboard change made by the user.
                            if copied is not None and win32clipboard.GetClipboardData(win32con.CF_UNICODETEXT) == copied:
                                win32clipboard.EmptyClipboard()
                                for fmt, value in saved.items():
                                    win32clipboard.SetClipboardData(fmt, value)
                        finally:
                            win32clipboard.CloseClipboard()
                else:
                    checks.append('clipboard-preserved-rich-format-copy-not-mutated')
            if state == 'Healthy' and theme == 'light':
                win32gui.SendMessage(recheck, win32con.BM_CLICK, 0, 0)
                time.sleep(.15)
                assert win32gui.IsWindow(window)
                checks.append('native-recheck-keeps-window-open')
                win32gui.SendMessage(reload_button, win32con.BM_CLICK, 0, 0)
                assert win32gui.IsWindow(window)
                assert win32gui.GetWindowText(reload_button) == reload_name
                checks.append('preview-relaunch-simulates-without-closing-codex')
            if state == 'Healthy' and theme == 'dark':
                duplicate = subprocess.Popen(child.args, env={**os.environ, 'BETTER_CODEX_LANGUAGE': language},
                    stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW)
                running.append(duplicate)
                assert duplicate.wait(timeout=10) == 0 and win32gui.IsWindow(window)
                checks.append('second-entry-reuses-window-and-requests-refresh')
            # Exercise the actual controls: DialogResult alone cannot close a modeless form.
            close_target = next(h for h in buttons if not win32gui.GetWindowText(h))
            win32gui.SendMessage(close_target, win32con.BM_CLICK, 0, 0)
            assert child.wait(timeout=10) == 0
            assert not win32gui.IsWindow(window)
            checks.append(theme + '-' + state + '-close-glyph')
        assert all(psutil.Process(pid).create_time() == started for pid, started in before.items())
        checks.append('all-existing-codex-process-identities-preserved')
        result = {'passed': len(checks), 'checks': checks, 'screenshots': screenshots}
        (output / 'native-ui-results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(result, ensure_ascii=False))
    finally:
        for child in running:
            if child.poll() is None:
                child.terminate()
                child.wait(timeout=5)


if __name__ == '__main__':
    verify(Path(sys.argv[1]).resolve(), '--composited' in sys.argv[2:])
