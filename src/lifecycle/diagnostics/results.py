"""Localized diagnostic rows; only sanitized explanations cross this boundary."""
import datetime

from src.platform.i18n.localization import text


def t(key, **values):
    return text('check.' + key, **values)


def row(key, state, detail='', suggestion='', status=None, summary=None):
    return {'id': key, 'label': t(key), 'state': state, 'status': status or t('unknownStatus' if state == 'unknown' else state),
            'detail': detail, 'summary': summary, 'suggestion': suggestion}


def summarize(rows):
    if any(r['state'] == 'pending' for r in rows):
        return 'checking'
    if any(r['state'] == 'fail' and r['id'] in ('app', 'sessions', 'sandbox', 'network') for r in rows):
        return 'failed'
    if any(r['state'] in ('fail', 'warning') for r in rows):
        return 'partial'
    if any(r['state'] == 'unknown' for r in rows):
        return 'unknown'
    return 'healthy'


def report(rows, version=None):
    state = summarize(rows)
    return {'state': state, 'title': t(state), 'description': t(state + 'Description'),
            'rows': rows, 'checkedAt': datetime.datetime.now().astimezone().isoformat(timespec='seconds'),
            'packageVersion': version or '', 'note': t('note'), 'modelMessageSent': False}


def parts_row(key, parts):
    rows = [{'id': key, 'state': part['state']} for part in parts]
    state = summarize(rows)
    state = {'healthy': 'pass', 'partial': 'warning', 'checking': 'pending'}.get(state, state)
    if all(part['state'] == 'notApplicable' for part in parts):
        state = 'notApplicable'
    priority = {'fail': 5, 'warning': 4, 'unknown': 3, 'pending': 2, 'pass': 1, 'notApplicable': 1}
    brief = max(parts, key=lambda part: priority[part['state']])
    return row(key, state, '\n'.join(t(part['code']) for part in parts), summary=t(brief['code']))
