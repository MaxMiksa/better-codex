"""Assemble startup checks and the optional, local-only prompt diagnostics."""
import argparse
import datetime
import importlib
import json
import os
from pathlib import Path
import time
import traceback

from src.lifecycle.diagnostics.checks import run
from src.lifecycle.diagnostics.results import parts_row
from src.lifecycle import runtime_events


def prompt_probe(checks):
    try:
        adapter = importlib.import_module('src.prompts.diagnostics')
    except ModuleNotFoundError as error:
        if error.name not in ('src.prompts', 'src.prompts.diagnostics'):
            raise
        return parts_row('prompts', [{'code': 'promptUnavailable', 'state': 'notApplicable'}])
    parts = adapter.inspect(checks.home, checks.settings, checks.runtime)
    if any(part['code'] == 'promptWatchUnknown' for part in parts):
        # The window opens before activation starts the optional watcher.
        # Leave startup time, then re-read evidence without starting a monitor.
        checks.app_ready.wait(32)
        deadline = time.monotonic() + 10
        while True:
            parts = adapter.inspect(checks.home, checks.settings, checks.runtime)
            if not any(part['code'] == 'promptWatchUnknown' for part in parts) or time.monotonic() >= deadline:
                break
            time.sleep(.5)
    return parts_row('prompts', parts)


def save_failure(output, error):
    # Keep only structural facts; exception messages and arguments can contain secrets.
    failure = {'checkedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'workerPid': os.getpid(), 'errorType': type(error).__name__,
               'errno': getattr(error, 'errno', None), 'winerror': getattr(error, 'winerror', None),
               'frames': [{'file': Path(frame.filename).name, 'line': frame.lineno,
                           'function': frame.name} for frame in traceback.extract_tb(error.__traceback__)]}
    try:
        Path(output).with_name('failure.json').write_text(json.dumps(failure), encoding='utf-8')
    except OSError:
        pass  # Preserve the original failure even when its directory is unwritable.


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--settings', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--after-update', action='store_true')
    parser.add_argument('--finish', choices=('workerTimeout', 'workerStopped', 'cancelled'))
    parser.add_argument('--correlation-id')
    parser.add_argument('--instance')
    options = parser.parse_args()
    instance = options.instance or runtime_events.identity()
    correlation_id = options.correlation_id or runtime_events.update_correlation(options.settings.parent / 'runtime', options.after_update)
    rec = runtime_events.recorder(options.settings, 'diagnostics', correlation_id)
    if options.finish:
        import sys
        try:
            data = json.loads(sys.stdin.read(65536))
            runtime_events.diagnostic(rec, data, instance, options.finish)
        except Exception:
            pass
        return
    def observe(data):
        data['correlation_id'] = rec.correlation_id
        if data.get('relaunch') is not None:
            data['relaunch']['correlation_id'] = rec.correlation_id
        runtime_events.diagnostic(rec, data, instance)
    try:
        run(options.settings, options.output, options.after_update, {'prompts': prompt_probe}, observer=observe)
    except Exception as error:
        save_failure(options.output, error)
        try:
            data = json.loads(options.output.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            data = {}
        try:
            runtime_events.diagnostic(rec, data, instance, 'workerStopped')
        except Exception:
            pass
        raise


if __name__ == '__main__':
    main()
