"""Verify the registered desktop before attaching the local-log display."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import time
import psutil

from src.platform.paths import ROOT
from src.interface.host.connection import DisplayConnection, owner_alive
from src.lifecycle.recovery.update_recovery import UpdateRecovery
from src.lifecycle import runtime_events
from src.interface import runtime_events as interface_events
from src.platform.observability.store import Recorder
from src.platform.observability.events import IDENTITY


def observation_correlation(runtime, recovery_state, fallback):
    """Reuse current command/update identity; a receipt is context, never proof."""
    update_id = recovery_state.get('correlation_id')
    update_valid = isinstance(update_id, str) and IDENTITY.fullmatch(update_id)
    try:
        launch = json.loads((runtime / 'launch-request.json').read_text(encoding='utf-8'))
        observed = datetime.fromisoformat(launch['checkedAtUtc'].replace('Z', '+00:00'))
        age = (datetime.now(timezone.utc) - observed).total_seconds()
        if IDENTITY.fullmatch(str(launch.get('correlation_id', ''))):
            if update_valid and recovery_state.get('checkedAt', 0) > observed.timestamp():
                return update_id
            return launch['correlation_id'] if -2 <= age < 120 else fallback
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return update_id if update_valid else fallback


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
    events = Recorder(runtime, 'supervisor', runtime_events.correlation())
    events.emit('backend-started', 'started')
    try:
        while not stop.exists():
            try:
                receipt = display.tick()
            except (OSError, ValueError, KeyError, psutil.Error, subprocess.SubprocessError):
                receipt = {'phase': 'connection-check-unavailable'}
            receipt['checkedAt'] = time.time()
            receipt['updateRecovery'] = recovery.tick()
            try:
                events.flush()
                runtime_events.update(events, receipt['updateRecovery'])
                events.correlation_id = observation_correlation(runtime, receipt['updateRecovery'], events.correlation_id)
                interface_events.observe(events, receipt, runtime, display.owner)
            except Exception:
                pass  # Recording must never change display/recovery behavior.
            receipt.update(writes=writes)
            publish_status(status, receipt, writes)
            time.sleep(3)
    finally:
        stop.touch()
        display.stop()
        events.emit('backend-stopped', 'stopped')
        publish_status(status, {'phase': 'stopped', 'checkedAt': time.time(), 'writes': writes}, writes)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--settings', type=Path, required=True)
    parser.add_argument('--runtime', type=Path, required=True)
    options = parser.parse_args()
    run(options.settings, options.runtime)
