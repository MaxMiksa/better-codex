"""Small, allowlisted records. Never serialize caller objects or exception text."""
from datetime import datetime, timezone
import hashlib
import math
import re
import uuid

SCHEMA_VERSION = 1
RETENTION_SECONDS = 5 * 86400
TOKEN = re.compile(r'[A-Za-z][A-Za-z0-9_-]{0,79}')
IDENTITY = re.compile(r'[a-f0-9]{32,64}')
STATES = {'pass', 'fail', 'warning', 'unknown', 'pending', 'notApplicable', 'healthy',
          'partial', 'failed', 'checking', 'success', 'blocked', 'cancelled', 'observed',
          'waiting', 'loaded', 'unavailable', 'started', 'stopped', 'idle', 'busy'}
FIELDS = {'phase', 'reason', 'previous_phase', 'state', 'activity_state', 'gateway_state',
          'proxy_state', 'network_state', 'error_category'}
NUMBERS = {'pid', 'controller_pid', 'window_count', 'active_count', 'exit_code', 'duration_ms'}
FLAGS = {'allowed', 'automatic', 'needed', 'success', 'complete', 'after_update', 'loaded'}
VERSIONS = {'package_version', 'previous_version'}


def identity():
    return uuid.uuid4().hex


def timestamp(value=None):
    if value is None:
        value = datetime.now(timezone.utc)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        value = datetime.fromtimestamp(value, timezone.utc)
    elif isinstance(value, str):
        value = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if not isinstance(value, datetime) or value.tzinfo is None:
        raise ValueError('timezone_required')
    return value.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def symbol(value):
    return isinstance(value, str) and TOKEN.fullmatch(value) is not None


def payload(value):
    """No free text, paths, URL, chat/account identity, or arbitrary nesting."""
    if not isinstance(value, dict):
        return {}
    result = {}
    for key, item in value.items():
        if key in FIELDS and symbol(item):
            result[key] = item
        elif key in NUMBERS and type(item) in (int, float) and math.isfinite(item) and abs(item) < 1e12:
            result[key] = item
        elif key in FLAGS and type(item) is bool:
            result[key] = item
        elif key in VERSIONS and isinstance(item, str) and re.fullmatch(r'\d{1,10}(?:\.\d{1,10}){1,3}', item):
            result[key] = item
        elif key == 'checks' and isinstance(item, list):
            checks = []
            for row in item[:16]:
                if not isinstance(row, dict) or not symbol(row.get('id')) or row.get('state') not in STATES:
                    continue
                clean = {'id': row['id'], 'state': row['state']}
                if isinstance(row.get('codes'), list):
                    clean['codes'] = [code for code in row['codes'][:32] if symbol(code)]
                checks.append(clean)
            result[key] = checks
    return result


def event(kind, status, source, correlation_id=None, instance=None, occurred_at=None, context=None):
    if not symbol(kind) or not symbol(source) or status not in STATES:
        raise ValueError('invalid_event')
    correlation_id = correlation_id or identity()
    if not isinstance(correlation_id, str) or not IDENTITY.fullmatch(correlation_id):
        raise ValueError('invalid_correlation')
    observed = timestamp()
    # Hash occurrence identity; no raw caller identity is persisted.
    event_id = hashlib.sha256((source + ':' + kind + ':' + str(instance or identity())).encode()).hexdigest()
    return {'event_id': event_id, 'occurred_at': timestamp(occurred_at) if occurred_at is not None else observed,
            'observed_at': observed, 'kind': kind, 'status': status, 'source': source,
            'correlation_id': correlation_id, 'payload': payload(context)}


def validate(record):
    if not isinstance(record, dict) or not IDENTITY.fullmatch(str(record.get('event_id', ''))):
        raise ValueError('invalid_event_id')
    if not IDENTITY.fullmatch(str(record.get('correlation_id', ''))):
        raise ValueError('invalid_correlation')
    if not symbol(record.get('kind')) or not symbol(record.get('source')) or record.get('status') not in STATES:
        raise ValueError('invalid_event')
    return {key: record[key] for key in ('event_id', 'kind', 'status', 'source', 'correlation_id')} | {
        'occurred_at': timestamp(record['occurred_at']), 'observed_at': timestamp(record['observed_at']),
        'payload': payload(record.get('payload'))}
