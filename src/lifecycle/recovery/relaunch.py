"""Plan a bounded relaunch; only an explicit execute request may close Codex."""
import argparse
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import re
import sys
import time

import psutil
import win32api
import win32event

HERE = Path(__file__).resolve().parent
from src.platform.codex.desktop_package import discover
from src.lifecycle.recovery.desktop_restart import desktops, port_status, preflight, powershell
from src.platform.windows.desktop_windows import request_close
from src.lifecycle.recovery.session_activity import assess as session_activity
from src.lifecycle import runtime_events


class RelaunchBusy(ValueError):
    pass


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.next')
    temporary.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
    temporary.replace(path)


@contextmanager
def locked(settings):
    name = hashlib.sha256(str(Path(settings).resolve()).lower().encode()).hexdigest()[:24]
    mutex = win32event.CreateMutex(None, False, 'Local\\BetterCodexRelaunch-' + name)
    held = False
    try:
        held = win32event.WaitForSingleObject(mutex, 0) in (win32event.WAIT_OBJECT_0, win32event.WAIT_ABANDONED)
        if not held:
            raise RelaunchBusy('Relaunch already in progress')
        yield
    finally:
        if held:
            win32event.ReleaseMutex(mutex)
        win32api.CloseHandle(mutex)


def state_path(settings):
    return Path(settings).parent / 'runtime/startup-relaunch.json'


def load_state(settings):
    path = state_path(settings)
    return read(path) if path.exists() else {'attempted': []}


def newer(current, previous):
    if not isinstance(previous, str) or not re.fullmatch(r'\d+(\.\d+){3}', previous):
        return False
    return tuple(map(int, current.split('.'))) > tuple(map(int, previous.split('.')))


def prepare(settings_path, package, enhancement, after_update=False):
    """Called once after all probes finish, never while results are pending."""
    with locked(settings_path):
        settings = read(settings_path)
        preflight(settings)
        running = desktops(package)
        mains = [p for p in running if p['main']]
        if len(mains) > 1 or (running and not mains):
            return {'allowed': False}
        state = load_state(settings_path)
        current = package['packageVersion']
        if after_update or newer(current, state.get('observedVersion')):
            state['pendingUpdate'] = current
        state['observedVersion'] = current
        fault_key, update_key = 'plugins:' + current, 'update:' + current
        if enhancement['state'] == 'pass':
            state['attempted'] = [key for key in state['attempted'] if key != fault_key]
        if state.get('pendingUpdate') == current and update_key in state['attempted']:
            state.pop('pendingUpdate', None)
        updated = state.get('pendingUpdate') == current
        key = update_key if updated else fault_key
        needed = updated or enhancement.get('restartRecommended') is True
        automatic = (updated or enhancement.get('restartRecommended') is True) and key not in state['attempted']
        save(state_path(settings_path), state)
        activity = session_activity(settings, mains[0] if mains else None)
        cancelled = automatic and activity['state'] != 'idle'
        if cancelled:
            remember_cancel(settings_path, key)
            if enhancement.get('restartRecommended') is True:
                remember_cancel(settings_path, fault_key)
        return {'allowed': activity['state'] == 'idle', 'needed': needed,
                'automatic': automatic and not cancelled, 'cancelledForActivity': cancelled,
                'pluginFailure': enhancement.get('restartRecommended') is True,
                'activity': activity, 'key': key,
                'reason': 'updated' if updated else 'plugins', 'packageVersion': current,
                'packageHash': package['sha256'], 'target': mains[0] if mains else None}


def mark_attempt(settings_path, plan):
    state = load_state(settings_path)
    keys = [plan['key'], 'plugins:' + plan['packageVersion'], 'update:' + plan['packageVersion']]
    state['attempted'] = list(dict.fromkeys(state['attempted'] + keys))[-32:]
    state.pop('pendingUpdate', None)
    save(state_path(settings_path), state)


def cancel(settings_path, key, plugin_failure=False, correlation_id=None, activity_block=False):
    if not re.fullmatch(r'(plugins|update):\d+(\.\d+){3}', key):
        raise ValueError('Invalid recovery key')
    with locked(settings_path):
        remember_cancel(settings_path, key)
        if plugin_failure:
            remember_cancel(settings_path, 'plugins:' + key.split(':', 1)[1])
    runtime_events.recovery(settings_path, 'recovery-blocked' if activity_block else 'recovery-cancelled',
        'blocked' if activity_block else 'cancelled', {'correlation_id': correlation_id, 'packageVersion': key.split(':', 1)[1]},
        reason='sessionProtection' if activity_block else 'userCancelled')


def remember_cancel(settings_path, key):
    state = load_state(settings_path)
    state['attempted'] = list(dict.fromkeys(state['attempted'] + [key]))[-32:]
    if key.startswith('update:'):
        current = key.split(':', 1)[1]
        if state.get('pendingUpdate') == current:
            state.pop('pendingUpdate', None)
        if not state.get('observedVersion') or newer(current, state['observedVersion']):
            state['observedVersion'] = current
    save(state_path(settings_path), state)


def cancel_check(settings_path, version_hint=None, after_update=False, correlation_id=None):
    current = version_hint or discover()['packageVersion']
    if not re.fullmatch(r'\d+(\.\d+){3}', current):
        raise ValueError('Invalid package version')
    with locked(settings_path):
        state = load_state(settings_path)
        if after_update or newer(current, state.get('observedVersion')) or state.get('pendingUpdate') == current:
            remember_cancel(settings_path, 'update:' + current)
    runtime_events.recovery(settings_path, 'recovery-cancelled', 'cancelled',
        {'correlation_id': correlation_id, 'packageVersion': current}, reason='checkCancelled')


def _execute(settings_path, plan, nonce=None):
    """Revalidate the exact instance before normal exit, then use the full entry."""
    with locked(settings_path):
        state = load_state(settings_path)
        if nonce and nonce in state.get('consumedRequests', []):
            return None
        if nonce:
            state['consumedRequests'] = (state.get('consumedRequests', []) + [nonce])[-16:]
            save(state_path(settings_path), state)
        if plan.get('key') not in ('update:' + plan['packageVersion'], 'plugins:' + plan['packageVersion']):
            raise ValueError('Invalid relaunch plan')
        try:
            settings = read(settings_path)
            preflight(settings)
            package = discover()
            running = desktops(package)
            mains = [p for p in running if p['main']]
            target = plan.get('target')
            valid = (plan.get('allowed') and
                     (package['packageVersion'], package['sha256']) == (plan['packageVersion'], plan['packageHash']) and
                     mains == ([target] if target else []) and not (running and not target))
            # Recheck immediately before the close call; never act on a replacement PID.
            valid = valid and discover() == package and sorted(desktops(package), key=lambda p: p['pid']) == sorted(running, key=lambda p: p['pid'])
        except (OSError, ValueError, KeyError, TypeError, psutil.Error):
            mark_attempt(settings_path, plan)  # Preserve failure suppression before any exit request.
            raise
        if not valid:
            mark_attempt(settings_path, plan)
            return {'success': False, 'reason': 'instanceChanged'}
        activity = session_activity(settings, target)
        if activity['state'] != 'idle':
            if plan.get('automatic'):
                remember_cancel(settings_path, plan['key'])
                if plan.get('pluginFailure'):
                    remember_cancel(settings_path, 'plugins:' + plan['packageVersion'])
            return {'success': False, 'reason': 'sessionBusy' if activity['state'] == 'busy' else 'sessionUnknown',
                    'activity': activity}
        mark_attempt(settings_path, plan)
        if target:
            runtime_events.recovery(settings_path, 'desktop-exit-requested', 'observed', plan, instance=nonce)
            if not request_close(target['pid'], target['started']) and desktops(package):
                runtime_events.recovery(settings_path, 'desktop-exit-result', 'failed', plan, reason='closeFailed', instance=nonce)
                return {'success': False, 'reason': 'closeFailed'}
            deadline = time.monotonic() + 20
            while desktops(package):
                if time.monotonic() >= deadline:
                    runtime_events.recovery(settings_path, 'desktop-exit-result', 'failed', plan, reason='closeFailed', instance=nonce)
                    return {'success': False, 'reason': 'closeFailed'}
                time.sleep(.25)
            runtime_events.recovery(settings_path, 'desktop-exit-result', 'success', plan, instance=nonce)
        # Complete this launch even if the diagnostic window is closed meanwhile.
        # Normal entry prepares the supervisor and all enabled enhancements.
        launch = powershell('Start-ComposerHud.ps1', '-StartupCheckStarted', '-CorrelationId',
                            runtime_events.correlation(plan.get('correlation_id')))
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            current = discover()
            # The cold-start entry can persist a new port around a stale listener.
            settings = read(settings_path)
            if port_status(settings, current) == 'verified':
                return {'success': True, 'reason': 'relaunchComplete'}
            if launch.poll() not in (None, 0):
                break
            time.sleep(.5)
        return {'success': False, 'reason': 'relaunchFailed'}


def execute(settings_path, plan, nonce=None):
    # Observation is outside the protected action; it cannot change its result.
    plan = dict(plan, correlation_id=runtime_events.correlation(plan.get('correlation_id')))
    runtime_events.recovery(settings_path, 'recovery-execution', 'started', plan, instance=nonce)
    try:
        result = _execute(settings_path, plan, nonce)
    except RelaunchBusy:
        runtime_events.recovery(settings_path, 'recovery-blocked', 'blocked', plan, reason='actionInProgress', instance=nonce)
        raise
    except Exception:
        runtime_events.recovery(settings_path, 'recovery-result', 'failed', plan, reason='executionUnavailable', instance=nonce)
        raise
    if result is not None:
        blocked = result.get('reason') in ('sessionBusy', 'sessionUnknown', 'instanceChanged')
        runtime_events.recovery(settings_path, 'recovery-result', 'success' if result.get('success') else 'blocked' if blocked else 'failed',
                               plan, reason=result.get('reason'), instance=nonce)
    return result


def execute_request(settings_path):
    runtime = Path(settings_path).parent / 'runtime'
    request = read(runtime / 'startup-relaunch-request.json')
    nonce = request.get('nonce', '')
    if not re.fullmatch(r'[a-f0-9]{32}', nonce) or not 0 <= time.time() - request['createdAt'] < 120:
        raise ValueError('Expired recovery request')
    output = runtime / 'startup-check' / nonce / 'action.json'
    try:
        result = execute(settings_path, request['plan'], nonce)
    except RelaunchBusy:
        return  # An existing action owns the result; do not overwrite it.
    except (OSError, ValueError, KeyError, TypeError, psutil.Error):
        result = {'success': False, 'reason': 'relaunchFailed'}
    if result is not None:
        save(output, result)


def check_activity(settings_path, output, pid=None, started=None):
    target = {'pid': pid, 'started': started} if pid is not None else None
    save(output, session_activity(read(settings_path), target))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--settings', type=Path, required=True)
    operation = parser.add_mutually_exclusive_group(required=True)
    operation.add_argument('--execute', action='store_true')
    operation.add_argument('--cancel')
    operation.add_argument('--cancel-check', action='store_true')
    operation.add_argument('--activity', action='store_true')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--target-pid', type=int)
    parser.add_argument('--target-started', type=float)
    parser.add_argument('--version')
    parser.add_argument('--after-update', action='store_true')
    parser.add_argument('--plugin-failure', action='store_true')
    parser.add_argument('--activity-block', action='store_true')
    parser.add_argument('--correlation-id')
    args = parser.parse_args()
    if args.execute:
        execute_request(args.settings)
    elif args.cancel:
        cancel(args.settings, args.cancel, args.plugin_failure, args.correlation_id, args.activity_block)
    elif args.activity:
        if not args.output:
            parser.error('--activity requires --output')
        check_activity(args.settings, args.output, args.target_pid, args.target_started)
    else:
        cancel_check(args.settings, args.version, args.after_update, args.correlation_id)
