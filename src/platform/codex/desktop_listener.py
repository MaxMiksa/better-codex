"""Verify that the display port belongs to the registered Codex executable."""
import hashlib
from pathlib import Path

import psutil


def verified_listener(port, executable, digest):
    listeners = [c for c in psutil.net_connections(kind='tcp')
                 if c.status == psutil.CONN_LISTEN and c.laddr.port == port]
    if len(listeners) != 1 or listeners[0].laddr.ip != '127.0.0.1':
        return None
    try:
        process = psutil.Process(listeners[0].pid)
        actual = Path(process.exe())
        if actual != executable or hashlib.sha256(actual.read_bytes()).hexdigest() != digest:
            return None
        return process.pid, process.create_time()
    except (OSError, psutil.Error):
        return None
