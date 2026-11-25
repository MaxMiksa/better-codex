"""Invoke only the shell verbs selected by the workspace action host."""

import ctypes
from ctypes import wintypes
import os
import sys
import time


def locate(path: str) -> None:
    # Shell API, not explorer.exe's comma-delimited command syntax.
    system32_only = 0x800
    ole = ctypes.WinDLL("ole32", winmode=system32_only)
    shell = ctypes.WinDLL("shell32", winmode=system32_only)
    pidl = ctypes.c_void_p()
    ole.CoInitializeEx.argtypes = (ctypes.c_void_p, wintypes.DWORD)
    ole.CoInitializeEx.restype = ctypes.HRESULT
    ole.CoTaskMemFree.argtypes = (ctypes.c_void_p,)
    ole.CoTaskMemFree.restype = None
    ole.CoUninitialize.argtypes = ()
    ole.CoUninitialize.restype = None
    shell.SHParseDisplayName.argtypes = (
        wintypes.LPCWSTR, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p),
        wintypes.DWORD, ctypes.POINTER(wintypes.DWORD),
    )
    shell.SHParseDisplayName.restype = ctypes.HRESULT
    shell.SHOpenFolderAndSelectItems.argtypes = (
        ctypes.c_void_p, wintypes.UINT, ctypes.c_void_p, wintypes.DWORD,
    )
    shell.SHOpenFolderAndSelectItems.restype = ctypes.HRESULT

    ole.CoInitializeEx(None, 2)  # COINIT_APARTMENTTHREADED
    try:
        shell.SHParseDisplayName(path, None, ctypes.byref(pidl), 0, None)
        shell.SHOpenFolderAndSelectItems(pidl, 0, None, 0)
    finally:
        ole.CoTaskMemFree(pidl)
        ole.CoUninitialize()


def open_folder(path: str, desktop_pid: int = 0) -> bool:
    """Open a new Explorer window; present only that window on the requesting desktop."""
    if not desktop_pid:
        os.startfile(path, "opennewwindow")
        return True

    import pywintypes
    import win32com.client
    import win32con
    import win32gui
    import win32process

    def is_explorer(hwnd):
        try:
            return win32gui.GetClassName(hwnd) in ("CabinetWClass", "ExploreWClass")
        except pywintypes.error:
            return False

    previous = set()
    source = win32gui.GetForegroundWindow()
    try:
        tracked = source and win32process.GetWindowThreadProcessId(source)[1] == desktop_pid
        if tracked:
            win32gui.EnumWindows(lambda hwnd, _: previous.add(hwnd) if is_explorer(hwnd) else None, None)
    except pywintypes.error:
        tracked = False
    # "explore" can report success by reusing an unfocused Explorer window.
    os.startfile(path, "opennewwindow")
    if not tracked:
        return True  # The user switched windows, or this launch has no verified desktop owner.

    expected = os.path.normcase(os.path.normpath(path))
    deadline = time.monotonic() + 1.8
    try:
        shell = win32com.client.Dispatch("Shell.Application")
        while time.monotonic() < deadline:
            current = win32gui.GetForegroundWindow()
            if current and current != source and not is_explorer(current):
                return True  # Never take focus back from another application.
            matches = set()
            for view in shell.Windows():
                try:
                    hwnd = int(view.HWND)
                    if (hwnd not in previous and is_explorer(hwnd) and win32gui.IsWindowVisible(hwnd)
                            and os.path.normcase(os.path.normpath(view.Document.Folder.Self.Path)) == expected):
                        matches.add(hwnd)
                except (AttributeError, TypeError, pywintypes.com_error, pywintypes.error):
                    continue
            if len(matches) == 1:
                target = matches.pop()
                current = win32gui.GetForegroundWindow()
                if current == target:
                    return True
                if current and current != source:
                    return True
                if not current:
                    continue
                try:
                    win32gui.SetForegroundWindow(target)
                except pywintypes.error:
                    pass
                current = win32gui.GetForegroundWindow()
                if current != source:
                    return True
                # Keep it a normal window even if Windows won't transfer keyboard focus.
                flags = win32con.SWP_NOMOVE | win32con.SWP_NOSIZE | win32con.SWP_NOACTIVATE | win32con.SWP_NOOWNERZORDER
                win32gui.SetWindowPos(target, win32con.HWND_TOP, 0, 0, 0, 0, flags)
                preceding = win32gui.GetTopWindow(0)
                for _ in range(256):
                    if preceding == target:
                        return True
                    if not preceding or preceding == source:
                        break
                    preceding = win32gui.GetWindow(preceding, win32con.GW_HWNDNEXT)
                win32gui.FlashWindowEx(target, win32con.FLASHW_TRAY, 3, 0)
                return False
            if current and current != source and current in previous:
                return True
            time.sleep(0.075)
    except (pywintypes.com_error, pywintypes.error):
        pass  # The folder already opened. Report that foreground could not be verified.
    current = win32gui.GetForegroundWindow()
    return bool(current and current != source)


def main() -> int:
    if os.name != "nt" or len(sys.argv) not in (3, 4):
        return 1
    verb, path = sys.argv[1:3]
    if len(sys.argv) == 4 and (verb != "folder" or not sys.argv[3].isdigit()):
        return 1
    desktop_pid = int(sys.argv[3]) if len(sys.argv) == 4 else 0
    try:
        if verb == "locate":
            locate(path)
        elif verb == "folder":
            return 0 if open_folder(path, desktop_pid) else 3
        elif verb == "open":
            os.startfile(path, "open")
        else:
            return 1
    except OSError as exc:
        return 2 if verb == "open" and exc.winerror == 1155 else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
