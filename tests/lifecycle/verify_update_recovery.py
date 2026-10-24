"""Check update delegation with fake packages; never activate or close Codex."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from src.lifecycle.recovery import update_recovery as recovery


class UpdateChecks(unittest.TestCase):
    def setUp(self):
        root = Path(sys.argv[1]).resolve()
        root.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=root)
        self.root = Path(self.temporary.name)
        self.settings = self.root / 'settings.json'
        self.settings.write_text('{"recoverAfterUpdate":true}')
        self.package = {'packageVersion': '26.1.1.0'}
        self.running, self.calls = [], []
        self.clock = 1000
        self.manager = recovery.UpdateRecovery(self.settings, self.root)
        self.patches = [patch.object(recovery, 'discover', side_effect=lambda: dict(self.package)),
                        patch.object(recovery, 'desktops', side_effect=lambda _: self.running),
                        patch.object(recovery, 'powershell', side_effect=self.spawn),
                        patch.object(recovery.time, 'monotonic', side_effect=lambda: self.clock),
                        patch.object(recovery.time, 'time', side_effect=lambda: self.clock)]
        for item in self.patches:
            item.start()
        self.manager.tick()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temporary.cleanup()

    def spawn(self, script, *args):
        assert json.loads(self.manager.path.read_text())['attemptedVersion'] == self.package['packageVersion']
        self.calls.append((script, args))

    def pump(self):
        self.clock += 16
        return self.manager.tick()

    def update(self):
        self.package['packageVersion'] = '26.1.2.0'
        self.running = [{'pid': 123, 'started': 900, 'main': True, 'debuggingRequested': True}]

    def test_current_baseline_does_not_open_window(self):
        self.running = [{'main': True, 'started': 900}]
        self.pump()
        self.assertFalse(self.calls)

    def test_updated_enhanced_instance_still_opens_unified_check(self):
        self.update(); self.pump()
        self.assertEqual(self.calls, [('Show-StartupCheck.ps1', ('-AfterUpdate', '-SettingsPath', str(self.settings)))])

    def test_monitor_restart_does_not_repeat_delegation(self):
        self.update(); self.pump()
        self.manager = recovery.UpdateRecovery(self.settings, self.root)
        self.pump()
        self.assertEqual(len(self.calls), 1)

    def test_waits_for_actual_new_desktop(self):
        self.update(); self.running = []; self.pump()
        self.assertFalse(self.calls)

    def test_startup_grace_period(self):
        self.update(); self.running[0]['started'] = self.clock + 10
        self.pump(); self.assertFalse(self.calls)
        self.pump(); self.assertEqual(len(self.calls), 1)

    def test_multiple_instances_are_not_delegated(self):
        self.update(); self.running.append({**self.running[0], 'pid': 456})
        self.pump(); self.assertFalse(self.calls)

    def test_unknown_process_identity_is_preserved(self):
        self.update()
        with patch.object(recovery, 'desktops', side_effect=ValueError('identity unavailable')):
            self.pump()
        self.assertFalse(self.calls)

    def test_disabled_monitor_does_not_delegate(self):
        self.update(); self.settings.write_text('{"recoverAfterUpdate":false}')
        self.assertEqual(self.pump()['phase'], 'disabled')
        self.assertFalse(self.calls)

    def test_stopped_monitor_does_not_delegate(self):
        self.update(); (self.root / 'stop').touch(); self.pump()
        self.assertFalse(self.calls)

    def test_failed_durable_write_prevents_spawn(self):
        self.update()
        with patch.object(recovery, 'save_state', side_effect=OSError('fixture')):
            self.pump()
        self.assertFalse(self.calls)


if __name__ == '__main__':
    result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(UpdateChecks))
    (Path(sys.argv[1]) / 'results.json').write_text(json.dumps({'passed': result.testsRun if result.wasSuccessful() else 0,
        'successful': result.wasSuccessful(), 'scope': 'fake update packages; no app activation or exit'}), encoding='utf-8')
    sys.exit(0 if result.wasSuccessful() else 1)
