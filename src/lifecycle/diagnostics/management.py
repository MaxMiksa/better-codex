"""Read enabled entry points, update observation and runtime identity without repair."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import time

import psutil

from src.platform.paths import ROOT
from src.platform.codex.display_runtime import node_has_websocket
from src.lifecycle.diagnostics.results import parts_row, t


def read(path):
    return Path(path).read_text(encoding='utf-8-sig')


def load(path):
    return json.loads(read(path))


def part(code, state='pass'):
    return {'code': code, 'state': state}


def shell_probe(script, settings_path):
    shell = Path(os.environ['WINDIR']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
    result = subprocess.run([str(shell), '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
        '-ExecutionPolicy', 'Bypass', '-File', str(script), '-SettingsPath', str(settings_path)],
        capture_output=True, timeout=8, creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
        raise ValueError('Read-only probe unavailable')
    return result.stdout.decode('utf-8-sig').strip()


def supervisor(settings, runtime_path):
    launcher = load(runtime_path / 'launcher.json')
    created = datetime.datetime.fromisoformat(launcher['startedAt'].replace('Z', '+00:00')).timestamp()
    process = psutil.Process(launcher['supervisorPid'])
    expected = {ROOT / 'tools/token-hud-local/embedded/supervisor.py', ROOT / 'src/app/supervisor.py'}
    args = {os.path.normcase(os.path.abspath(value)) for value in process.cmdline()}
    if (abs(process.create_time() - created) >= .01 or
            os.path.normcase(process.exe()) != os.path.normcase(settings['python']) or
            not args.intersection(os.path.normcase(str(path)) for path in expected)):
        raise ValueError('Supervisor identity unavailable')
    status = load(runtime_path / 'supervisor.json')
    if not -2 <= time.time() - status['checkedAt'] < 15 or status.get('phase') == 'stopped':
        raise ValueError('Supervisor heartbeat unavailable')
    return launcher, status


def entries(settings_path):
    try:
        parts = json.loads(shell_probe(ROOT / 'src/lifecycle/diagnostics/Read-StartupEntries.ps1', settings_path))
        if not isinstance(parts, list):
            raise ValueError('Invalid entry result')
        return parts_row('entries', parts)
    except (OSError, ValueError, TypeError, subprocess.SubprocessError):
        return parts_row('entries', [part('entryUnavailable', 'unknown')])


def updates(settings, runtime_path):
    if settings.get('recoverAfterUpdate') is not True:
        return parts_row('updates', [part('updatesDisabled', 'notApplicable')])
    try:
        _, status = supervisor(settings, runtime_path)
        observation = status['updateRecovery']
        phase = observation['phase']
        if phase == 'recovery-check-unavailable' or phase == 'disabled':
            return parts_row('updates', [part('updatesUnavailable', 'unknown')])
        # This timestamp is a transition time, not a heartbeat. An old baseline
        # is healthy when the exact supervisor continues publishing fresh status.
        parts = [part('updatesReady')]
        if phase == 'waiting-updated-desktop':
            parts.append(part('updatesWaiting', 'notApplicable'))
        elif phase in ('startup-check-delegated', 'already-delegated'):
            parts.append(part('updatesDelegated', 'notApplicable'))
        elif phase != 'baseline':
            parts.append(part('updatesUnavailable', 'unknown'))
        state_path = runtime_path / 'startup-relaunch.json'
        if state_path.exists():
            recovery = load(state_path)
            if 'update:' + observation.get('observedVersion', '') in recovery.get('attempted', []):
                parts.append(part('updatesHandled', 'notApplicable'))
        return parts_row('updates', parts)
    except (OSError, ValueError, TypeError, KeyError, psutil.Error):
        return parts_row('updates', [part('updatesUnavailable', 'unknown')])


def apply_plan(result, plan):
    if plan.get('reason') != 'updated':
        return result
    if plan.get('cancelledForActivity'):
        message = t('updatesCancelled')
    elif plan.get('automatic'):
        message = t('updatesPending')
    else:
        # A prior cancel/attempt must not be interpreted as a failed monitor.
        message = t('updatesHandled')
    return {**result, 'detail': result['detail'] + '\n' + message, 'summary': message}


def runtime(checks):
    parts = []
    if checks.settings_error:
        return parts_row('runtime', [part('runtimeSettingsInvalid', 'warning')])
    if checks.config_error:
        parts.append(part('runtimeConfigInvalid', 'warning'))
    settings = checks.settings
    try:
        for filename in [settings['python'], settings['node'],
                         Path(settings['collectorDir']) / 'metrics.py']:
            if not Path(filename).is_file():
                raise ValueError('Missing dependency')
        if type(settings.get('port')) is not int or not 1024 <= settings['port'] <= 65535:
            raise ValueError('Invalid port')
        result = subprocess.run([settings['python'], '-B', '-c', 'import psutil,win32api,win32com.client,tomllib'],
                                capture_output=True, timeout=4, creationflags=subprocess.CREATE_NO_WINDOW)
        if result.returncode or not node_has_websocket(settings['node']):
            raise ValueError('Dependency probe failed')
        parts.append(part('runtimeDependenciesReady'))
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        parts.append(part('runtimeDependenciesMissing', 'warning'))
    try:
        launcher, status = supervisor(settings, checks.runtime)
        expected = shell_probe(ROOT / 'src/platform/settings/runtime_stamp.ps1', checks.settings_path)
        if expected != launcher.get('stamp'):
            parts.append(part('runtimeOldBackend', 'warning'))
        else:
            parts.append(part('runtimeBackendReady'))
        # A cumulative failed-write count alone is not evidence of current failure.
    except (OSError, ValueError, KeyError, TypeError, psutil.Error, subprocess.SubprocessError):
        parts.append(part('runtimeUnavailable', 'unknown'))
    return parts_row('runtime', parts)
