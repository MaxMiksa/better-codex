"""Read task boundaries without exporting session content or identifiers."""
from contextlib import closing
import datetime
import json
from pathlib import Path
import sqlite3
import time

import psutil

START = {'task_started', 'turn_started'}
END = {'task_complete', 'task_completed', 'turn_complete', 'turn_aborted'}
TAIL_LIMIT = 8 * 1024 * 1024


def result(state, active=0):
    return {'state': state, 'activeCount': active, 'checkedAt': time.time()}


def latest_boundary(path, started):
    before = path.stat()
    if before.st_mtime < started:
        return 'idle'
    with path.open('rb') as stream:
        offset = max(0, before.st_size - TAIL_LIMIT)
        stream.seek(offset)
        tail = stream.read(TAIL_LIMIT)
    if not tail.endswith(b'\n'):
        return 'unknown'
    lines = tail.splitlines()
    if offset:
        lines = lines[1:]
    for line in reversed(lines):
        # Large transcript/tool records cannot establish an idle boundary.
        if len(line) > 65536:
            continue
        event = json.loads(line)
        payload = event.get('payload', {})
        kind = payload.get('type') if isinstance(payload, dict) else None
        if event.get('type') != 'event_msg' or kind not in START | END:
            continue
        stamp = datetime.datetime.fromisoformat(event['timestamp'].replace('Z', '+00:00')).timestamp()
        if stamp < started or stamp > time.time() + 2:
            return 'unknown'
        state = 'busy' if kind in START else 'idle'
        after = path.stat()
        if state == 'idle' and (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            return 'unknown'
        return state
    return 'unknown'


def assess(settings, target):
    if target is None:
        return result('idle')  # No desktop instance would be closed.
    try:
        if psutil.Process(target['pid']).create_time() != target['started']:
            return result('unknown')
        home = Path(settings.get('codexHome') or Path.home() / '.codex')
        database = home / 'state_5.sqlite'
        deadline = time.monotonic() + 2
        with closing(sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True, timeout=.3)) as db:
            data_version = db.execute('pragma data_version').fetchone()[0]
            rows = db.execute('select rollout_path from threads where updated_at>=? limit 257',
                              (int(target['started']) - 1,)).fetchall()
            unknown = len(rows) > 256
            active = 0
            for (name,) in rows[:256]:
                if time.monotonic() >= deadline:
                    unknown = True
                    break
                try:
                    state = latest_boundary(Path(name), target['started'])
                except (OSError, ValueError, KeyError, TypeError):
                    state = 'unknown'
                active += state == 'busy'
                unknown |= state == 'unknown'
            if active:
                return result('busy', active)
            if unknown or db.execute('pragma data_version').fetchone()[0] != data_version:
                return result('unknown')
        return result('idle')
    except (OSError, ValueError, KeyError, TypeError, sqlite3.Error, psutil.Error):
        return result('unknown')
