"""Windows status-file contention must not stop the HUD. Uses an isolated runtime."""
import ctypes
import json
from pathlib import Path
import sys
from unittest.mock import patch
import supervisor


def verify(runtime):
    runtime.mkdir(parents=True, exist_ok=False)
    status = runtime / 'supervisor.json'
    status.write_text('{}', encoding='utf-8')
    settings = runtime / 'settings.json'
    settings.write_text('{"port":19163}', encoding='utf-8')
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateFileW.argtypes = [ctypes.c_wchar_p, ctypes.c_ulong, ctypes.c_ulong,
                                  ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_void_p]
    kernel.CreateFileW.restype = ctypes.c_void_p
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    handle = kernel.CreateFileW(str(status), 0x80000000, 3, None, 3, 0, None)
    assert handle != ctypes.c_void_p(-1).value
    ticks = 0
    try:
        assert supervisor.publish_status(status, {'phase': 'probe'}) is False
        assert json.loads(status.read_text()) == {}

        def tick(_):
            nonlocal ticks, handle
            ticks += 1
            assert not (runtime / 'stop').exists()
            if ticks == 1:
                kernel.CloseHandle(handle)
                handle = None
            else:
                assert json.loads(status.read_text())['phase'] == 'waiting-desktop-connection'
                assert json.loads(status.read_text())['writes']['failures'] == 1
                (runtime / 'stop').touch()

        with patch.object(supervisor.psutil, 'net_connections', return_value=[]), \
                patch.object(supervisor.time, 'sleep', side_effect=tick):
            supervisor.run(settings, runtime)
        assert ticks == 2
        assert json.loads(status.read_text())['phase'] == 'stopped'
        print(json.dumps({'locked_write_tolerated': True, 'loop_survived_lock': True,
                          'publication_recovered': True, 'explicit_stop_preserved': True}))
    finally:
        if handle is not None:
            kernel.CloseHandle(handle)


if __name__ == '__main__':
    verify(Path(sys.argv[1]).resolve())
