"""Identity checks and normal launch plumbing shared by startup recovery."""
import ctypes
import os
from pathlib import Path
import subprocess

import psutil

from src.platform.codex.desktop_listener import verified_listener

from src.platform.paths import ROOT


from src.platform.codex.processes import desktops, port_status


def preflight(settings, elevated=True):
    for dependency in [settings['python'], settings['node'],
                       str(Path(settings['playwright']) / 'package.json'),
                       str(Path(settings['collectorDir']) / 'metrics.py'),
                       str(ROOT / 'tools/token-hud-local/Start-ComposerHud.ps1')]:
        if not Path(dependency).is_file():
            raise ValueError('Recovery launch dependency unavailable')
    if elevated and settings.get('runAsAdministrator') is True and not ctypes.windll.shell32.IsUserAnAdmin():
        raise ValueError('Recovery requires administrator privileges')


def powershell(script, *args):
    executable = Path(os.environ['WINDIR']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
    return subprocess.Popen([str(executable), '-NoProfile', '-NonInteractive', '-STA',
        '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', str(ROOT / 'tools/token-hud-local' / script), *args],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
