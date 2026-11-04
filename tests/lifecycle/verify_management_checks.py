"""Management diagnostics with synthetic receipts; no repairs or live probes."""
import datetime
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import Mock, patch

from src.app import startup_diagnostics
from src.lifecycle.diagnostics import checks, management


class ManagementChecks(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=Path(sys.argv[1]))
        self.root = Path(self.temporary.name)
        self.settings_path = self.root / 'settings.json'
        self.home = self.root / 'home'
        self.home.mkdir()
        (self.home / 'config.toml').write_text('sandbox_mode="danger-full-access"')
        self.settings = {'python': 'fixture-python', 'node': 'fixture-node', 'playwright': 'fixture-playwright',
                         'collectorDir': 'fixture-collector', 'port': 19163, 'codexHome': str(self.home), 'recoverAfterUpdate': True}
        self.settings_path.write_text(json.dumps(self.settings))
        self.runtime = self.root / 'runtime'
        self.runtime.mkdir()
        self.now = time.time()
        self.launcher = {'supervisorPid': 123, 'startedAt': datetime.datetime.fromtimestamp(self.now-30,datetime.timezone.utc).isoformat(), 'stamp': 'current'}
        self.status = {'phase': 'connecting', 'checkedAt': self.now,
                       'updateRecovery': {'phase': 'baseline', 'observedVersion': '26.1.1.0', 'checkedAt': 1}}
        self.save()
        self.process = patch.object(management.psutil, 'Process', return_value=types.SimpleNamespace(
            create_time=lambda:self.now-30, exe=lambda:'fixture-python',
            cmdline=lambda:[str(management.ROOT / 'tools/token-hud-local/embedded/supervisor.py')]))
        self.process.start()

    def save(self):
        (self.runtime / 'launcher.json').write_text(json.dumps(self.launcher))
        (self.runtime / 'supervisor.json').write_text(json.dumps(self.status))

    def tearDown(self):
        self.process.stop()
        self.temporary.cleanup()

    def test_old_baseline_is_healthy_with_fresh_exact_supervisor(self):
        self.assertEqual(management.updates(self.settings,self.runtime)['state'],'pass')

    def test_stale_supervisor_is_unknown(self):
        self.status['checkedAt']-=100;self.save()
        self.assertEqual(management.updates(self.settings,self.runtime)['state'],'unknown')

    def test_launcher_path_dot_segments_are_normalized(self):
        path=management.ROOT/'src/app/../../tools/token-hud-local/embedded/supervisor.py'
        process=types.SimpleNamespace(create_time=lambda:self.now-30,exe=lambda:'fixture-python',cmdline=lambda:[str(path)])
        with patch.object(management.psutil,'Process',return_value=process):
            self.assertEqual(management.updates(self.settings,self.runtime)['state'],'pass')

    def test_reused_supervisor_pid_is_unknown(self):
        self.launcher['startedAt']=datetime.datetime.fromtimestamp(1,datetime.timezone.utc).isoformat();self.save()
        self.assertEqual(management.updates(self.settings,self.runtime)['state'],'unknown')

    def test_monitor_disabled_is_normal_and_does_not_read_receipts(self):
        self.settings['recoverAfterUpdate']=False
        with patch.object(management,'supervisor',side_effect=AssertionError('must not inspect disabled monitor')):
            self.assertEqual(management.updates(self.settings,self.runtime)['state'],'notApplicable')

    def test_cancelled_version_reported_without_monitor_failure(self):
        (self.runtime/'startup-relaunch.json').write_text('{"attempted":["update:26.1.1.0"]}')
        result=management.updates(self.settings,self.runtime)
        self.assertIn(checks.t('updatesHandled'),result['detail'])
        self.assertEqual(result['state'],'pass')

    def test_final_plan_cancellation_overrides_old_summary(self):
        result=management.apply_plan(management.updates(self.settings,self.runtime),{'reason':'updated','cancelledForActivity':True})
        self.assertEqual(result['summary'],checks.t('updatesCancelled'))

    def test_missing_optional_prompt_module_is_not_applicable(self):
        with patch.object(startup_diagnostics.importlib,'import_module',side_effect=ModuleNotFoundError(name='src.prompts')):
            self.assertEqual(startup_diagnostics.prompt_probe(None)['state'],'notApplicable')

    def test_worker_failure_survives_report_cleanup_without_private_exception_text(self):
        output = self.root / 'result.json'
        output.write_text('{"state":"checking"}')
        error = PermissionError(13, 'private-token private-url private-chat')
        with patch.object(sys, 'argv', ['worker', '--settings', str(self.settings_path), '--output', str(output)]), \
                patch.object(startup_diagnostics, 'run', side_effect=error):
            with self.assertRaises(PermissionError):
                startup_diagnostics.main()
        output.unlink()  # The dialog removes its known result files after worker exit.
        retained = (self.root / 'failure.json').read_text()
        failure = json.loads(retained)
        self.assertEqual(failure['errorType'], 'PermissionError')
        self.assertEqual(failure['errno'], 13)
        self.assertEqual(failure['workerPid'], os.getpid())
        self.assertTrue(failure['frames'])
        self.assertNotIn('private-', retained)
        self.assertNotIn(str(self.root), retained)
        self.assertTrue(all(Path(frame['file']).name == frame['file'] for frame in failure['frames']))

    def test_failure_record_write_error_does_not_replace_original_exception(self):
        error = RuntimeError('private-error')
        with patch.object(sys, 'argv', ['worker', '--settings', str(self.settings_path), '--output', str(self.root / 'result.json')]), \
                patch.object(startup_diagnostics, 'run', side_effect=error), \
                patch.object(Path, 'write_text', side_effect=OSError('unwritable')):
            with self.assertRaises(RuntimeError) as caught:
                startup_diagnostics.main()
        self.assertIs(caught.exception, error)

    def test_successful_worker_does_not_create_failure_record(self):
        with patch.object(sys, 'argv', ['worker', '--settings', str(self.settings_path), '--output', str(self.root / 'result.json')]), \
                patch.object(startup_diagnostics, 'run'):
            startup_diagnostics.main()
        self.assertFalse((self.root / 'failure.json').exists())

    def prompt_startup(self, observations):
        self.prompt_clock = 0
        def sleep(seconds):
            self.prompt_clock += seconds
        timing = types.SimpleNamespace(monotonic=lambda:self.prompt_clock, sleep=sleep)
        adapter = types.SimpleNamespace(inspect=Mock(side_effect=observations))
        ready = types.SimpleNamespace(wait=Mock(return_value=True))
        probe = types.SimpleNamespace(home=self.home, settings=self.settings, runtime=self.runtime, app_ready=ready)
        with patch.object(startup_diagnostics.importlib,'import_module',return_value=adapter), \
                patch.object(startup_diagnostics,'time',timing):
            result = startup_diagnostics.prompt_probe(probe)
        return result, adapter.inspect, ready.wait

    def test_prompt_watcher_starting_after_app_is_rechecked(self):
        pending = [{'code':'promptWatchUnknown','state':'unknown'}]
        result, inspect, wait = self.prompt_startup([
            pending, pending, [{'code':'promptWatchReady','state':'pass'}]])
        self.assertEqual(result['state'],'pass')
        wait.assert_called_once_with(32)
        self.assertEqual(inspect.call_count,3)
        self.assertEqual(self.prompt_clock,.5)

    def test_unconfirmed_prompt_watcher_has_bounded_retries(self):
        result, inspect, wait = self.prompt_startup(lambda *_:[{'code':'promptWatchUnknown','state':'unknown'}])
        self.assertEqual(result['state'],'unknown')
        wait.assert_called_once_with(32)
        self.assertEqual(self.prompt_clock,10)
        self.assertGreater(inspect.call_count,1)
        self.assertLessEqual(inspect.call_count,25)

    def test_prompt_notification_only_unknown_is_not_retried(self):
        parts = [{'code':'promptActive','state':'pass'}, {'code':'promptNotificationUnknown','state':'unknown'},
                 {'code':'promptWatchReady','state':'pass'}]
        result, inspect, wait = self.prompt_startup([parts])
        self.assertEqual(result['state'],'unknown')
        inspect.assert_called_once_with(self.home,self.settings,self.runtime)
        wait.assert_not_called()

    def test_prompt_disabled_or_changed_does_not_wait(self):
        for code, state in [('promptWatchDisabled','notApplicable'), ('promptChanged','warning')]:
            with self.subTest(code=code):
                result, inspect, wait = self.prompt_startup([[{'code':code,'state':state}]])
                self.assertEqual(result['state'],state)
                self.assertEqual(inspect.call_count,1)
                wait.assert_not_called()

    def test_corrupt_settings_keep_specific_runtime_diagnosis(self):
        self.settings_path.write_text('{broken')
        probe=checks.Checks(self.settings_path)
        self.assertTrue(probe.settings_error)
        self.assertEqual(probe.runtime_check()['summary'],checks.t('runtimeSettingsInvalid'))

    def test_corrupt_codex_config_is_preserved_as_error(self):
        (self.home/'config.toml').write_text('=broken')
        self.assertTrue(checks.Checks(self.settings_path).config_error)

    def test_missing_dependencies_do_not_claim_full_runtime_health(self):
        probe=checks.Checks(self.settings_path)
        with patch.object(management,'shell_probe',return_value='current'):
            result=management.runtime(probe)
        self.assertEqual(result['state'],'warning')
        self.assertIn(checks.t('runtimeDependenciesMissing'),result['detail'])

    def test_old_source_stamp_is_reported_without_refresh(self):
        probe=checks.Checks(self.settings_path)
        with patch.object(management,'shell_probe',return_value='different'):
            result=management.runtime(probe)
        self.assertIn(checks.t('runtimeOldBackend'),result['detail'])

    def test_entry_disabled_and_other_copy_are_not_repaired(self):
        parts=[management.part('entryLoginDisabled','notApplicable'), management.part('entryPinUnmanaged','notApplicable')]
        with patch.object(management,'shell_probe',return_value=json.dumps(parts)):
            self.assertEqual(management.entries(self.settings_path)['state'],'notApplicable')

    def test_entry_windows_disabled_and_admin_mismatch_need_attention(self):
        parts=[management.part('entryLoginBlocked','warning'), management.part('entryAdminChanged','unknown')]
        with patch.object(management,'shell_probe',return_value=json.dumps(parts)):
            result=management.entries(self.settings_path)
        self.assertEqual(result['state'],'warning')

    def test_diagnostics_do_not_mutate_receipts(self):
        before={p:p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        management.updates(self.settings,self.runtime)
        self.assertEqual(before,{p:p.read_bytes() for p in self.root.rglob('*') if p.is_file()})

    def test_new_management_warnings_do_not_change_recovery_reason(self):
        probe=checks.Checks(self.settings_path,package={'packageVersion':'26.1.1.0'})
        patches=[]
        for key in checks.IDS+checks.MANAGEMENT_IDS:
            value=checks.row(key,'warning' if key in checks.MANAGEMENT_IDS else 'pass')
            patches.append(patch.object(probe,'runtime_check' if key=='runtime' else key,return_value=value))
        for item in patches:item.start()
        try:
            with patch.object(checks,'Checks',return_value=probe),patch.object(checks,'prepare',return_value={'allowed':False,'automatic':False}) as prepare:
                output=self.root/'report.json';checks.run(self.settings_path,output)
            result=json.loads(output.read_text(encoding='utf-8'))
            self.assertEqual(result['state'],'partial')
            self.assertFalse(result['relaunch']['automatic'])
            self.assertEqual(prepare.call_args.args[2]['id'],'enhancements')
            self.assertEqual(prepare.call_args.args[2]['state'],'pass')
            self.assertEqual((len(result['rows']),len(result['managementRows'])),(6,4))
        finally:
            for item in reversed(patches):item.stop()

    def test_plan_cancellation_is_in_final_serialized_update_row(self):
        probe=checks.Checks(self.settings_path,package={'packageVersion':'26.1.1.0'})
        patches=[patch.object(probe,'runtime_check' if key=='runtime' else key,return_value=checks.row(key,'pass')) for key in checks.IDS+checks.MANAGEMENT_IDS]
        for item in patches:item.start()
        try:
            plan={'allowed':False,'automatic':False,'reason':'updated','cancelledForActivity':True}
            with patch.object(checks,'Checks',return_value=probe),patch.object(checks,'prepare',return_value=plan):
                output=self.root/'report.json';checks.run(self.settings_path,output)
            result=json.loads(output.read_text(encoding='utf-8'))
            self.assertEqual(result['managementRows'][1]['summary'],checks.t('updatesCancelled'))
        finally:
            for item in reversed(patches):item.stop()


if __name__ == '__main__':
    root=Path(sys.argv[1]);root.mkdir(parents=True,exist_ok=True)
    result=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(ManagementChecks))
    (root/'results.json').write_text(json.dumps({'passed':result.testsRun if result.wasSuccessful() else 0,'successful':result.wasSuccessful()}))
    sys.exit(0 if result.wasSuccessful() else 1)
