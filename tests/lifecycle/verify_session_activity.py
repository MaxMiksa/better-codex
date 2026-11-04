"""Session activity from synthetic metadata only; no live app operations."""
import datetime
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import patch

from src.lifecycle.recovery import session_activity as activity


class ActivityChecks(unittest.TestCase):
    def setUp(self):
        output = Path(sys.argv[1]).resolve()
        output.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=output)
        self.home = Path(self.temporary.name)
        self.settings = {'codexHome': str(self.home)}
        self.started = time.time() - 10
        self.target = {'pid': 123, 'started': self.started}
        self.database = self.home / 'state_5.sqlite'
        with closing(sqlite3.connect(self.database)) as db, db:
            db.execute('create table threads(rollout_path text, updated_at integer)')
        self.process = patch.object(activity.psutil, 'Process', return_value=types.SimpleNamespace(create_time=lambda: self.started))
        self.process.start()

    def tearDown(self):
        self.process.stop()
        self.temporary.cleanup()

    def event(self, kind, at=None):
        at = self.started + 1 if at is None else at
        return {'timestamp': datetime.datetime.fromtimestamp(at, datetime.timezone.utc).isoformat(),
                'type': 'event_msg', 'payload': {'type': kind}}

    def log(self, events, name='session.jsonl'):
        path = self.home / name
        path.write_text(''.join(json.dumps(event) + '\n' for event in events), encoding='utf-8')
        with closing(sqlite3.connect(self.database)) as db, db:
            db.execute('insert into threads values(?,?)', (str(path), int(time.time())))
        return path

    def test_no_desktop_needs_no_session_database(self):
        self.database.unlink()
        self.assertEqual(activity.assess(self.settings, None)['state'], 'idle')

    def test_unfinished_task_is_busy(self):
        self.log([self.event('task_started')])
        self.assertEqual(activity.assess(self.settings, self.target)['state'], 'busy')

    def test_completed_task_is_idle(self):
        self.log([self.event('task_started'), self.event('task_complete', time.time()-1)])
        self.assertEqual(activity.assess(self.settings, self.target)['state'], 'idle')

    def test_abort_closes_a_turn(self):
        self.log([self.event('turn_started'), self.event('turn_aborted', time.time()-1)])
        self.assertEqual(activity.assess(self.settings, self.target)['state'], 'idle')

    def test_background_task_blocks_even_when_another_chat_is_idle(self):
        self.log([self.event('task_complete')], 'idle.jsonl')
        self.log([self.event('task_started')], 'background.jsonl')
        self.assertEqual(activity.assess(self.settings, self.target)['activeCount'], 1)

    def test_transcript_text_cannot_fake_a_completed_task(self):
        self.log([self.event('task_started'), {'type':'response_item','payload':{'text':'task_complete'}}])
        self.assertEqual(activity.assess(self.settings, self.target)['state'], 'busy')

    def test_incomplete_jsonl_tail_is_unknown(self):
        path = self.log([self.event('task_complete')])
        with path.open('ab') as stream:
            stream.write(b'{"type":')
        self.assertEqual(activity.assess(self.settings, self.target)['state'], 'unknown')

    def test_no_known_boundary_is_unknown(self):
        self.log([{'type':'response_item','payload':{}}])
        self.assertEqual(activity.assess(self.settings, self.target)['state'], 'unknown')

    def test_bounded_tail_does_not_invent_idle(self):
        self.log([self.event('task_started'), {'type':'response_item','payload':{'text':'x'*1000}}])
        with patch.object(activity, 'TAIL_LIMIT', 128):
            self.assertEqual(activity.assess(self.settings, self.target)['state'], 'unknown')

    def test_old_unfinished_file_does_not_claim_a_current_task(self):
        path = self.log([self.event('task_started', self.started - 20)])
        os.utime(path, (self.started - 15, self.started - 15))
        self.assertEqual(activity.assess(self.settings, self.target)['state'], 'idle')

    def test_resumed_old_boundary_cannot_prove_idle(self):
        self.log([self.event('task_started', self.started - 20)])
        self.assertEqual(activity.assess(self.settings, self.target)['state'], 'unknown')

    def test_missing_database_is_unknown(self):
        self.database.unlink()
        self.assertEqual(activity.assess(self.settings, self.target)['state'], 'unknown')

    def test_replaced_process_is_unknown(self):
        self.target['started'] -= 1
        self.assertEqual(activity.assess(self.settings, self.target)['state'], 'unknown')

    def test_database_change_during_read_cannot_prove_idle(self):
        self.log([self.event('task_complete')])
        def changed(*_):
            with closing(sqlite3.connect(self.database)) as db, db:
                db.execute('insert into threads values(?,?)', ('new-session', int(time.time())))
            return 'idle'
        with patch.object(activity, 'latest_boundary', side_effect=changed):
            self.assertEqual(activity.assess(self.settings, self.target)['state'], 'unknown')

    def test_report_contains_no_session_identifiers_or_content(self):
        self.log([self.event('task_started')], 'private-session-id.jsonl')
        data = activity.assess(self.settings, self.target)
        self.assertEqual(set(data), {'state','activeCount','checkedAt'})
        self.assertNotIn('private-session-id', json.dumps(data))


if __name__ == '__main__':
    result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(ActivityChecks))
    (Path(sys.argv[1])/'results.json').write_text(json.dumps({'passed':result.testsRun if result.wasSuccessful() else 0,
        'successful':result.wasSuccessful(),'scope':'synthetic session boundaries only'}), encoding='utf-8')
    sys.exit(0 if result.wasSuccessful() else 1)
