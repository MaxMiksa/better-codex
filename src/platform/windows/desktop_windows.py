"""Ask Windows Restart Manager to close one exact registered desktop instance."""
import ctypes
from ctypes import wintypes

import psutil


class UniqueProcess(ctypes.Structure):
    _fields_ = [('pid', wintypes.DWORD), ('started', wintypes.FILETIME)]


class ProcessInfo(ctypes.Structure):
    _fields_ = [('process', UniqueProcess), ('appName', wintypes.WCHAR * 256),
                ('serviceName', wintypes.WCHAR * 64), ('appType', ctypes.c_int),
                ('status', wintypes.ULONG), ('session', wintypes.DWORD), ('restartable', wintypes.BOOL)]


def request_close(pid, started):
    process = psutil.Process(pid)
    if process.create_time() != started:
        return False
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    target = UniqueProcess()
    target.pid = pid
    try:
        unused = [wintypes.FILETIME() for _ in range(3)]
        if not kernel.GetProcessTimes(handle, ctypes.byref(target.started),
                                      *(ctypes.byref(value) for value in unused)):
            raise ctypes.WinError(ctypes.get_last_error())
        if psutil.Process(pid).create_time() != started:
            return False
        manager = ctypes.WinDLL('rstrtmgr', use_last_error=True)
        manager.RmStartSession.argtypes = [ctypes.POINTER(wintypes.DWORD), wintypes.DWORD, wintypes.LPWSTR]
        manager.RmRegisterResources.argtypes = [wintypes.DWORD, wintypes.UINT, ctypes.c_void_p,
            wintypes.UINT, ctypes.POINTER(UniqueProcess), wintypes.UINT, ctypes.c_void_p]
        manager.RmShutdown.argtypes = [wintypes.DWORD, wintypes.ULONG, ctypes.c_void_p]
        manager.RmEndSession.argtypes = [wintypes.DWORD]
        manager.RmGetList.argtypes = [wintypes.DWORD, ctypes.POINTER(wintypes.UINT),
            ctypes.POINTER(wintypes.UINT), ctypes.POINTER(ProcessInfo), ctypes.POINTER(wintypes.DWORD)]
        session, key = wintypes.DWORD(), ctypes.create_unicode_buffer(33)
        error = manager.RmStartSession(ctypes.byref(session), 0, key)
        if error:
            raise ctypes.WinError(error)
        try:
            # Register only PID + exact kernel creation time, no files or services.
            error = manager.RmRegisterResources(session, 0, None, 1, ctypes.byref(target), 0, None)
            if error:
                raise ctypes.WinError(error)
            needed, count, reasons = wintypes.UINT(), wintypes.UINT(1), wintypes.DWORD()
            affected = (ProcessInfo * 1)()
            error = manager.RmGetList(session, ctypes.byref(needed), ctypes.byref(count),
                                      affected, ctypes.byref(reasons))
            if error or count.value != 1 or affected[0].process.pid != pid:
                return False
            actual = affected[0].process.started
            if (actual.dwLowDateTime, actual.dwHighDateTime) != (target.started.dwLowDateTime, target.started.dwHighDateTime):
                return False
            # RmShutdownOnlyRegistered, never RmForceShutdown. Closing the last
            # window is insufficient: current Codex deliberately stays alive.
            return manager.RmShutdown(session, 0x10, None) == 0
        finally:
            manager.RmEndSession(session)
    finally:
        kernel.CloseHandle(handle)
