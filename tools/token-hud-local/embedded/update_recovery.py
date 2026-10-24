"""Observe Store upgrades and delegate once to the unified startup window."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
import time

import psutil

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / 'shared'))
from desktop_package import discover
from desktop_restart import desktops, powershell


def version(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d+(\.\d+){3}', value):
        raise ValueError('Invalid package version')
    return tuple(int(part) for part in value.split('.'))


def save_state(path, state):
    temporary = path.with_suffix('.next')
    temporary.write_text(json.dumps(state), encoding='utf-8')
    temporary.replace(path)


def initial_state(package):
    version(package['packageVersion'])
    return {'observedVersion': package['packageVersion'], 'pendingVersion': None,
            'attemptedVersion': None, 'phase': 'baseline', 'checkedAt': time.time()}


class UpdateRecovery:
    def __init__(self, settings_path, runtime):
        self.settings_path, self.runtime = settings_path, runtime
        self.path = runtime / 'update-recovery.json'
        self.state = None
        self.next_check = 0
        self.status = {'phase': 'disabled'}

    @property
    def restarting(self):
        return False  # Closing and relaunching belong to the independent window.

    def stop_dialog(self):
        pass  # The shared window owns its lifetime; never kill it from the HUD.

    def record(self, phase, **patch):
        state = {**self.state, **patch, 'phase': phase, 'checkedAt': time.time()}
        save_state(self.path, state)
        self.state = state
        self.status = dict(state)

    def tick(self):
        try:
            settings = json.loads(self.settings_path.read_text(encoding='utf-8-sig'))
            if settings.get('recoverAfterUpdate') is not True:
                self.state = None
                self.next_check = 0
                self.status = {'phase': 'disabled'}
                return self.status
            if time.monotonic() < self.next_check:
                return self.status
            self.next_check = time.monotonic() + 15
            package = discover()
            if self.state is None:
                self.state = json.loads(self.path.read_text(encoding='utf-8')) if self.path.exists() else initial_state(package)
                version(self.state['observedVersion'])
                save_state(self.path, self.state)
                self.status = dict(self.state)
            current, previous = package['packageVersion'], self.state['observedVersion']
            if current != previous:
                pending = current if version(current) > version(previous) else None
                self.record('waiting-updated-desktop' if pending else 'baseline',
                            observedVersion=current, pendingVersion=pending)
            if self.state.get('pendingVersion') != current:
                return self.status
            if self.state.get('attemptedVersion') == current:
                self.record('already-delegated', pendingVersion=None)
                return self.status
            running = desktops(package)
            mains = [p for p in running if p['main']]
            if len(mains) != 1 or time.time() - mains[0]['started'] < 15 or (self.runtime / 'stop').exists():
                return self.status
            # Persist delegation before spawning. A closed window or monitor
            # restart cannot create repeated automatic update prompts.
            self.record('startup-check-delegated', pendingVersion=None, attemptedVersion=current)
            powershell('Show-StartupCheck.ps1', '-AfterUpdate', '-SettingsPath', str(self.settings_path))
        except (OSError, ValueError, KeyError, TypeError, psutil.Error, subprocess.SubprocessError) as error:
            self.status = {'phase': 'recovery-check-unavailable', 'errorType': type(error).__name__}
        return self.status


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--initialize', action='store_true', required=True)
    parser.add_argument('--settings', type=Path, required=True)
    parser.add_argument('--runtime', type=Path, required=True)
    options = parser.parse_args()
    options.runtime.mkdir(parents=True, exist_ok=True)
    settings = json.loads(options.settings.read_text(encoding='utf-8-sig'))
    state_path = options.runtime / 'update-recovery.json'
    if settings.get('recoverAfterUpdate') is not True or not state_path.exists():
        save_state(state_path, initial_state(discover()))
    print(json.dumps({'initialized': True}))
