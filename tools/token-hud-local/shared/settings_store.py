"""Serialize settings patches with a Windows lock released on process exit."""
import argparse
import base64
import json
import msvcrt
import os
from pathlib import Path
import tempfile
import time


def update_settings(path: Path, patch: dict, allow_create: bool = False) -> None:
    if not isinstance(patch, dict):
        raise ValueError('invalid-settings-patch')
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(str(path) + '.lock', 'a+b') as lock:
        if os.fstat(lock.fileno()).st_size == 0:
            lock.write(b'\0')
            lock.flush()
        deadline = time.monotonic() + 3
        while True:
            lock.seek(0)
            try:
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise TimeoutError('settings-lock-timeout') from None
                time.sleep(.025)
        temporary = None
        try:
            try:
                current = json.loads(path.read_text(encoding='utf-8-sig'))
            except FileNotFoundError:
                if not allow_create:
                    raise
                current = {}
            if not isinstance(current, dict):
                raise ValueError('invalid-settings-object')
            current.update(patch)
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                             prefix=path.name + '.', suffix='.next', delete=False) as output:
                temporary = Path(output.name)
                json.dump(current, output, ensure_ascii=False, allow_nan=False, indent=2)
            for attempt in range(4):
                try:
                    temporary.replace(path)
                    break
                except PermissionError:
                    if attempt == 3:
                        raise
                    time.sleep(.025 * (attempt + 1))
        finally:
            try:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
            finally:
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--file', type=Path, required=True)
    parser.add_argument('--patch-base64', required=True)
    parser.add_argument('--create', action='store_true')
    args = parser.parse_args()
    try:
        update_settings(args.file, json.loads(base64.b64decode(args.patch_base64, validate=True)), args.create)
    except (OSError, ValueError) as error:
        print(json.dumps({'saved': False, 'errorType': type(error).__name__}))
        raise SystemExit(1)
