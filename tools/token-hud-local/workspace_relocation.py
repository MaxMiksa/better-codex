"""Finish a prepared source-folder rename without touching running processes."""
import argparse
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

import psutil
import win32com.client
from win32com.propsys import propsys, pscon
from win32com.shell import shellcon

import install_taskbar_entry as entries

sys.path.insert(0, str(Path(__file__).resolve().parent / 'shared'))
from localization import language, text
from settings_store import update_settings

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / '.runtime/token-hud/embedded'
PLAN = RUNTIME / 'workspace-rename/plan.json'
DEPENDENCIES = ('python', 'node', 'playwright', 'collectorDir')
POWERSHELL = Path(os.environ['WINDIR']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write_plan(plan):
    PLAN.parent.mkdir(parents=True, exist_ok=True)
    temporary = PLAN.with_suffix('.next')
    temporary.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(PLAN)


def links():
    appdata = Path(os.environ['APPDATA'])
    return [ROOT / 'launchers/Codex.lnk',
            appdata / 'Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar/Codex.lnk',
            appdata / 'Microsoft/Windows/Start Menu/Programs/Startup/Codex with HUD.lnk']


def wrapper_paths(root):
    return [root / '.runtime/token-hud/embedded/start-composer.vbs',
            root / '.runtime/hud/service/start-embedded.vbs']


def preflight(previous):
    """Refuse foreign entries before changing settings, wrappers or shortcuts."""
    allowed = set(wrapper_paths(previous) + wrapper_paths(ROOT))
    shell = win32com.client.Dispatch('WScript.Shell')
    selected = []
    for index, path in enumerate(links()):
        if not path.exists():
            if index == 0:
                raise ValueError('project-shortcut-missing')
            continue
        link = shell.CreateShortcut(str(path))
        store = propsys.SHGetPropertyStoreFromParsingName(str(path), None, shellcon.GPS_DEFAULT)
        identity = store.GetValue(pscon.PKEY_AppUserModel_ID).GetValue()
        del store
        if (Path(link.TargetPath) != Path(os.environ['WINDIR']) / 'System32/wscript.exe' or
                Path(link.Arguments.strip('"')) not in allowed or identity != entries.APP_ID):
            raise ValueError('shortcut-ownership-conflict')
        selected.append(path)
    template = (ROOT / 'tools/token-hud-local/start-composer.vbs').read_text(encoding='utf-8')
    expected = template.replace('@POWERSHELL@', str(POWERSHELL))
    expected = expected.replace('@SCRIPT@', str(ROOT / 'tools/token-hud-local/Start-ComposerHud.ps1'))
    for path in wrapper_paths(ROOT):
        if not path.is_file() or path.read_text(encoding='utf-16') not in (expected, expected.replace(str(ROOT), str(previous))):
            raise ValueError('wrapper-ownership-conflict')
    if not (RUNTIME / 'codex.ico').is_file():
        raise ValueError('icon-missing')
    return selected


def dependency_patch(settings, previous):
    patch = {}
    for key in DEPENDENCIES:
        path = Path(settings[key])
        try:
            path = ROOT / path.relative_to(previous)
        except ValueError:
            pass
        required = path / ('package.json' if key == 'playwright' else 'metrics.py') if key in ('playwright', 'collectorDir') else path
        if not required.is_file():
            raise ValueError('dependency-missing-' + key)
        if path != Path(settings[key]):
            patch[key] = str(path)
    return patch


def prepare():
    destination = ROOT.with_name('Better-Codex')
    if destination == ROOT or os.path.lexists(destination):
        raise ValueError('destination-already-exists')
    if PLAN.exists():
        plan = read(PLAN)
        if plan['previousRoot'] != str(ROOT) or plan['destinationRoot'] != str(destination):
            raise ValueError('different-rename-already-prepared')
        check(plan)
        return 'prepared'
    preflight(ROOT)
    dependency_patch(read(RUNTIME / 'settings.json'), ROOT)
    write_plan({'previousRoot': str(ROOT), 'destinationRoot': str(destination), 'state': 'prepared'})
    return 'prepared'


def check(plan):
    previous, destination = Path(plan['previousRoot']), Path(plan['destinationRoot'])
    if destination != previous.with_name('Better-Codex') or ROOT not in (previous, destination):
        raise ValueError('unexpected-workspace-location')
    if ROOT == previous:
        if os.path.lexists(destination):
            raise ValueError('destination-already-exists')
        preflight(previous)
        dependency_patch(read(RUNTIME / 'settings.json'), previous)
        return 'prepared'
    if os.path.lexists(previous) and not (previous.exists() and os.path.samefile(previous, ROOT)):
        raise ValueError('previous-path-occupied')
    selected = preflight(ROOT if plan['state'] == 'finalized' else previous)
    patch = dependency_patch(read(RUNTIME / 'settings.json'), previous)
    if plan['state'] in ('applied', 'finalized'):
        alias_valid = not os.path.lexists(previous) if plan['state'] == 'finalized' else previous.exists() and os.path.samefile(previous, ROOT)
        if patch or not alias_valid:
            raise ValueError('migration-verification-failed')
        shell = win32com.client.Dispatch('WScript.Shell')
        for path in selected:
            link = shell.CreateShortcut(str(path))
            if (Path(link.Arguments.strip('"')) not in wrapper_paths(ROOT) or
                    Path(link.WorkingDirectory) != ROOT or
                    link.IconLocation != str(RUNTIME / 'codex.ico') + ',0'):
                raise ValueError('shortcut-verification-failed')
        return plan['state']
    return 'ready'


def require_unused_path(previous):
    current_user = psutil.Process().username()
    relevant = {'chatgpt.exe', 'codex.exe', 'node.exe', 'node_repl.exe', 'python.exe',
                'pythonw.exe', 'powershell.exe', 'pwsh.exe', 'cmd.exe', 'wscript.exe'}
    prefix = str(previous).casefold()
    for process in psutil.process_iter(['name', 'username']):
        if process.info['username'] != current_user:
            continue
        try:
            cwd = process.cwd().casefold()
            if cwd == prefix or cwd.startswith(prefix + '\\') or any(prefix in arg.casefold() for arg in process.cmdline()):
                raise ValueError('old-path-still-in-use')
        except (psutil.NoSuchProcess, psutil.ZombieProcess):
            continue
        except psutil.AccessDenied:
            if (process.info['name'] or '').casefold() in relevant:
                raise ValueError('process-path-check-unavailable') from None


def finalize(plan):
    status = check(plan)
    if status == 'finalized':
        return status
    if status != 'applied':
        raise ValueError('migration-not-applied')
    previous = Path(plan['previousRoot'])
    # All entry files must already use the new root, not merely resolve via the alias.
    preflight(ROOT)
    require_unused_path(previous)
    if (getattr(os.lstat(previous), 'st_reparse_tag', None) != stat.IO_REPARSE_TAG_MOUNT_POINT or
            not os.path.samefile(previous, ROOT)):
        raise ValueError('expected-workspace-junction')
    completed = dict(plan, state='finalized')
    # Save completion first; if Windows refuses link removal, restore the prior state.
    write_plan(completed)
    try:
        os.rmdir(previous)  # Non-recursive: remove the junction itself, never its target.
    except OSError:
        write_plan(plan)
        raise
    check(completed)
    return 'finalized'


def apply(plan):
    status = check(plan)
    if status != 'ready':
        return status
    previous = Path(plan['previousRoot'])
    settings_path = RUNTIME / 'settings.json'
    settings = read(settings_path)
    patch = dependency_patch(settings, previous)
    # Preserve the state immediately before applying, including any newer preferences.
    managed = preflight(previous) + wrapper_paths(ROOT) + [settings_path]
    originals = {path: path.read_bytes() for path in managed}
    backup = PLAN.parent / 'before-apply'
    backup.mkdir(exist_ok=True)
    manifest = []
    for index, (path, data) in enumerate(originals.items()):
        saved = backup / (str(index) + '-' + path.name)
        if not saved.exists():
            saved.write_bytes(data)
        manifest.append({'path': str(path), 'backup': saved.name})
    (backup / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    # The alias keeps running HUD paths and Explorer's cached old entry valid.
    # It is retained on failure too; no process or user's directory is deleted.
    if not previous.exists():
        env = dict(os.environ, BETTER_CODEX_OLD_ROOT=str(previous), BETTER_CODEX_NEW_ROOT=str(ROOT))
        subprocess.run([str(POWERSHELL), '-NoProfile', '-NonInteractive', '-Command',
                        "$ErrorActionPreference='Stop'; New-Item -ItemType Junction -Path $env:BETTER_CODEX_OLD_ROOT -Target $env:BETTER_CODEX_NEW_ROOT | Out-Null"],
                       env=env, check=True, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
    if not os.path.samefile(previous, ROOT):
        raise ValueError('compatibility-link-verification-failed')
    try:
        update_settings(settings_path, patch)
        result = entries.install(previous_root=previous, quiet=True)
        if result['skippedUnmanagedShortcuts']:
            raise ValueError('shortcut-changed-during-migration')
        verified = dict(plan, state='applied')
        check(verified)
        write_plan(verified)
    except Exception:
        # Restore dependency fields only; concurrent width/accent changes survive.
        update_settings(settings_path, {key: settings[key] for key in patch})
        for path, data in originals.items():
            if path != settings_path:
                path.write_bytes(data)
        raise
    return 'applied'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=('prepare', 'check', 'apply', 'finalize'), default='apply')
    args = parser.parse_args()
    try:
        if args.mode == 'prepare':
            status = prepare()
        else:
            plan = read(PLAN)
            status = finalize(plan) if args.mode == 'finalize' else check(plan) if args.mode == 'check' else apply(plan)
        print(json.dumps({'status': status, 'locale': language(), 'message': text('rename.' + status),
                          'codexRestarted': False, 'processesStopped': False}, ensure_ascii=False))
        return 0
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print(json.dumps({'status': 'refused', 'locale': language(), 'message': text('rename.failed'),
                          'reason': str(error) if isinstance(error, ValueError) else type(error).__name__}, ensure_ascii=False))
        return 1


if __name__ == '__main__':
    sys.exit(main())
