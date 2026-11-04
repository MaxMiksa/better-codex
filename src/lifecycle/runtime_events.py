"""Lifecycle meanings over existing observations, never a second probe chain."""
import json
import os
from pathlib import Path
import re

from src.platform.i18n.localization import MESSAGES
from src.platform.observability.events import IDENTITY, identity
from src.platform.observability.store import Recorder

CHECK_IDS = ('app', 'sessions', 'sandbox', 'network', 'enhancements', 'permissions',
             'prompts', 'updates', 'entries', 'runtime')


def correlation(value=None):
    value = value or os.environ.get('BETTER_CODEX_CORRELATION_ID', '')
    return value if isinstance(value, str) and IDENTITY.fullmatch(value) else identity()


def recorder(settings, source, correlation_id=None):
    return Recorder(Path(settings).parent / 'runtime', source, correlation(correlation_id))


def reasons(row):
    # Translate only recognized message templates back to stable codes. Dynamic
    # values (paths, counts, config strings) are never copied into history.
    codes = set()
    for catalogue in MESSAGES.values():
        for key, template in catalogue.items():
            if not key.startswith(('check.', 'launch.')) or not isinstance(template, str):
                continue
            pattern = re.escape(template)
            pattern = re.sub(r'\\\{\w+\\\}', r'[^\\n]*', pattern)
            for field in ('detail', 'summary', 'suggestion'):
                value = row.get(field)
                if isinstance(value, str) and re.search(r'(?:^|\n)' + pattern + r'(?:$|\n)', value):
                    codes.add(key.split('.', 1)[1])
    return sorted(codes) or ['evidenceUnavailable']


def check_rows(data, terminal=None):
    source = {row.get('id'): row for row in data.get('rows', []) + data.get('managementRows', []) if isinstance(row, dict)}
    result = []
    for key in CHECK_IDS:
        row = source.get(key, {'id': key, 'state': 'pending'})
        unfinished = row.get('state') == 'pending'
        result.append({'id': key, 'state': 'unknown' if terminal and unfinished else row.get('state', 'unknown'),
                       'codes': [terminal] if terminal and unfinished else reasons(row)})
    return result


def diagnostic(rec, data, instance, terminal=None):
    checks = check_rows(data, terminal)
    if not terminal and any(row['state'] == 'pending' for row in checks):
        return
    if terminal:
        rec.emit('diagnostic-ended', 'cancelled' if terminal == 'cancelled' else 'unknown',
                 {'reason': terminal}, instance=instance)
    context = {'checks': checks, 'complete': not terminal,
               'package_version': data.get('packageVersion'), 'reason': terminal or 'completed'}
    rec.emit('diagnostic-completed', data.get('state', 'unknown') if not terminal else 'unknown',
             context, instance=instance, occurred_at=data.get('checkedAt'))
    network = next(row for row in checks if row['id'] == 'network')
    # Cross-process comparison uses the latest event, never repeats a network check.
    previous = rec.store.query(kind='network-state', limit=1)
    if not previous['events'] or previous['events'][0]['payload'].get('checks') != [network]:
        rec.emit('network-state', network['state'], {'checks': [network]}, instance=instance)
    plan = data.get('relaunch')
    if isinstance(plan, dict) and plan.get('needed'):
        activity = plan.get('activity') if isinstance(plan.get('activity'), dict) else {}
        rec.emit('recovery-triggered', 'blocked' if not plan.get('allowed') else 'observed',
                 {'reason': plan.get('reason'), 'allowed': bool(plan.get('allowed')),
                  'automatic': bool(plan.get('automatic')), 'activity_state': activity.get('state')},
                 instance=instance)
        if not plan.get('allowed'):
            rec.emit('recovery-blocked', 'blocked', {'reason': 'sessionBusy' if activity.get('state') == 'busy' else 'sessionUnknown'}, instance=instance)


def update(rec, state):
    phase = state.get('phase', 'unknown')
    correlation_id = state.get('correlation_id')
    if not isinstance(correlation_id, str) or not IDENTITY.fullmatch(correlation_id):
        correlation_id = rec.correlation_id
    rec.change('update', (phase, state.get('observedVersion'), state.get('pendingVersion')),
        'update-state', 'unavailable' if phase == 'recovery-check-unavailable' else 'observed',
        {'phase': phase, 'package_version': state.get('observedVersion'), 'previous_version': state.get('previousVersion')},
        correlation_id=correlation_id, occurred_at=state.get('checkedAt'))


def recovery(settings, kind, status, plan=None, reason=None, instance=None):
    plan = plan or {}
    rec = recorder(settings, 'recovery', plan.get('correlation_id'))
    activity = plan.get('activity') if isinstance(plan.get('activity'), dict) else {}
    return rec.emit(kind, status, {'reason': reason or plan.get('reason'),
        'package_version': plan.get('packageVersion'), 'activity_state': activity.get('state'),
        'allowed': bool(plan.get('allowed')), 'automatic': bool(plan.get('automatic'))}, instance=instance)


def update_correlation(runtime, after_update=False):
    if after_update:
        try:
            state = json.loads((Path(runtime) / 'update-recovery.json').read_text(encoding='utf-8'))
            if IDENTITY.fullmatch(str(state.get('correlation_id', ''))):
                return state['correlation_id']
        except (OSError, ValueError, TypeError):
            pass
    return correlation()
