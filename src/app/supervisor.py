"""Verify the registered desktop before attaching the local-log display."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time
import psutil

from src.platform.paths import ROOT
from src.interface.host.connection import DisplayConnection, owner_alive
from src.lifecycle.recovery.update_recovery import UpdateRecovery


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
    writes = {'failures': 0, 'lastError': None}
    display = DisplayConnection(settings, settings_path, runtime)
    recovery = UpdateRecovery(settings_path, runtime)
    try:
        while not stop.exists():
            try:
                receipt = display.tick()
            except (OSError, ValueError, KeyError, psutil.Error, subprocess.SubprocessError):
                receipt = {'phase': 'connection-check-unavailable'}
            receipt['checkedAt'] = time.time()
            receipt['updateRecovery'] = recovery.tick()
            receipt.update(writes=writes)
            publish_status(status, receipt, writes)
            time.sleep(3)
    finally:
        stop.touch()
        display.stop()
        publish_status(status, {'phase': 'stopped', 'checkedAt': time.time(), 'writes': writes}, writes)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--settings', type=Path, required=True)
    parser.add_argument('--runtime', type=Path, required=True)
    options = parser.parse_args()
    run(options.settings, options.runtime)
