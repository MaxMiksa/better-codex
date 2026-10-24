"""Read-only desktop and display-listener identity checks."""
import os
from pathlib import Path
import psutil
from src.platform.codex.desktop_listener import verified_listener

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
