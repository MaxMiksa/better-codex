"""Capture and identify only the caller's newly created preview windows."""
import ctypes
import time
import win32gui
import win32process
import win32ui
from PIL import Image

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
