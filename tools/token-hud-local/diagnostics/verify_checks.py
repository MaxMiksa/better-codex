"""Targeted diagnostic policy checks using private fixtures, never live probes."""
import json
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import ssl
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch, Mock
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parent))
import checks


class DiagnosticChecks(unittest.TestCase):
    def setUp(self):
        self.workspace = Path(__file__).resolve().parents[3]
        self.validation = self.workspace / '.validation-runtime/startup-check-2026-10-24'
        self.validation.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=self.validation)
        self.root = Path(self.temporary.name).resolve()
        assert self.root.is_relative_to(self.validation.resolve())
        self.home = self.root / 'home'
        self.home.mkdir()
        (self.home / 'config.toml').write_text('sandbox_mode="danger-full-access"', encoding='utf-8')
        self.settings = self.root / 'settings.json'
        self.settings.write_text(json.dumps({'codexHome': str(self.home)}), encoding='utf-8')
        self.probe = checks.Checks(self.settings, {'executable': str(self.root / 'ChatGPT.exe'), 'sha256': 'fixture'})
        self.probe.package_ready.set()
        self.service = patch.object(checks.psutil, 'win_service_get', side_effect=checks.psutil.NoSuchProcess(0))
        self.service.start()

    def tearDown(self):
        self.service.stop()
        self.temporary.cleanup()

    def test_core_failure_overrides_unknown(self):
        rows = [checks.row('app', 'fail'), checks.row('sandbox', 'unknown')]
        self.assertEqual(checks.summarize(rows), 'failed')

    def test_enhancement_failure_does_not_claim_codex_unusable(self):
        self.assertEqual(checks.summarize([checks.row('app', 'pass'), checks.row('enhancements', 'fail')]), 'partial')

    def test_unknown_and_disabled_are_not_fake_passes(self):
        self.assertEqual(checks.summarize([checks.row('sandbox', 'unknown')]), 'unknown')
        self.assertEqual(checks.summarize([checks.row('sandbox', 'notApplicable')]), 'healthy')
        self.assertEqual(checks.row('sandbox', 'unknown')['status'], checks.t('unknownStatus'))

    def test_sampled_sessions_do_not_export_content_or_identifiers(self):
        (self.home / 'sessions').mkdir()
        record = self.home / 'sessions/private-thread.jsonl'
        record.write_text('{"type":"session_meta","payload":{"id":"private-id","title":"private-title"}}\n', encoding='utf-8')
        (self.home / 'session_index.jsonl').write_text('{"id":"private-id","thread_name":"private-title"}\n')
        with closing(sqlite3.connect(self.home / 'state_5.sqlite')) as db:
            db.execute('create table threads(rollout_path text, updated_at integer)')
            db.execute('insert into threads values(?,1)', (str(record),))
            db.commit()
        result = self.probe.sessions()
        self.assertEqual(result['state'], 'pass')
        exported = json.dumps(result)
        for secret in ('private-id', 'private-title', 'private-thread', str(self.home)):
            self.assertNotIn(secret, exported)

    def test_busy_database_is_unconfirmed(self):
        (self.home / 'state_5.sqlite').touch()
        with patch.object(checks.sqlite3, 'connect', side_effect=sqlite3.OperationalError('private path')):
            self.assertEqual(self.probe.sessions()['state'], 'unknown')

    def test_windows_extended_rollout_path_is_supported(self):
        (self.home / 'sessions').mkdir()
        record = self.home / 'sessions/record.jsonl'
        record.write_text('{"type":"session_meta"}\n', encoding='utf-8')
        with closing(sqlite3.connect(self.home / 'state_5.sqlite')) as db:
            db.execute('create table threads(rollout_path text, updated_at integer)')
            db.execute('insert into threads values(?,1)', ('\\\\?\\' + str(record),))
            db.commit()
        self.assertEqual(self.probe.sessions()['state'], 'pass')

    def test_bad_record_is_explicit_failure(self):
        (self.home / 'session_index.jsonl').write_text('{invalid}\n')
        self.assertEqual(self.probe.sessions()['state'], 'fail')

    def test_full_access_runs_only_basic_host_command(self):
        with patch.object(checks.subprocess, 'run', return_value=types.SimpleNamespace(returncode=0, stdout=b'BETTER_CODEX_BASIC_OK')) as run:
            result = self.probe.sandbox()
        self.assertEqual(result['state'], 'notApplicable')
        self.assertTrue(run.call_args.args[0][0].lower().endswith('cmd.exe'))
        self.assertNotIn('codex.exe', ' '.join(run.call_args.args[0]).lower())

    def test_legacy_sandbox_never_runs_implicit_setup(self):
        self.probe.config = {'sandbox_mode': 'workspace-write', 'windows': {'sandbox': 'elevated'}}
        resources = self.root / 'resources'
        resources.mkdir()
        for name in ('codex.exe', 'codex-command-runner.exe'):
            (resources / name).touch()
        with patch.object(checks.subprocess, 'run', side_effect=AssertionError('must not launch setup')):
            self.assertEqual(self.probe.sandbox()['state'], 'unknown')

    def test_missing_sandbox_helper_is_failure(self):
        self.probe.config = {'sandbox_mode': 'workspace-write'}
        self.assertEqual(self.probe.sandbox()['state'], 'fail')

    def test_http_403_is_transport_reachable_not_model_verified(self):
        opener = Mock()
        opener.open.side_effect = urllib.error.HTTPError('https://example.invalid', 403, '', {}, None)
        with patch.object(self.probe, 'proxy', return_value=None), patch.object(checks.psutil, 'process_iter', return_value=[]), \
                patch.object(checks.urllib.request, 'build_opener', return_value=opener):
            result = self.probe.network()
        self.assertEqual(result['state'], 'pass')
        request = opener.open.call_args.args[0]
        self.assertEqual(request.get_method(), 'HEAD')
        self.assertNotIn('Authorization', request.headers)
        self.assertFalse(checks.report([result])['modelMessageSent'])

    def test_tls_failure_is_not_bypassed(self):
        opener = Mock()
        opener.open.side_effect = urllib.error.URLError(ssl.SSLCertVerificationError('private diagnostic'))
        with patch.object(self.probe, 'proxy', return_value=None), patch.object(checks.psutil, 'process_iter', return_value=[]), \
                patch.object(checks.urllib.request, 'build_opener', return_value=opener):
            result = self.probe.network()
        self.assertEqual(result['state'], 'fail')
        self.assertEqual(result['detail'], checks.t('tlsFailed'))
        self.assertNotIn('private diagnostic', json.dumps(result))

    def test_proxy_failure_does_not_fall_back_to_direct_connection(self):
        with patch.object(self.probe, 'proxy', return_value='http://user:secret@127.0.0.1:7892'), \
                patch.object(checks.psutil, 'process_iter', return_value=[]), \
                patch.object(checks.socket, 'create_connection', side_effect=OSError('private address')), \
                patch.object(checks.urllib.request, 'build_opener') as opener:
            result = self.probe.network()
        self.assertEqual(result['state'], 'fail')
        opener.assert_not_called()
        self.assertNotIn('secret', json.dumps(result))

    def test_unknown_proxy_type_is_unconfirmed(self):
        with patch.object(self.probe, 'proxy', return_value='socks5://127.0.0.1:7892'), \
                patch.object(checks.psutil, 'process_iter', return_value=[]):
            self.assertEqual(self.probe.network()['state'], 'unknown')

    def test_unreadable_permissions_are_not_assumed_admin(self):
        self.probe.app_ready.set()
        self.probe.desktop = {'pid': 1, 'create_time': 1}
        with patch.object(checks, 'process_matches', return_value=True), patch.object(checks, 'process_elevated', return_value=None):
            self.assertEqual(self.probe.permissions()['state'], 'unknown')

    def test_standard_user_is_allowed_without_admin_preference(self):
        self.probe.app_ready.set()
        self.probe.desktop = {'pid': 1, 'create_time': 1}
        with patch.object(checks, 'process_matches', return_value=True), patch.object(checks, 'process_elevated', return_value=False):
            self.assertEqual(self.probe.permissions()['state'], 'pass')
            self.probe.settings['runAsAdministrator'] = True
            self.assertEqual(self.probe.permissions()['state'], 'warning')


if __name__ == '__main__':
    unittest.main()
