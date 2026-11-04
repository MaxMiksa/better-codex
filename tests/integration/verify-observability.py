"""Isolated history, privacy and integration checks; never operate real services."""
from contextlib import closing
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import shutil
import stat
import subprocess
import sys
import time
import unittest
from unittest.mock import patch
import zipfile

from src.platform.paths import ROOT
from src.platform.observability.events import event, identity, timestamp
from src.platform.observability.store import Store, Recorder
from src.lifecycle import runtime_events
from src.interface import runtime_events as interface_events
from src.app import startup_diagnostics
from src.app import supervisor
from src.lifecycle.recovery import relaunch

WORK = Path(sys.argv.pop(1)).resolve()
WORK.mkdir(parents=True, exist_ok=False)


class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.root = WORK / self.id().rsplit('.', 1)[1]
        self.store = Store(self.root)
        self.record = event('test-event', 'success', 'fixture')

    def cli(self, *args, value=None):
        return subprocess.run([sys.executable, '-B', '-X', 'utf8', '-m', 'src.platform.observability.cli',
            '--runtime', str(self.root), *args], cwd=ROOT, input=json.dumps(value) if value else '',
            capture_output=True, encoding='utf-8', timeout=5)

    def test_append_idempotent_and_independent_occurrences(self):
        self.assertTrue(self.store.append(self.record)['inserted'])
        self.assertFalse(self.store.append(self.record)['inserted'])
        self.assertTrue(self.store.append(event('test-event', 'success', 'fixture'))['inserted'])
        self.assertEqual(len(self.store.query()['events']), 2)
        with closing(sqlite3.connect(self.store.path)) as db:
            self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0], 1)

    def test_immutability_and_distinct_event_times(self):
        self.record['occurred_at'] = timestamp(datetime.now(timezone.utc) - timedelta(hours=1))
        self.store.append(self.record)
        changed = dict(self.record, status='failed')
        self.store.append(changed)
        saved = self.store.query()['events'][0]
        self.assertEqual(saved['status'], 'success')
        self.assertNotEqual(saved['observed_at'], saved['occurred_at'])

    def test_five_day_physical_prune_and_logical_read_retention(self):
        self.store.append(self.record)
        old = event('old-event', 'success', 'fixture')
        old['occurred_at'] = old['observed_at'] = timestamp(datetime.now(timezone.utc) - timedelta(days=6))
        self.store.append(old)
        self.assertEqual(len(self.store.query(since=old['occurred_at'])['events']), 1)
        with closing(self.store._connect()) as db, db:
            self.assertEqual(self.store.prune(db), 1)
            self.assertEqual(db.execute('SELECT count(*) FROM events').fetchone()[0], 1)

    def test_query_filters_limit_and_missing_database_are_read_only(self):
        missing = self.store.query()
        self.assertFalse(self.root.exists())
        self.assertEqual(missing['coverage']['note'], 'database_missing')
        self.store.append(self.record)
        other = event('other-event', 'failed', 'other')
        self.store.append(other)
        before = {p.name: p.read_bytes() for p in self.root.iterdir()}
        result = self.store.query(kind=self.record['kind'], source='fixture', correlation_id=self.record['correlation_id'], limit=1)
        self.assertEqual(len(result['events']), 1)
        self.assertEqual(result['events'][0]['event_id'], self.record['event_id'])
        self.assertTrue(self.store.query(limit=1)['truncated'])
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.root.iterdir()})
        with self.assertRaises(ValueError):
            self.store.query(since='2026-11-03', until='bad')

    def test_busy_other_process_is_bounded_and_gap_recovers(self):
        self.store.append(self.record)
        child = subprocess.Popen([sys.executable, '-B', '-c',
            'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("BEGIN IMMEDIATE"); print("ready",flush=True); sys.stdin.readline(); c.rollback(); c.close()', str(self.store.path)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            self.assertEqual(child.stdout.readline().strip(), 'ready')
            started = time.monotonic()
            failed = self.store.append(event('busy-event', 'failed', 'fixture'))
            self.assertFalse(failed['ok'])
            self.assertEqual(failed['error_category'], 'busy')
            self.assertLess(time.monotonic() - started, 1.5)
            # Fresh CLI process observes shared backoff, not another wait storm.
            response = self.cli('append', value=event('other-event', 'success', 'fixture'))
            self.assertEqual(json.loads(response.stdout)['error_category'], 'backoff')
            queried = self.store.query()
            self.assertEqual(queried['health']['state'], 'degraded')
            self.assertIn('gap_started_at', queried['health'])
        finally:
            child.communicate('\n', timeout=5)
        state = json.loads(self.store.status_path.read_text())
        state['last_failure_at'] = timestamp(datetime.now(timezone.utc) - timedelta(seconds=20))
        self.store.status_path.write_text(json.dumps(state))
        self.store.retry_at = 0
        self.assertTrue(self.store.append(event('retry-event', 'success', 'fixture'))['ok'])
        result = self.store.query()
        self.assertEqual(result['health']['state'], 'healthy')
        self.assertIn('gap_ended_at', result['health'])
        self.assertTrue({'recorder-gap', 'recorder-recovered'} <= {row['kind'] for row in result['events']})
        gaps = [row for row in result['events'] if row['source'] == 'recorder']
        self.assertEqual(len({row['correlation_id'] for row in gaps}), 1)

    def test_concurrent_writers_and_duplicate_delivery(self):
        self.store.append(self.record)
        inputs = [event('parallel-event', 'success', 'fixture') for _ in range(6)]
        workers = [subprocess.Popen([sys.executable, '-B', '-m', 'src.platform.observability.cli', '--runtime', str(self.root), 'append'],
            cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for _ in inputs]
        for worker, value in zip(workers, inputs):
            worker.stdin.write(json.dumps(value)); worker.stdin.close(); worker.stdin = None
        for worker in workers:
            output, error = worker.communicate(timeout=5)
            self.assertEqual(worker.returncode, 0, output + error)
        self.assertEqual(len(self.store.query()['events']), 7)

    def test_corruption_not_replaced_and_main_flow_survives(self):
        self.root.mkdir()
        self.store.path.write_bytes(b'not a sqlite database')
        self.assertFalse(self.store.append(self.record)['ok'])
        self.assertEqual(self.store.path.read_bytes(), b'not a sqlite database')
        self.assertEqual(self.store.query()['error_category'], 'corrupt')
        self.assertEqual(self.store.query()['health']['error_category'], 'corrupt')
        self.assertFalse(self.store.query()['coverage']['continuous'])

    def test_read_only_database_yields_without_affecting_caller(self):
        self.store.append(self.record)
        self.store.path.chmod(stat.S_IREAD)
        try:
            result = self.store.append(event('readonly-event', 'success', 'fixture'))
            self.assertFalse(result['ok'])
            self.assertEqual(result['error_category'], 'unwritable')
            self.assertTrue(self.store.query()['ok'])
        finally:
            self.store.path.chmod(stat.S_IREAD | stat.S_IWRITE)

    def test_unwritable_status_is_unknown_not_health_claim(self):
        self.root.mkdir()
        self.store.status_path.mkdir()
        self.assertTrue(self.store.append(self.record)['ok'])
        self.assertEqual(self.store.query()['health']['state'], 'unknown')
        self.assertFalse(self.store.query()['coverage']['continuous'])

    def test_query_unavailable_downgrades_stale_health_without_writes(self):
        for scenario in ('missing', 'corrupt', 'schema', 'unreadable'):
            with self.subTest(scenario=scenario):
                store = Store(self.root / scenario)
                self.assertTrue(store.append(self.record)['ok'])
                self.assertEqual(store.health()['state'], 'healthy')
                last_success = store.health()['last_success_at']
                if scenario == 'missing':
                    store.path.unlink()
                elif scenario == 'corrupt':
                    store.path.write_bytes(b'corrupt fixture')
                elif scenario == 'schema':
                    with closing(sqlite3.connect(store.path)) as db:
                        db.execute('PRAGMA user_version=99')
                before = {path.name: path.read_bytes() for path in store.runtime.iterdir()}
                if scenario == 'unreadable':
                    with patch('src.platform.observability.store.sqlite3.connect', side_effect=PermissionError('private-path')):
                        result = store.query()
                else:
                    result = store.query()
                self.assertEqual(result['ok'], scenario == 'missing')
                self.assertEqual(result['health']['state'], 'unknown')
                self.assertEqual(result['health']['last_success_at'], last_success)
                self.assertEqual(result['events'], [])
                if scenario != 'missing':
                    expected = {'corrupt': 'corrupt', 'schema': 'schema', 'unreadable': 'unwritable'}[scenario]
                    self.assertEqual(result['health']['error_category'], expected)
                self.assertEqual(before, {path.name: path.read_bytes() for path in store.runtime.iterdir()})

    def test_successful_query_keeps_known_recorder_degradation(self):
        self.store.append(self.record)
        state = json.loads(self.store.status_path.read_text())
        state.update(state='degraded', error_category='busy', gap_started_at=timestamp(), last_failure_at=timestamp())
        self.store.status_path.write_text(json.dumps(state))
        before = self.store.status_path.read_bytes()
        result = self.store.query()
        self.assertTrue(result['ok'])
        self.assertEqual(result['health']['state'], 'degraded')
        self.assertEqual(result['health']['error_category'], 'busy')
        self.assertEqual(self.store.status_path.read_bytes(), before)

    def test_abandoned_status_lock_can_recover(self):
        self.root.mkdir()
        lock = self.root / 'observability-status.lock'
        lock.touch()
        os.utime(lock, (time.time() - 60, time.time() - 60))
        self.assertTrue(self.store.append(self.record)['ok'])
        self.assertEqual(self.store.health()['state'], 'healthy')
        self.assertFalse(lock.exists())

    def test_sensitive_fields_are_absent_from_database_and_status(self):
        sentinel = 'PRIVATE_TOKEN_https://private.invalid/chat?secret=1'
        self.record['payload'] = {'title': sentinel, 'authorization': sentinel, 'account': sentinel,
            'url': sentinel, 'exception': sentinel, 'reason': sentinel, 'package_version': sentinel,
            'checks': [{'id': 'app', 'state': 'pass', 'detail': sentinel, 'codes': [sentinel]}]}
        self.store.append(self.record)
        for path in self.root.iterdir():
            self.assertNotIn(sentinel.encode(), path.read_bytes())
        self.assertEqual(self.store.query()['events'][0]['payload'], {'checks': [{'id': 'app', 'state': 'pass', 'codes': []}]})

    def test_cli_json_validation_and_allowlist(self):
        result = self.cli('append', value=self.record)
        self.assertEqual(result.returncode, 0)
        self.assertTrue(json.loads(result.stdout)['inserted'])
        queried = self.cli('query', '--kind', 'test-event', '--limit', '1')
        self.assertEqual(queried.returncode, 0)
        self.assertEqual(len(json.loads(queried.stdout)['events']), 1)
        for arguments in [('query', '--limit', '0'), ('query', '--since', 'private-bad-date'), ('query', '--unknown'), ('append', '--unknown')]:
            bad = self.cli(*arguments)
            self.assertEqual(bad.returncode, 2)
            self.assertEqual(json.loads(bad.stdout)['error_category'], 'invalid_arguments')
            self.assertNotIn('private-bad-date', bad.stdout + bad.stderr)

    def test_powershell_stable_bridge_from_another_directory(self):
        self.store.append(self.record)
        settings = self.root / 'settings.json'
        settings.write_text(json.dumps({'python': sys.executable}), encoding='utf-8')
        shells = [str(Path(os.environ['WINDIR']) / 'System32/WindowsPowerShell/v1.0/powershell.exe')]
        if shutil.which('pwsh'):
            shells.append(shutil.which('pwsh'))
        before = self.store.path.read_bytes()
        for shell in shells:
            completed = subprocess.run([shell, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                str(ROOT / 'tools/token-hud-local/Get-RuntimeHistory.ps1'), '-SettingsPath', str(settings),
                '-Runtime', str(self.root), '-Kind', 'test-event', '-Source', 'fixture',
                '-CorrelationId', self.record['correlation_id'], '-Since', '2020-01-01T00:00:00Z', '-Limit', '1'],
                cwd=WORK, capture_output=True, encoding='utf-8-sig', errors='replace', timeout=10)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            result = json.loads(completed.stdout)
            self.assertTrue(result['ok'])
            self.assertEqual(len(result['events']), 1)
        self.assertEqual(before, self.store.path.read_bytes())

    def test_powershell_failures_keep_the_query_response_shape(self):
        self.root.mkdir()
        missing = self.root / 'private-missing-settings.json'
        broken = self.root / 'private-broken-settings.json'
        broken.write_text('not json')
        interpreter = self.root / 'private-missing-interpreter.json'
        interpreter.write_text(json.dumps({'python': str(self.root / 'private-missing-python.exe')}))
        runtime = self.root / 'history'
        shells = [str(Path(os.environ['WINDIR']) / 'System32/WindowsPowerShell/v1.0/powershell.exe')]
        if shutil.which('pwsh'):
            shells.append(shutil.which('pwsh'))
        for shell in shells:
            for settings in (missing, broken, interpreter):
                with self.subTest(shell=Path(shell).name, settings=settings.name):
                    completed = subprocess.run([shell, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                        str(ROOT / 'tools/token-hud-local/Get-RuntimeHistory.ps1'), '-SettingsPath', str(settings),
                        '-Runtime', str(runtime)], cwd=WORK, capture_output=True, encoding='utf-8-sig', errors='replace', timeout=10)
                    result = json.loads(completed.stdout)
                    self.assertEqual(set(result), {'schema_version', 'ok', 'error_category', 'events', 'health', 'coverage', 'truncated'})
                    self.assertFalse(result['ok'])
                    self.assertEqual(result['events'], [])
                    self.assertEqual(result['health']['state'], 'unknown')
                    self.assertEqual(result['coverage']['note'], 'query_runtime_unavailable')
                    self.assertFalse(result['coverage']['continuous'])
                    self.assertFalse(result['truncated'])
                    self.assertNotIn('private-', completed.stdout + completed.stderr)
        self.assertFalse(runtime.exists())

    def test_query_sees_committed_live_wal_without_writing_database(self):
        self.store.append(self.record)
        with closing(self.store._connect()) as db:
            self.store._insert(db, event('wal-event', 'success', 'fixture'))
            db.commit()
            before = {path.name: path.read_bytes() for path in self.root.iterdir() if not path.name.endswith('-shm')}
            self.assertEqual(len(self.store.query()['events']), 2)
            self.assertEqual(before, {path.name: path.read_bytes() for path in self.root.iterdir() if not path.name.endswith('-shm')})

    def test_supervisor_business_loop_survives_corrupt_history(self):
        self.root.mkdir()
        self.store.path.write_bytes(b'corrupt fixture')
        settings = self.root / 'settings.json'
        settings.write_text('{}')
        def end_tick(_):
            (self.root / 'stop').touch()
        with patch.object(supervisor, 'DisplayConnection') as display, \
                patch.object(supervisor, 'UpdateRecovery') as update, \
                patch.object(supervisor.time, 'sleep', side_effect=end_tick):
            display.return_value.tick.return_value = {'phase': 'waiting-desktop-connection'}
            display.return_value.owner = None
            update.return_value.tick.return_value = {'phase': 'disabled'}
            supervisor.run(settings, self.root)
            display.return_value.stop.assert_called_once()
        self.assertEqual(json.loads((self.root / 'supervisor.json').read_text())['phase'], 'stopped')
        self.assertEqual(self.store.path.read_bytes(), b'corrupt fixture')

    def test_write_exception_is_sanitized_and_failed_event_can_retry(self):
        rec = Recorder(self.root, 'fixture')
        with patch.object(rec.store, '_connect', side_effect=PermissionError('PRIVATE secret https://private')):
            self.assertFalse(rec.emit('test-event', 'failed')['ok'])
        self.assertEqual(len(rec.pending), 1)
        record = next(iter(rec.pending.values()))
        state = json.loads(rec.store.status_path.read_text())
        state['last_failure_at'] = timestamp(datetime.now(timezone.utc) - timedelta(seconds=20))
        rec.store.status_path.write_text(json.dumps(state))
        rec.store.retry_at = 0
        rec.flush()
        self.assertEqual(len(rec.pending), 0)
        saved = self.store.query(kind='test-event')['events'][0]
        self.assertEqual(saved['observed_at'], record['observed_at'])
        self.assertNotIn('PRIVATE', rec.store.status_path.read_text())

    def test_busy_recovery_does_not_poison_the_owners_final_result(self):
        settings = self.root / 'settings.json'
        correlation_id, nonce = identity(), identity()
        plan = {'correlation_id': correlation_id}
        with patch.object(relaunch, '_execute', side_effect=relaunch.RelaunchBusy('private-error')):
            with self.assertRaises(relaunch.RelaunchBusy):
                relaunch.execute(settings, plan, nonce)
        store = Store(self.root / 'runtime')
        self.assertEqual(store.query(kind='recovery-result')['events'], [])
        with patch.object(relaunch, '_execute', return_value={'success': True, 'reason': 'relaunchComplete'}):
            relaunch.execute(settings, plan, nonce)
        result = store.query(kind='recovery-result', correlation_id=correlation_id)['events']
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['status'], 'success')

    def test_mapping_rejects_bad_correlation_and_accepts_null_activity(self):
        settings = self.root / 'settings.json'
        self.assertTrue(runtime_events.recovery(settings, 'recovery-result', 'success', {'activity': None})['ok'])
        store = Store(self.root / 'runtime')
        self.assertEqual(len(store.query(kind='recovery-result')['events']), 1)
        rec = Recorder(self.root / 'runtime', 'supervisor')
        for index, invalid in enumerate((None, 'private-invalid-id', 123, ['private-invalid-id'])):
            runtime_events.update(rec, {'phase': 'phase' + str(index), 'correlation_id': invalid})
        events = store.query(kind='update-state')['events']
        self.assertEqual(len(events), 4)
        self.assertTrue(all(row['correlation_id'] == rec.correlation_id for row in events))
        self.assertNotIn('private-invalid', json.dumps(events))

    def test_future_schema_is_not_migrated_or_destroyed(self):
        self.store.append(self.record)
        with closing(sqlite3.connect(self.store.path)) as db:
            db.execute('PRAGMA user_version=99')
        self.assertFalse(self.store.append(event('new-event', 'success', 'fixture'))['ok'])
        self.assertEqual(self.store.query()['error_category'], 'schema')
        with closing(sqlite3.connect(self.store.path)) as db:
            self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0], 99)

    def report(self):
        return {'state': 'healthy', 'checkedAt': timestamp(), 'packageVersion': '1.2.3.4',
                'rows': [{'id': key, 'state': 'pass', 'detail': 'private-data https://private'} for key in runtime_events.CHECK_IDS[:6]],
                'managementRows': [{'id': key, 'state': 'pass'} for key in runtime_events.CHECK_IDS[6:]]}

    def test_full_diagnostics_distinct_instances_and_terminal_reasons(self):
        rec = Recorder(self.root, 'diagnostics')
        data = self.report()
        runtime_events.diagnostic(rec, data, 'first')
        runtime_events.diagnostic(rec, data, 'first')
        runtime_events.diagnostic(rec, data, 'second')
        runtime_events.diagnostic(rec, {}, 'third', 'workerTimeout')
        result = self.store.query(kind='diagnostic-completed')['events']
        self.assertEqual(len(result), 3)
        self.assertTrue(all(len(row['payload']['checks']) == 10 for row in result))
        failed = next(row for row in result if not row['payload']['complete'])
        self.assertTrue(all(row['codes'] == ['workerTimeout'] for row in failed['payload']['checks']))
        self.assertNotIn('private-data', json.dumps(result))
        self.assertEqual(len(self.store.query(kind='network-state')['events']), 2)

    def test_message_codes_allow_dynamic_reason_without_private_values(self):
        row = {'detail': runtime_events.MESSAGES['en']['check.workerStopped'].replace('{code}', '123')}
        self.assertIn('workerStopped', runtime_events.reasons(row))
        self.assertNotIn('123', json.dumps(runtime_events.reasons(row)))

    def test_display_changes_ignore_heartbeat_and_stale_controller(self):
        rec = Recorder(self.root, 'supervisor')
        receipt = {'phase': 'controller-running', 'controllerPid': 123}
        snapshot = {'controllerPid': 123, 'checkedAt': time.time() * 1000,
                    'windows': [{'checkedAt': time.time() * 1000, 'visible': True, 'fileChanges': {'cards': 0}, 'readingWidth': {'applied': True}}]}
        self.root.mkdir()
        (self.root / 'view-status.json').write_text(json.dumps(snapshot))
        owner = (99, time.time() - 10)
        interface_events.observe(rec, receipt, self.root, owner)
        interface_events.observe(rec, receipt, self.root, owner)
        self.assertEqual(len(self.store.query(kind='enhancement-state')['events']), 1)
        snapshot['controllerPid'] = 456
        (self.root / 'view-status.json').write_text(json.dumps(snapshot))
        interface_events.observe(rec, receipt, self.root, owner)
        interface_events.observe(rec, {'phase': 'waiting-desktop-connection', 'desktopGone': list(owner)}, self.root)
        self.assertEqual(len(self.store.query(kind='enhancement-state')['events']), 3)
        self.assertEqual(len(self.store.query(kind='desktop-exit-observed')['events']), 1)
        launch_id, update_id = identity(), identity()
        (self.root / 'launch-request.json').write_text(json.dumps({'checkedAtUtc': timestamp(), 'correlation_id': launch_id}))
        self.assertEqual(supervisor.observation_correlation(self.root, {'correlation_id': update_id, 'checkedAt': time.time() + 1}, identity()), update_id)
        self.assertEqual(supervisor.observation_correlation(self.root, {'correlation_id': update_id, 'checkedAt': time.time() - 10}, identity()), launch_id)

    def test_worker_failure_recording_is_fail_open(self):
        self.root.mkdir()
        settings, output = self.root / 'settings.json', self.root / 'result.json'
        with patch.object(sys, 'argv', ['worker', '--settings', str(settings), '--output', str(output)]), \
                patch.object(startup_diagnostics, 'run', side_effect=RuntimeError('private-message')):
            with self.assertRaises(RuntimeError):
                startup_diagnostics.main()
        self.assertEqual(len(Store(self.root / 'runtime').query(kind='diagnostic-completed')['events']), 1)

    def test_packaging_both_sets_exclude_local_history(self):
        spec = importlib.util.spec_from_file_location('package_scope', ROOT / 'scripts/package.py')
        package = importlib.util.module_from_spec(spec); spec.loader.exec_module(package)
        for include_tests in (False, True):
            files = package.public_files(include_tests)
            self.assertTrue(any(path.name == 'Get-RuntimeHistory.ps1' for path in files))
            self.assertTrue(any(path.name == 'store.py' and 'observability' in path.parts for path in files))
            self.assertFalse(any('.runtime' in path.parts or path.suffix in ('.sqlite3', '.sqlite3-wal', '.sqlite3-shm') for path in files))
            # Use the real export file selector in an isolated package-content ZIP.
            self.root.mkdir(exist_ok=True)
            archive = self.root / ('source.zip' if include_tests else 'runtime.zip')
            with zipfile.ZipFile(archive, 'w') as bundle:
                for path in files:
                    bundle.write(path, path.relative_to(ROOT).as_posix())
            with zipfile.ZipFile(archive) as bundle:
                self.assertFalse(any('observability.sqlite3' in name or name.startswith('.runtime/') for name in bundle.namelist()))


if __name__ == '__main__':
    unittest.main()
