"""One SQLite implementation; bounded writes and strictly read-only queries."""
from contextlib import closing
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import time

from src.platform.observability.events import SCHEMA_VERSION, RETENTION_SECONDS, event, identity, timestamp, validate

BUSY_SECONDS = .12
BACKOFF_SECONDS = 15


def category(error):
    code = getattr(error, 'sqlite_errorcode', 0) & 255
    return {sqlite3.SQLITE_BUSY: 'busy', sqlite3.SQLITE_LOCKED: 'busy',
            sqlite3.SQLITE_CORRUPT: 'corrupt', sqlite3.SQLITE_NOTADB: 'corrupt',
            sqlite3.SQLITE_READONLY: 'unwritable', sqlite3.SQLITE_CANTOPEN: 'unwritable',
            sqlite3.SQLITE_FULL: 'unwritable', sqlite3.SQLITE_IOERR: 'unwritable'}.get(
                code, 'unwritable' if isinstance(error, OSError) else 'invalid')


class Store:
    def __init__(self, runtime):
        self.runtime = Path(runtime)
        self.path = self.runtime / 'observability.sqlite3'
        self.status_path = self.runtime / 'observability-status.json'
        self.retry_at = 0
        self.last_prune = None

    def health(self):
        try:
            value = json.loads(self.status_path.read_text(encoding='utf-8'))
            # Read only our schema; don't echo arbitrary files to query output.
            result = {'state': value['state'] if value.get('state') in ('healthy', 'degraded') else 'unknown'}
            for key in ('started_at', 'last_success_at', 'gap_started_at', 'gap_ended_at', 'last_failure_at'):
                if value.get(key):
                    result[key] = timestamp(value[key])
            if value.get('error_category') in ('busy', 'corrupt', 'unwritable', 'invalid', 'schema'):
                result['error_category'] = value['error_category']
            return result
        except (OSError, ValueError, KeyError, TypeError):
            return {'state': 'unknown'}

    def _status(self, success, error=None):
        """Atomic best effort, serialized briefly across writers; no event mirror."""
        lock = self.runtime / 'observability-status.lock'
        descriptor = None
        temporary = self.status_path.with_suffix('.' + identity() + '.next')
        try:
            try:
                if time.time() - lock.stat().st_mtime > 30:
                    lock.unlink()  # Recover an abandoned tiny status-write lock.
            except FileNotFoundError:
                pass
            descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            old = self.health()
            now = timestamp()
            result = dict(old, started_at=old.get('started_at', now))
            if success:
                result.update(state='healthy', last_success_at=now)
                if old.get('state') == 'degraded':
                    result['gap_ended_at'] = now
            else:
                result.update(state='degraded', error_category=error, last_failure_at=now)
                if old.get('state') != 'degraded':
                    result['gap_started_at'] = now
                    result.pop('gap_ended_at', None)
            temporary.write_text(json.dumps(result), encoding='utf-8')
            temporary.replace(self.status_path)
            return old
        except OSError:
            return {'state': 'unknown'}
        finally:
            if descriptor is not None:
                os.close(descriptor)
                try:
                    lock.unlink()
                except OSError:
                    pass
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass

    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=BUSY_SECONDS)
        try:
            connection.execute('PRAGMA busy_timeout=120')
            version = connection.execute('PRAGMA user_version').fetchone()[0]
            if version not in (0, SCHEMA_VERSION):
                raise ValueError('schema')
            if version == 0:
                connection.execute('PRAGMA journal_mode=WAL')
                with connection:
                    connection.execute('BEGIN IMMEDIATE')
                    connection.execute('CREATE TABLE IF NOT EXISTS events (event_id TEXT PRIMARY KEY, occurred_at TEXT NOT NULL, observed_at TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL, correlation_id TEXT NOT NULL, payload TEXT NOT NULL)')
                    connection.execute('CREATE INDEX IF NOT EXISTS events_time ON events(occurred_at, event_id)')
                    connection.execute('CREATE INDEX IF NOT EXISTS events_correlation ON events(correlation_id, occurred_at)')
                    connection.execute('CREATE INDEX IF NOT EXISTS events_retention ON events(observed_at)')
                    connection.execute('PRAGMA user_version=1')
            return connection
        except Exception:
            connection.close()
            raise

    @staticmethod
    def _insert(connection, record):
        record = validate(record)
        values = [record[key] for key in ('event_id', 'occurred_at', 'observed_at', 'kind', 'status', 'source', 'correlation_id')]
        values.append(json.dumps(record['payload'], ensure_ascii=True, separators=(',', ':')))
        return connection.execute('INSERT OR IGNORE INTO events VALUES (?,?,?,?,?,?,?,?)', values).rowcount == 1

    def append(self, record):
        if time.monotonic() < self.retry_at:
            return {'ok': False, 'inserted': False, 'error_category': 'backoff'}
        try:
            record = validate(record)
            self.runtime.mkdir(parents=True, exist_ok=True)
            previous = self.health()
            # Cross-process retreat as well as the per-instance budget.
            if previous.get('state') == 'degraded' and previous.get('last_failure_at'):
                failed = datetime.fromisoformat(previous['last_failure_at'].replace('Z', '+00:00'))
                if (datetime.now(timezone.utc) - failed).total_seconds() < BACKOFF_SECONDS:
                    return {'ok': False, 'inserted': False, 'error_category': 'backoff'}
            with closing(self._connect()) as connection, connection:
                prune_due = self.last_prune is None or time.monotonic() - self.last_prune >= 3600
                inserted = self._insert(connection, record)
                if previous.get('state') == 'degraded':
                    gap = previous.get('gap_started_at', previous['last_failure_at'])
                    correlation_id = hashlib.sha256(gap.encode()).hexdigest()
                    self._insert(connection, event('recorder-gap', 'failed', 'recorder', correlation_id, instance=gap,
                        occurred_at=gap, context={'error_category': previous.get('error_category', 'invalid')}))
                    self._insert(connection, event('recorder-recovered', 'success', 'recorder', correlation_id, instance=gap))
                if prune_due:
                    self.prune(connection)
            if prune_due:
                self.last_prune = time.monotonic()
            self._status(True)
            return {'ok': True, 'inserted': inserted}
        except (OSError, sqlite3.Error, ValueError, KeyError, TypeError, OverflowError) as error:
            reason = 'schema' if isinstance(error, ValueError) and error.args == ('schema',) else category(error)
            self.retry_at = time.monotonic() + BACKOFF_SECONDS
            self._status(False, reason)
            return {'ok': False, 'inserted': False, 'error_category': reason}

    def prune(self, connection, now=None):
        cutoff = timestamp((now or datetime.now(timezone.utc)) - timedelta(seconds=RETENTION_SECONDS))
        return connection.execute('DELETE FROM events WHERE observed_at < ?', (cutoff,)).rowcount

    def query(self, since=None, until=None, kind=None, source=None, correlation_id=None, limit=100):
        if type(limit) is not int or not 1 <= limit <= 1000:
            raise ValueError('invalid_limit')
        since = timestamp(since) if since else timestamp(datetime.now(timezone.utc) - timedelta(seconds=RETENTION_SECONDS))
        until = timestamp(until) if until else timestamp()
        if since > until:
            raise ValueError('invalid_range')
        health = self.health()
        result = {'schema_version': SCHEMA_VERSION, 'ok': True, 'events': [], 'health': health,
                  'coverage': {'retention_days': 5, 'since': since, 'until': until,
                               'continuous': False, 'note': 'observations_only_unrecorded_intervals_unknown'},
                  'truncated': False}
        if not self.path.exists():
            health['state'] = 'unknown'
            result['coverage']['note'] = 'database_missing'
            return result
        try:
            wal = self.path.with_name(self.path.name + '-wal')
            shm = self.path.with_name(self.path.name + '-shm')
            # SQLite may create WAL/SHM even with mode=ro. A closed/checkpointed
            # database needs immutable mode; a live WAL needs its existing SHM.
            # Never repair an incomplete WAL pair from a read command.
            if wal.exists() and not shm.exists():
                raise sqlite3.OperationalError('incomplete_snapshot')
            uri = self.path.resolve().as_uri() + ('?mode=ro' if wal.exists() else '?mode=ro&immutable=1')
            with closing(sqlite3.connect(uri, uri=True, timeout=BUSY_SECONDS)) as connection:
                connection.execute('PRAGMA query_only=ON')
                if connection.execute('PRAGMA user_version').fetchone()[0] != SCHEMA_VERSION:
                    raise ValueError('schema')
                clauses = ['occurred_at >= ?', 'occurred_at <= ?', 'observed_at >= ?']
                values = [since, until, timestamp(datetime.now(timezone.utc) - timedelta(seconds=RETENTION_SECONDS))]
                for key, value in [('kind', kind), ('source', source), ('correlation_id', correlation_id)]:
                    if value:
                        clauses.append(key + ' = ?')
                        values.append(value)
                connection.row_factory = sqlite3.Row
                rows = connection.execute('SELECT * FROM events WHERE ' + ' AND '.join(clauses) + ' ORDER BY occurred_at DESC, event_id DESC LIMIT ?', values + [limit + 1]).fetchall()
                result['truncated'] = len(rows) > limit
                for row in rows[:limit]:
                    value = dict(row)
                    value['payload'] = json.loads(value['payload'])
                    result['events'].append(validate(value))
        except (OSError, sqlite3.Error, ValueError, KeyError, TypeError) as error:
            result.update(ok=False, error_category='schema' if isinstance(error, ValueError) else category(error))
            health.update(state='unknown', error_category=result['error_category'])
            result['events'] = []
            result['coverage']['note'] = 'query_unavailable'
        return result


class Recorder:
    """Process-local transition cache; never retries a business operation."""
    def __init__(self, runtime, source, correlation_id=None):
        self.store = Store(runtime)
        self.source = source
        self.correlation_id = correlation_id or identity()
        self.instance = identity()
        self.states = {}
        self.sequence = 0
        self.pending = {}

    def emit(self, kind, status, context=None, instance=None, occurred_at=None, correlation_id=None):
        try:
            record = event(kind, status, self.source,
                correlation_id or self.correlation_id, instance or identity(), occurred_at, context)
            result = self.store.append(record)
            if not result['ok']:
                self.pending[record['event_id']] = record
                while len(self.pending) > 32:
                    self.pending.pop(next(iter(self.pending)))
            return result
        except Exception:
            return {'ok': False, 'inserted': False, 'error_category': 'invalid'}

    def flush(self):
        for key, record in list(self.pending.items()):
            if not self.store.append(record)['ok']:
                break
            self.pending.pop(key, None)

    def change(self, key, value, kind, status, context=None, correlation_id=None, occurred_at=None):
        if self.states.get(key, object()) == value:
            return
        self.states[key] = value
        self.sequence += 1
        return self.emit(kind, status, context, self.instance + ':' + str(self.sequence),
                         occurred_at, correlation_id)
