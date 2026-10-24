"""Windows status-file contention must not stop the HUD. Uses an isolated runtime."""
import ctypes
import json
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
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


def verify_desktop_exit(runtime):
    runtime.mkdir(parents=True, exist_ok=False)
    settings = runtime / 'settings.json'
    settings.write_text('{"port":19163,"node":"fixture-node"}', encoding='utf-8')
    child = MagicMock()
    child.pid, child.returncode = 456, 0
    child.poll.return_value = None
    child.terminate.side_effect = lambda: setattr(child.poll, 'return_value', 0)
    desktop = MagicMock()
    desktop.create_time.return_value = 10
    ticks = 0

    def tick(_):
        nonlocal ticks
        ticks += 1
        status = json.loads((runtime / 'supervisor.json').read_text())
        if ticks == 1:
            assert status['phase'] == 'controller-running'
            desktop.create_time.return_value = 11  # PID reused by a different process.
        else:
            assert status['phase'] == 'waiting-desktop-connection'
            assert status['desktopPid'] is None and status['controllerPid'] is None
            assert status['childExits'] == 1
            child.terminate.assert_called_once_with()
            (runtime / 'stop').touch()

    listener = SimpleNamespace(status=supervisor.psutil.CONN_LISTEN, laddr=SimpleNamespace(port=19163))
    with patch.object(supervisor.psutil, 'Process', return_value=desktop), \
            patch.object(supervisor.psutil, 'net_connections', side_effect=[[listener], []]), \
            patch.object(supervisor, 'discover', return_value={'executable': 'fixture.exe', 'sha256': 'fixture'}), \
            patch.object(supervisor, 'verified_listener', return_value=(123, 10)), \
            patch.object(supervisor.subprocess, 'Popen', return_value=child), \
            patch.object(supervisor.time, 'sleep', side_effect=tick):
        assert supervisor.owner_alive((123, 10))
        supervisor.run(settings, runtime)
    assert ticks == 2
    with patch.object(supervisor.psutil, 'Process', side_effect=supervisor.psutil.NoSuchProcess(123)):
        assert not supervisor.owner_alive((123, 10))
    print(json.dumps({'live_owner_preserved': True, 'reused_pid_refused': True,
                      'missing_owner_refused': True, 'orphan_controller_retired': True}))


if __name__ == '__main__':
    root = Path(sys.argv[1]).resolve()
    verify(root)
    verify_desktop_exit(root / 'desktop-exit')
