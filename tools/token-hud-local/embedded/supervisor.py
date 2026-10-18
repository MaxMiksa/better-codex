"""Verify the registered desktop before attaching the local-log display."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time
import psutil

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / 'shared'))
from desktop_package import discover
from desktop_listener import verified_listener


def publish_status(status, receipt, diagnostics=None):
    temp = status.with_suffix('.next')
    try:
        temp.write_text(json.dumps(receipt), encoding='utf-8')
        temp.replace(status)
        return True
    except OSError as error:
        # Status readers can briefly deny replacement on Windows. Retry next tick;
        # an unavailable receipt must not stop the controller or create a stop flag.
        if diagnostics is not None:
            diagnostics['failures'] += 1
            diagnostics['lastError'] = {'errno': error.errno, 'winerror': getattr(error, 'winerror', None)}
        return False


def run(settings_path, runtime):
    settings = json.loads(settings_path.read_text(encoding='utf-8-sig'))
    runtime.mkdir(parents=True, exist_ok=True)
    stop, status = runtime / 'stop', runtime / 'supervisor.json'
    child, owner, package = None, None, None
    writes = {'failures': 0, 'lastError': None}
    child_exits, last_child_exit = 0, None
    try:
        while not stop.exists():
            phase = 'waiting-desktop-connection'
            try:
                if child and child.poll() is not None:
                    child_exits += 1
                    last_child_exit = child.returncode
                    child = None
                if child is None:
                    owner = None
                    listeners = [c for c in psutil.net_connections('tcp')
                                 if c.status == psutil.CONN_LISTEN and c.laddr.port == settings['port']]
                    if listeners:
                        package = discover()
                        owner = verified_listener(settings['port'], Path(package['executable']), package['sha256'])
                        if owner:
                            child = subprocess.Popen([settings['node'], str(ROOT / 'controller.cjs'),
                                str(settings_path), str(runtime)], stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
                if child:
                    phase = 'controller-running'
                receipt = {'phase': phase, 'desktopPid': owner[0] if owner else None,
                           'controllerPid': child.pid if child else None, 'packageVersion': (package or {}).get('packageVersion')}
            except (OSError, ValueError, KeyError, psutil.Error, subprocess.SubprocessError):
                receipt = {'phase': 'connection-check-unavailable'}
            receipt['checkedAt'] = time.time()
            receipt.update(writes=writes, childExits=child_exits, lastChildExit=last_child_exit)
            publish_status(status, receipt, writes)
            time.sleep(3)
    finally:
        stop.touch()
        if child and child.poll() is None:
            try:
                child.wait(timeout=6)
            except subprocess.TimeoutExpired:
                child.terminate()
                child.wait(timeout=5)
        publish_status(status, {'phase': 'stopped', 'checkedAt': time.time(), 'writes': writes}, writes)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--settings', type=Path, required=True)
    parser.add_argument('--runtime', type=Path, required=True)
    options = parser.parse_args()
    run(options.settings, options.runtime)
