"""Identity checks and normal launch plumbing shared by startup recovery."""
import ctypes
import os
from pathlib import Path
import subprocess

import psutil

from desktop_listener import verified_listener

ROOT = Path(__file__).resolve().parent.parent


def desktops(package):
    result = []
    for process in psutil.process_iter(['name']):
        if (process.info['name'] or '').lower() != 'chatgpt.exe':
            continue
        try:
            if os.path.normcase(process.exe()) != os.path.normcase(package['executable']):
                raise ValueError('Desktop identity unavailable')
            args = process.cmdline()
            result.append({'pid': process.pid, 'started': process.create_time(),
                           'main': not any(arg.startswith('--type=') for arg in args),
                           'debuggingRequested': any(arg.startswith('--remote-debugging-port') for arg in args)})
        except psutil.NoSuchProcess:
            continue
    return result


def port_status(settings, package):
    port = settings['port']
    if not isinstance(port, int) or not 1024 <= port <= 65535:
        raise ValueError('Invalid display port')
    listeners = [c for c in psutil.net_connections('tcp')
                 if c.status == psutil.CONN_LISTEN and c.laddr.port == port]
    if not listeners:
        return 'absent'
    return 'verified' if verified_listener(port, Path(package['executable']), package['sha256']) else 'unverified'


def preflight(settings, elevated=True):
    for dependency in [settings['python'], settings['node'],
                       str(Path(settings['playwright']) / 'package.json'),
                       str(Path(settings['collectorDir']) / 'metrics.py'),
                       str(ROOT / 'Start-ComposerHud.ps1')]:
        if not Path(dependency).is_file():
            raise ValueError('Recovery launch dependency unavailable')
    if elevated and settings.get('runAsAdministrator') is True and not ctypes.windll.shell32.IsUserAnAdmin():
        raise ValueError('Recovery requires administrator privileges')


def powershell(script, *args):
    executable = Path(os.environ['WINDIR']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
    return subprocess.Popen([str(executable), '-NoProfile', '-NonInteractive', '-STA',
        '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', str(ROOT / script), *args],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
