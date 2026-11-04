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

from src.lifecycle.diagnostics import checks
from src.lifecycle.startup import model_gateway


class DiagnosticChecks(unittest.TestCase):
    def setUp(self):
        from src.platform.paths import ROOT
        self.workspace = ROOT
        self.validation = Path(os.environ.get('BETTER_CODEX_TEST_WORK') or self.workspace / '.validation-runtime/startup-check-2026-10-24')
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

    def app_snapshot(self, state, roots=1, matches=True):
        processes = [types.SimpleNamespace(info={'pid': 123+i, 'ppid': 0, 'name': 'ChatGPT.exe',
            'exe': self.probe.package['executable'], 'create_time': 100}) for i in range(roots)]
        with patch.object(checks.psutil, 'process_iter', return_value=processes), \
                patch.object(checks, 'window_state', return_value=state), \
                patch.object(checks, 'process_matches', return_value=matches), \
                patch.object(checks.time, 'monotonic', side_effect=[0, 0, 31]), \
                patch.object(checks.time, 'sleep'):
            return self.probe.app()

    def test_hidden_window_keeps_identity_for_permission_and_interface_checks(self):
        result = self.app_snapshot('hidden')
        self.assertEqual(result['state'], 'notApplicable')
        self.assertEqual(result['status'], checks.t('appBackground'))
        self.assertEqual(self.probe.desktop['pid'], 123)
        self.assertTrue(self.probe.app_ready.is_set())
        self.assertNotIn('restartRecommended', result)
        self.probe.settings['runAsAdministrator'] = True
        with patch.object(checks, 'process_matches', return_value=True), patch.object(checks, 'process_elevated', return_value=False):
            self.assertEqual(self.probe.permissions()['status'], checks.t('ordinary'))
        result = self.enhancement_without_live_view([{'pid': 123, 'started': 100, 'main': True, 'debuggingRequested': False}])
        self.assertEqual(result['summary'], checks.t('hudNoInterface'))

    def test_visible_unresponsive_window_keeps_process_identity(self):
        result = self.app_snapshot('unresponsive')
        self.assertEqual(result['detail'], checks.t('appUnresponsive'))
        self.assertEqual(result['state'], 'fail')
        self.assertIsNotNone(self.probe.desktop)

    def test_window_not_created_does_not_claim_process_missing(self):
        result = self.app_snapshot('missing')
        self.assertEqual(result['state'], 'unknown')
        self.assertEqual(result['detail'], checks.t('appWindowUnknown'))
        self.assertIsNotNone(self.probe.desktop)

    def test_visible_ready_window_still_passes(self):
        self.assertEqual(self.app_snapshot('ready')['state'], 'pass')

    def test_absent_process_still_fails(self):
        self.assertEqual(self.app_snapshot('missing', roots=0)['detail'], checks.t('appMissing'))
        self.assertIsNone(self.probe.desktop)

    def test_multiple_roots_do_not_select_one_visible_instance(self):
        self.assertEqual(self.app_snapshot('ready', roots=2)['state'], 'unknown')
        self.assertIsNone(self.probe.desktop)

    def test_reused_or_exited_process_is_not_retained(self):
        self.app_snapshot('hidden', matches=False)
        self.assertIsNone(self.probe.desktop)
        with patch.object(checks, 'process_elevated') as token:
            self.assertEqual(self.probe.permissions()['state'], 'unknown')
            token.assert_not_called()

    def test_window_probe_distinguishes_hidden_hung_and_enumeration_failure(self):
        for visible, response, enumerated, expected in ((False, 1, 1, 'hidden'), (True, 1, 1, 'ready'),
                (True, 0, 1, 'unresponsive'), (False, 1, 0, 'unknown')):
            with self.subTest(expected=expected):
                user = types.SimpleNamespace(IsWindowVisible=Mock(return_value=visible),
                    GetWindowThreadProcessId=Mock(side_effect=lambda hwnd, owner: setattr(owner._obj, 'value', 123)),
                    SendMessageTimeoutW=Mock(return_value=response),
                    EnumWindows=Mock(side_effect=lambda callback, unused: (callback(1, 0), enumerated)[1]))
                with patch.object(checks.ctypes, 'WinDLL', return_value=user):
                    self.assertEqual(checks.window_state(123), expected)
                if not visible:
                    user.SendMessageTimeoutW.assert_not_called()

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

    def test_network_retries_and_records_sanitized_outcomes(self):
        outcomes = [checks.row('network', 'fail', checks.t('proxyFailed')),
                    checks.row('network', 'warning', checks.t('vpnDown')),
                    checks.row('network', 'pass', checks.t('vpnReady'))]
        with patch.object(self.probe, 'network_attempt', side_effect=outcomes) as attempt, \
                patch.object(checks.time, 'sleep') as sleep:
            self.assertEqual(self.probe.network()['state'], 'pass')
        self.assertEqual(attempt.call_count, 3)
        self.assertEqual(sleep.call_count, 2)
        evidence = json.loads((self.probe.runtime / 'last-network-check.json').read_text(encoding='utf-8'))
        self.assertEqual([item['state'] for item in evidence['attempts']], ['fail', 'warning', 'pass'])

    def test_vpn_snapshot_is_taken_after_https_probe(self):
        opener = Mock()
        ready = []
        def connect(*args, **kwargs):
            ready.append(True)
            raise urllib.error.HTTPError('https://example.invalid', 403, '', {}, None)
        def processes(*args):
            self.assertTrue(ready)
            return [types.SimpleNamespace(info={'name': 'luyucloudcore.exe'})]
        opener.open.side_effect = connect
        with patch.object(self.probe, 'proxy', return_value=None), \
                patch.object(checks.psutil, 'win_service_get', return_value=Mock(status=lambda: 'running')), \
                patch.object(checks.psutil, 'process_iter', side_effect=processes), \
                patch.object(checks.urllib.request, 'build_opener', return_value=opener):
            self.assertEqual(self.probe.network()['state'], 'pass')

    def test_network_failure_retries_are_bounded(self):
        with patch.object(self.probe, 'network_attempt', return_value=checks.row('network', 'fail')) as attempt, \
                patch.object(checks.time, 'sleep'):
            self.assertEqual(self.probe.network()['state'], 'fail')
        self.assertEqual(attempt.call_count, 3)

    def gateway_snapshot(self, reachable=True, owner='magpie.exe', catalog=None):
        self.probe.config = {'openai_base_url': 'http://127.0.0.1:3425/backend-api/codex',
                             'model_providers': {'magpie': {'name': 'magpie', 'base_url': 'http://127.0.0.1:3425/v1'}}}
        if catalog:
            self.probe.config['model_catalog_json'] = catalog
        with patch.object(self.probe, 'network_attempt', return_value=checks.row('network', 'pass', checks.t('vpnReady'))), \
                patch.object(self.probe, 'gateway_reachable', return_value=reachable), \
                patch.object(self.probe, 'gateway_owner', return_value=owner):
            return self.probe.network()

    @staticmethod
    def clause(key):
        return checks.t(key).rstrip('.。')

    def test_loopback_gateway_is_reported_inside_the_network_item(self):
        result = self.gateway_snapshot()
        self.assertEqual(result['id'], 'network')
        self.assertEqual(result['state'], 'pass')
        self.assertEqual(result['detail'], self.clause('vpnReady') + '\n' + self.clause('gatewayReady'))
        evidence = json.loads((self.probe.runtime / 'last-network-check.json').read_text(encoding='utf-8'))
        self.assertEqual(evidence['gateway'], 'pass')

    def test_unreachable_gateway_fails_the_network_item_with_a_hint(self):
        result = self.gateway_snapshot(reachable=False)
        self.assertEqual(result['state'], 'fail')
        self.assertEqual(result['detail'].split('\n')[-1], self.clause('gatewayDown'))
        self.assertEqual(result['suggestion'], checks.t('gatewayHint'))

    def test_gateway_port_held_by_another_program_needs_attention(self):
        result = self.gateway_snapshot(owner='python.exe')
        self.assertEqual(result['state'], 'warning')
        self.assertEqual(result['detail'].split('\n')[-1], self.clause('gatewayForeign'))

    def test_missing_magpie_catalog_needs_attention(self):
        result = self.gateway_snapshot(catalog='magpie-desktop-models.json')
        self.assertEqual(result['state'], 'warning')
        self.assertEqual(result['detail'].split('\n')[-1], self.clause('gatewayCatalogMissing'))

    def test_local_provider_without_magpie_keeps_the_plain_network_item(self):
        self.probe.config = {'openai_base_url': 'http://127.0.0.1:1234/v1'}
        with patch.object(self.probe, 'network_attempt', return_value=checks.row('network', 'pass', checks.t('vpnReady'))), \
                patch.object(self.probe, 'gateway_reachable') as reachable:
            result = self.probe.network()
        reachable.assert_not_called()
        self.assertEqual(result['detail'], checks.t('vpnReady'))
        evidence = json.loads((self.probe.runtime / 'last-network-check.json').read_text(encoding='utf-8'))
        self.assertEqual(evidence['gateway'], 'notApplicable')

    def test_remote_model_endpoint_is_never_probed_as_a_local_gateway(self):
        self.probe.config = {'openai_base_url': 'https://chatgpt.com/backend-api/codex',
                             'model_catalog_json': 'magpie-desktop-models.json'}
        self.assertIsNone(self.probe.gateway())

    def test_gateway_uses_selected_provider_instead_of_smallest_port(self):
        self.probe.config = {'model_provider': 'magpie',
            'openai_base_url': 'http://127.0.0.1:1234/v1',
            'chatgpt_base_url': 'http://127.0.0.1:2345/backend-api/codex',
            'model_providers': {'magpie': {'base_url': 'http://127.0.0.1:3425/v1'}}}
        with patch.object(self.probe, 'gateway_reachable', return_value=True) as reachable, \
                patch.object(self.probe, 'gateway_owner', return_value='magpie.exe') as owner:
            self.assertEqual(self.probe.gateway()['state'], 'pass')
        reachable.assert_called_once_with(('127.0.0.1', 3425))
        owner.assert_called_once_with(('127.0.0.1', 3425))

    def test_inactive_magpie_does_not_probe_another_selected_provider(self):
        for url in ('https://example.invalid/v1', 'http://127.0.0.1:1234/v1'):
            config = {'model_provider': 'other', 'openai_base_url': 'http://127.0.0.1:3425/v1',
                'model_catalog_json': 'magpie-desktop-models.json',
                'model_providers': {'magpie': {'base_url': 'http://127.0.0.1:3425/v1'}, 'other': {'base_url': url}}}
            self.assertIsNone(model_gateway.endpoint(config))

    def test_gateway_probes_the_configured_ipv6_address(self):
        self.probe.config = {'model_provider': 'magpie',
            'model_providers': {'magpie': {'base_url': 'http://[::1]:3425/v1'}}}
        with patch.object(model_gateway.socket, 'create_connection') as connect, \
                patch.object(self.probe, 'gateway_owner', return_value='magpie.exe'):
            self.assertEqual(self.probe.gateway()['state'], 'pass')
        connect.assert_called_once_with(('::1', 3425), timeout=.8)

    def test_gateway_owner_matches_the_configured_bind_address(self):
        connections = [types.SimpleNamespace(status=checks.psutil.CONN_LISTEN,
            laddr=types.SimpleNamespace(ip=ip, port=3425), pid=pid)
            for ip, pid in [('127.0.0.2', 1), ('127.0.0.1', 2), ('::1', 3)]]
        with patch.object(checks.psutil, 'net_connections', return_value=connections), \
                patch.object(checks.psutil, 'Process', side_effect=lambda pid: types.SimpleNamespace(name=lambda: 'magpie.exe' if pid == 3 else 'other.exe')):
            self.assertEqual(self.probe.gateway_owner(('::1', 3425)), 'magpie.exe')

    def test_gateway_endpoint_preserves_localhost_and_default_port(self):
        config = {'model_provider': 'magpie', 'model_providers': {'magpie': {'base_url': 'https://localhost/v1'}}}
        self.assertEqual(model_gateway.endpoint(config), ('localhost', 443))
        config['model_providers']['magpie']['base_url'] = 'http://localhost/v1'
        self.assertEqual(model_gateway.endpoint(config), ('localhost', 80))

    def test_cold_launch_without_magpie_does_not_wait_or_connect(self):
        with patch.object(model_gateway, 'reachable') as connect, patch.object(model_gateway.time, 'sleep') as sleep:
            self.assertFalse(model_gateway.wait(self.settings))
        connect.assert_not_called()
        sleep.assert_not_called()

    def test_cold_launch_wait_uses_configured_gateway_and_stops_when_ready(self):
        (self.home / 'config.toml').write_text('model_provider="magpie"\n[model_providers.magpie]\nbase_url="http://[::1]:4567/v1"', encoding='utf-8')
        with patch.object(model_gateway, 'reachable', side_effect=[False, True]) as connect, \
                patch.object(model_gateway.time, 'sleep') as sleep:
            self.assertTrue(model_gateway.wait(self.settings))
        self.assertEqual(connect.call_count, 2)
        self.assertEqual(connect.call_args.args[0], ('::1', 4567))
        sleep.assert_called_once()

    def test_cold_launch_wait_is_bounded_when_gateway_stays_down(self):
        (self.home / 'config.toml').write_text('model_provider="magpie"\n[model_providers.magpie]\nbase_url="http://127.0.0.1:4567/v1"', encoding='utf-8')
        clock = [0.0]
        def sleep(seconds):
            clock[0] += seconds
        with patch.object(model_gateway, 'reachable', return_value=False), \
                patch.object(model_gateway.time, 'monotonic', side_effect=lambda: clock[0]), \
                patch.object(model_gateway.time, 'sleep', side_effect=sleep):
            self.assertFalse(model_gateway.wait(self.settings))
        self.assertEqual(clock[0], 10)

    def test_cold_launch_bad_config_does_not_block_activation(self):
        (self.home / 'config.toml').write_text('invalid = [', encoding='utf-8')
        with patch.object(model_gateway, 'reachable') as connect:
            self.assertFalse(model_gateway.wait(self.settings))
        connect.assert_not_called()

    def test_proxy_failure_does_not_fall_back_to_direct_connection(self):
        with patch.object(self.probe, 'proxy', return_value='http://user:secret@127.0.0.1:7892'), \
                patch.object(checks.psutil, 'process_iter', return_value=[]), \
                patch.object(checks.socket, 'create_connection', side_effect=OSError('private address')), \
                patch.object(checks.time, 'sleep'), \
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

    def enhancement_without_live_view(self, running):
        self.probe.app_ready.set()
        self.probe.desktop = {'pid': 123, 'create_time': 100}
        self.probe.settings['port'] = 19163
        clock = iter([0, 20])
        listener = types.SimpleNamespace(status=checks.psutil.CONN_LISTEN, laddr=types.SimpleNamespace(port=19163))
        with patch.object(checks.time, 'monotonic', side_effect=lambda: next(clock)), \
                patch.object(checks, 'process_matches', return_value=True), \
                patch.object(checks, 'desktops', return_value=running), \
                patch.object(checks.psutil, 'net_connections', return_value=[listener]):
            return self.probe.enhancements()

    def test_stale_identity_cannot_recommend_restart_for_missing_port(self):
        self.probe.app_ready.set()
        self.probe.desktop = {'pid': 123, 'create_time': 100}
        with patch.object(checks, 'process_matches', return_value=False), \
                patch.object(checks.psutil, 'net_connections') as ports:
            result = self.probe.enhancements()
        self.assertEqual(result['state'], 'unknown')
        self.assertNotIn('restartRecommended', result)
        ports.assert_not_called()

    def fake_report_checks(self):
        probe = types.SimpleNamespace(package=None, home=self.home, settings_error=False, config_error=False)
        for key in checks.IDS + checks.MANAGEMENT_IDS:
            setattr(probe, 'runtime_check' if key == 'runtime' else key,
                    lambda key=key: checks.row(key, 'pass'))
        return probe

    def test_report_continues_after_windows_reader_releases_file(self):
        output = self.root / 'result.json'
        replace = Path.replace
        conflicts = []

        def replace_with_reader(path, target):
            if target == output and output.exists() and not conflicts:
                with output.open('rb'):
                    try:
                        replace(path, target)
                    except PermissionError as error:
                        conflicts.append(error.winerror)
                        raise
                self.fail('Expected a Windows reader to block atomic replacement')
            return replace(path, target)

        with patch.object(checks, 'Checks', return_value=self.fake_report_checks()), \
                patch.object(Path, 'replace', replace_with_reader):
            checks.run(self.settings, output)
        self.assertEqual(len(conflicts), 1)
        data = json.loads(output.read_text(encoding='utf-8'))
        self.assertEqual(data['state'], 'healthy')
        self.assertTrue(all(item['state'] == 'pass' for item in data['rows'] + data['managementRows']))

    def test_report_persistent_write_denial_is_bounded_and_not_success(self):
        output = self.root / 'result.json'
        output.write_text('{"state":"checking"}', encoding='utf-8')
        with patch.object(checks, 'Checks', return_value=self.fake_report_checks()), \
                patch.object(Path, 'replace', side_effect=PermissionError('fixture denied')) as replace, \
                patch.object(checks.time, 'sleep') as sleep:
            with self.assertRaises(PermissionError):
                checks.run(self.settings, output)
        self.assertEqual(replace.call_count, 6)
        self.assertEqual(sleep.call_count, 5)
        self.assertEqual(json.loads(output.read_text())['state'], 'checking')

    def test_orphan_listener_does_not_hide_confirmed_missing_interface(self):
        result = self.enhancement_without_live_view([{'pid': 123, 'started': 100, 'main': True, 'debuggingRequested': False}])
        self.assertEqual(result['state'], 'warning')
        self.assertTrue(result['restartRecommended'])
        self.assertEqual(result['summary'], checks.t('hudNoInterface'))

    def test_stale_desktop_identity_does_not_confirm_missing_interface(self):
        result = self.enhancement_without_live_view([{'pid': 123, 'started': 101, 'main': True, 'debuggingRequested': False}])
        self.assertEqual(result['state'], 'unknown')
        self.assertFalse(result['restartRecommended'])

    def test_requested_interface_without_live_proof_stays_unknown(self):
        result = self.enhancement_without_live_view([{'pid': 123, 'started': 100, 'main': True, 'debuggingRequested': True}])
        self.assertEqual(result['state'], 'unknown')

    def test_standard_user_ignores_retired_admin_preference(self):
        self.probe.app_ready.set()
        self.probe.desktop = {'pid': 1, 'create_time': 1}
        with patch.object(checks, 'process_matches', return_value=True), patch.object(checks, 'process_elevated', return_value=False):
            self.assertEqual(self.probe.permissions()['state'], 'pass')
            self.probe.settings['runAsAdministrator'] = True
            self.assertEqual(self.probe.permissions()['state'], 'pass')


if __name__ == '__main__':
    unittest.main()
