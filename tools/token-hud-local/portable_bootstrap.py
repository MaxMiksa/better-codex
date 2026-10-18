"""Prepare private bundled runtimes and launch without package downloads."""
import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
RUNTIME = ROOT / '.runtime/token-hud/embedded'
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / 'shared'))
import psutil
from desktop_package import discover
from install_taskbar_entry import install

POWERSHELL = Path(os.environ['WINDIR']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig')) if path.exists() else {}


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.next')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    temp.replace(path)


def running(settings):
    receipt = read(RUNTIME / 'runtime/launcher.json')
    try:
        process = psutil.Process(receipt['supervisorPid'])
        started = datetime.fromisoformat(receipt['startedAt'].replace('Z', '+00:00')).timestamp()
        return (Path(process.exe()) == Path(settings['python']) and
                abs(process.create_time() - started) < .001 and
                any(a.endswith('embedded\\supervisor.py') or a.endswith('embedded/supervisor.py')
                    for a in process.cmdline()))
    except (KeyError, ValueError, psutil.Error):
        return False


def prepare():
    python = ROOT / 'runtime/python/python.exe'
    node = ROOT / 'runtime/node/node.exe'
    playwright = ROOT / 'runtime/node_modules/playwright'
    if Path(sys.executable) != python:
        raise ValueError('Use the bundled Python through BetterCodex.exe')
    subprocess.run([str(node), '-e', 'require(process.argv[1]).chromium || process.exit(1)',
                    str(playwright)], check=True, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
    package = discover()
    current = read(RUNTIME / 'settings.json')
    location = read(RUNTIME / 'portable-location.json')
    previous = Path(location['root']) if location.get('root') else ROOT
    if running(current):
        if previous != ROOT:
            raise ValueError('Stop the other running copy before moving or copying this folder')
        return current
    settings = {'port': current.get('port', 19163), 'python': str(python), 'node': str(node),
                'playwright': str(playwright),
                'codexHome': current.get('codexHome') or os.environ.get('CODEX_HOME') or str(Path.home() / '.codex'),
                'collectorDir': str(HERE / 'collector')}
    if 'readingWidth' in current:
        settings['readingWidth'] = current['readingWidth']
    RUNTIME.mkdir(parents=True, exist_ok=True)
    icon = RUNTIME / 'codex.ico'
    # Only installed-app metadata and an icon are read. No model settings change.
    command = "Add-Type -AssemblyName System.Drawing; $i=[Drawing.Icon]::ExtractAssociatedIcon($env:BETTER_CODEX_APP); if(-not $i){exit 1}; $s=[IO.File]::Create($env:BETTER_CODEX_ICON); try{$i.Save($s)}finally{$s.Dispose();$i.Dispose()}"
    env = dict(os.environ, BETTER_CODEX_APP=package['executable'], BETTER_CODEX_ICON=str(icon))
    subprocess.run([str(POWERSHELL), '-NoProfile', '-NonInteractive', '-Command', command],
                   check=True, capture_output=True, env=env, creationflags=subprocess.CREATE_NO_WINDOW)
    install(previous_root=previous, quiet=True)
    write(RUNTIME / 'settings.json', settings)
    write(RUNTIME / 'portable-location.json', {'root': str(ROOT)})
    return settings


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['launch', 'check', 'prepare-only', 'stop'])
    args = parser.parse_args([a.removeprefix('--') for a in sys.argv[1:]])
    if args.mode == 'check':
        import win32com.client
        import win32api
        node = ROOT / 'runtime/node/node.exe'
        subprocess.run([str(node), '-e', 'require(process.argv[1]).chromium || process.exit(1)',
                        str(ROOT / 'runtime/node_modules/playwright')], check=True,
                       capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
        discover()
        print(json.dumps({'status': 'ready', 'bundledRuntimes': True, 'downloads': False}))
        return 0
    if args.mode == 'stop':
        stop = RUNTIME / 'runtime/stop'
        stop.parent.mkdir(parents=True, exist_ok=True)
        stop.touch()
        return 0
    prepare()
    if args.mode == 'prepare-only':
        print(json.dumps({'status': 'prepared', 'downloads': False}))
        return 0
    result = subprocess.run([str(POWERSHELL), '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                             str(HERE / 'Start-ComposerHud.ps1')], check=True, capture_output=True,
                            encoding='utf-8', creationflags=subprocess.CREATE_NO_WINDOW)
    receipt = json.loads(result.stdout.lstrip('\ufeff'))
    print(json.dumps({'status': receipt['hudReason'], 'activated': receipt['activationSucceeded']}))
    return 2 if receipt['hudReason'] == 'restart-required' else 0 if receipt['activationSucceeded'] else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, subprocess.SubprocessError, psutil.Error) as error:
        print(json.dumps({'status': 'preparation-failed', 'errorType': type(error).__name__}))
        sys.exit(1)
