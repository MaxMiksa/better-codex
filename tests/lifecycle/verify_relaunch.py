"""Relaunch policy with fake desktops, packages and launch calls only."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from src.lifecycle.recovery import relaunch


class RelaunchChecks(unittest.TestCase):
    def setUp(self):
        root = Path(sys.argv[1]).resolve()
        root.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=root)
        self.root = Path(self.temporary.name)
        for name in ['python.exe', 'node.exe', 'package.json', 'metrics.py']:
            (self.root / name).touch()
        self.settings_path = self.root / 'settings.json'
        self.settings = {'python': str(self.root / 'python.exe'), 'node': str(self.root / 'node.exe'),
                         'playwright': str(self.root), 'collectorDir': str(self.root), 'runAsAdministrator': False}
        relaunch.save(self.settings_path, self.settings)
        self.package = {'packageVersion': '26.1.1.0', 'sha256': 'fixture', 'executable': 'C:/fixture/ChatGPT.exe'}
        self.running = [{'pid': 123, 'started': 100, 'main': True, 'debuggingRequested': True}]
        self.port, self.clock = 'absent', 1000
        self.calls, self.closed = [], []
        self.close_allowed, self.close_completes, self.reconnects = True, True, True
        self.patches = [patch.object(relaunch, 'discover', side_effect=lambda: dict(self.package)),
                        patch.object(relaunch, 'desktops', side_effect=lambda _: [dict(p) for p in self.running]),
                        patch.object(relaunch, 'port_status', side_effect=lambda *_: self.port),
                        patch.object(relaunch, 'request_close', side_effect=self.close),
                        patch.object(relaunch, 'powershell', side_effect=self.launch),
                        patch.object(relaunch.time, 'monotonic', side_effect=lambda: self.clock),
                        patch.object(relaunch.time, 'sleep', side_effect=lambda seconds: setattr(self, 'clock', self.clock + seconds))]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temporary.cleanup()

    def close(self, pid, started):
        self.closed.append((pid, started))
        if self.close_completes:
            self.running = []
        return self.close_allowed

    def launch(self, script, *args):
        self.calls.append((script, args))
        self.running = [{'pid': 456, 'started': 200, 'main': True, 'debuggingRequested': True}]
        self.port = 'verified' if self.reconnects else 'absent'
        class Child:
            def poll(self):
                return 0
        return Child()

    def plan(self, state='warning', recommended=True, updated=False):
        return relaunch.prepare(self.settings_path, self.package,
                                {'state': state, 'restartRecommended': recommended}, updated)

    def test_first_healthy_check_does_not_restart(self):
        self.assertFalse(self.plan('pass', False)['automatic'])
        self.assertFalse(self.closed or self.calls)

    def test_unknown_or_network_only_does_not_arm(self):
        self.assertFalse(self.plan('unknown', False)['automatic'])

    def test_confirmed_plugin_failure_arms(self):
        self.assertTrue(self.plan()['automatic'])

    def test_updated_healthy_check_also_arms(self):
        plan = self.plan('pass', False, True)
        self.assertTrue(plan['automatic'])
        self.assertEqual(plan['reason'], 'updated')

    def test_version_increase_is_detected_without_update_flag(self):
        self.plan('pass', False)
        self.package['packageVersion'] = '26.1.2.0'
        self.assertEqual(self.plan('pass', False)['reason'], 'updated')

    def test_cancel_is_durable_across_reopen(self):
        plan = self.plan()
        relaunch.cancel(self.settings_path, plan['key'])
        self.assertFalse(self.plan()['automatic'])
        self.assertFalse(self.closed or self.calls)

    def test_cancel_healthy_update_does_not_suppress_first_plugin_fault(self):
        plan = self.plan('pass', False, True)
        relaunch.cancel(self.settings_path, plan['key'])
        self.assertTrue(self.plan()['automatic'])

    def test_cancel_plugin_failure_does_not_cancel_a_separate_update(self):
        relaunch.cancel(self.settings_path, self.plan()['key'])
        self.assertTrue(self.plan('pass', False, True)['automatic'])

    def test_close_during_update_check_remembers_cancel(self):
        relaunch.cancel_check(self.settings_path, after_update=True)
        self.assertFalse(self.plan('pass', False)['automatic'])
        self.assertFalse(self.plan('pass', False, True)['automatic'])
        self.assertTrue(self.plan()['automatic'])

    def test_close_during_ordinary_check_recognizes_new_version(self):
        self.plan('pass', False)
        self.package['packageVersion'] = '26.1.2.0'
        relaunch.cancel_check(self.settings_path, self.package['packageVersion'])
        self.assertFalse(self.plan('pass', False)['automatic'])

    def test_close_current_baseline_check_does_not_invent_cancellation(self):
        self.plan('pass', False)
        relaunch.cancel_check(self.settings_path)
        self.assertTrue(self.plan()['automatic'])

    def test_recheck_can_rearm_before_cancel(self):
        self.assertTrue(self.plan()['automatic'])
        self.assertTrue(self.plan()['automatic'])

    def test_healthy_manual_button_closes_and_uses_full_entry(self):
        plan = self.plan('pass', False)
        self.assertTrue(relaunch.execute(self.settings_path, plan)['success'])
        self.assertEqual(self.closed, [(123, 100)])
        self.assertEqual(self.calls, [('Start-ComposerHud.ps1', ('-StartupCheckStarted',))])

    def test_absent_app_only_launches(self):
        self.running = []
        self.assertTrue(relaunch.execute(self.settings_path, self.plan('unknown', False))['success'])
        self.assertFalse(self.closed)

    def test_close_veto_never_forces_or_launches(self):
        self.close_allowed = self.close_completes = False
        result = relaunch.execute(self.settings_path, self.plan())
        self.assertEqual(result['reason'], 'closeFailed')
        self.assertFalse(self.calls)

    def test_close_timeout_never_launches(self):
        self.close_completes = False
        self.assertEqual(relaunch.execute(self.settings_path, self.plan())['reason'], 'closeFailed')
        self.assertFalse(self.calls)

    def test_reused_pid_is_rejected(self):
        plan = self.plan()
        self.running[0]['started'] += 1
        self.assertEqual(relaunch.execute(self.settings_path, plan)['reason'], 'instanceChanged')
        self.assertFalse(self.closed)

    def test_changed_package_is_rejected(self):
        plan = self.plan()
        self.package['packageVersion'] = '26.1.2.0'
        self.assertEqual(relaunch.execute(self.settings_path, plan)['reason'], 'instanceChanged')
        self.assertFalse(self.closed)

    def test_foreign_listener_disables_action(self):
        self.port = 'unverified'
        self.assertFalse(self.plan()['allowed'])

    def test_multiple_instances_disable_action(self):
        self.running.append({**self.running[0], 'pid': 789})
        self.assertFalse(self.plan()['allowed'])

    def test_missing_dependency_prevents_close(self):
        plan = self.plan()
        (self.root / 'node.exe').unlink()
        with self.assertRaises(ValueError):
            relaunch.execute(self.settings_path, plan)
        self.assertFalse(self.closed)

    def test_failed_recovery_does_not_loop_on_new_pid(self):
        self.reconnects = False
        self.assertFalse(relaunch.execute(self.settings_path, self.plan())['success'])
        self.assertFalse(self.plan()['automatic'])
        self.assertEqual(len(self.calls), 1)

    def test_successful_health_clears_only_plugin_failure_episode(self):
        relaunch.execute(self.settings_path, self.plan())
        self.plan('pass', False)
        self.assertTrue(self.plan()['automatic'])
        self.assertFalse(self.plan('pass', False, True)['automatic'])

    def test_request_nonce_cannot_restart_twice(self):
        plan = self.plan()
        self.assertTrue(relaunch.execute(self.settings_path, plan, 'a' * 32)['success'])
        self.assertIsNone(relaunch.execute(self.settings_path, plan, 'a' * 32))
        self.assertEqual(len(self.closed), 1)

    def test_request_path_cannot_escape_runtime(self):
        relaunch.save(self.root / 'runtime/startup-relaunch-request.json', {'nonce': '../escape', 'createdAt': 0})
        with self.assertRaises(ValueError):
            relaunch.execute_request(self.settings_path)
        self.assertFalse(self.closed)


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(RelaunchChecks)
    result = unittest.TextTestRunner().run(suite)
    output = Path(sys.argv[1]).resolve()
    (output / 'results.json').write_text(json.dumps({'passed': result.testsRun if result.wasSuccessful() else 0,
        'successful': result.wasSuccessful(), 'scope': 'fake desktops and launch calls only'}), encoding='utf-8')
    sys.exit(0 if result.wasSuccessful() else 1)
