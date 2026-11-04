"""Map the supervisor's existing display receipt and Node status snapshot."""
import json
from pathlib import Path
import time


def observe(rec, receipt, runtime, owner=None):
    phase = receipt.get('phase', 'unknown')
    identity = tuple(owner) if owner else None
    previous = rec.states.get('desktop')
    if previous != identity:
        if previous:
            confirmed = receipt.get('desktopGone') == list(previous)
            rec.emit('desktop-exit-observed' if confirmed else 'desktop-observation-ended',
                     'observed' if confirmed else 'unknown', {'pid': previous[0]})
        if identity:
            rec.emit('desktop-start-observed', 'observed', {'pid': identity[0]}, occurred_at=identity[1])
        rec.states['desktop'] = identity
    rec.change('connection', (phase, receipt.get('controllerPid')), 'connection-state',
        'success' if phase == 'controller-running' else 'waiting', {'phase': phase})
    state, count = 'waiting', 0
    if phase == 'controller-running':
        try:
            snapshot = json.loads((Path(runtime) / 'view-status.json').read_text(encoding='utf-8'))
            # Reject previous controllers' snapshots without reading page/chat data.
            if snapshot.get('controllerPid') != receipt.get('controllerPid') or not -2 <= time.time() - snapshot.get('checkedAt', 0) / 1000 < 8:
                state = 'unavailable'
            else:
                windows = snapshot.get('windows', [])
                count = len(windows)
                fresh = all(-2 <= time.time() - window.get('checkedAt', 0) / 1000 < 8 for window in windows)
                loaded = all(isinstance(window.get('fileChanges', {}).get('cards'), int) and
                    not window.get('readingWidth', {}).get('reason', '').startswith('layout-or-settings') for window in windows)
                applicable = any(window.get('visible') and window.get('readingWidth', {}).get('applied') for window in windows)
                state = 'unavailable' if not fresh or (windows and not loaded) else 'loaded' if applicable else 'waiting'
        except (OSError, ValueError, KeyError, TypeError):
            state = 'unavailable'
    rec.change('enhancement', (identity, state, count), 'enhancement-state', state,
               {'window_count': count, 'loaded': state == 'loaded'})
