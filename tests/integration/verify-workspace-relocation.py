"""Exercise real Windows links in isolated source copies; never launch Codex."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import win32com.client
from win32com.propsys import propsys, pscon
from win32com.shell import shellcon

from src.platform.paths import ROOT
HERE = ROOT / 'tools/token-hud-local'

WORK = Path(sys.argv[1]).resolve()
if not WORK.is_relative_to(ROOT / '.validation-runtime') or WORK.exists():
    raise ValueError('Use a new task directory inside .validation-runtime')
WORK.mkdir(parents=True)
POWERSHELL = Path(os.environ['WINDIR']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
shell = win32com.client.Dispatch('WScript.Shell')
checks = []


def check(name, condition):
    if not condition:
        raise AssertionError(name)
    checks.append(name)


def fixture(name, startup=True):
    base = WORK / name
    old = base / '旧 名称'
    new = base / 'Better-Codex'
    shutil.copytree(HERE, old / 'tools/token-hud-local', ignore=shutil.ignore_patterns('__pycache__'))
    shutil.copytree(ROOT / 'src', old / 'src', ignore=shutil.ignore_patterns('__pycache__'))
    shutil.copy2(ROOT / 'VERSION', old / 'VERSION')
    runtime = old / '.runtime/token-hud/embedded'
    runtime.mkdir(parents=True)
    shutil.copy2(ROOT / '.runtime/token-hud/embedded/codex.ico', runtime / 'codex.ico')
    playwright = old / 'private modules/playwright'
    playwright.mkdir(parents=True)
    (playwright / 'package.json').write_text('{}')
    settings = {'python': sys.executable, 'node': sys.executable, 'playwright': str(playwright),
                'collectorDir': str(old / 'tools/token-hud-local/collector'),
                'codexHome': str(base / 'untouched-codex-home'), 'port': 19163,
                'readingWidth': 1024, 'customAccent': False, 'otherPreference': {'preserve': True}}
    (runtime / 'settings.json').write_text(json.dumps(settings), encoding='utf-8')
    env = dict(os.environ, APPDATA=str(base / 'appdata'), PYTHONDONTWRITEBYTECODE='1', BETTER_CODEX_LANGUAGE='en')
    subprocess.run([sys.executable, '-B', str(old / 'tools/token-hud-local/install_taskbar_entry.py')],
                   env=env, capture_output=True, check=True)
    project = old / 'launchers/Codex.lnk'
    external = [Path(env['APPDATA']) / 'Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar/Codex.lnk']
    if startup:
        external.append(Path(env['APPDATA']) / 'Microsoft/Windows/Start Menu/Programs/Startup/Codex with HUD.lnk')
    for path in external:
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(project, path)
    subprocess.run([sys.executable, '-B', str(old / 'tools/token-hud-local/install_taskbar_entry.py')],
                   env=env, capture_output=True, check=True)
    return old, new, env, external


def invoke(root, env, mode, success=True):
    result = subprocess.run([sys.executable, '-B', '-X', 'utf8', str(root / 'tools/token-hud-local/workspace_relocation.py'),
                             '--mode', mode], env=env, capture_output=True, encoding='utf-8')
    if bool(result.returncode == 0) != success:
        raise AssertionError(result.stdout + result.stderr)
    return json.loads(result.stdout)


def snapshot(root, external):
    paths = [root / 'launchers/Codex.lnk', root / '.runtime/token-hud/embedded/settings.json',
             root / '.runtime/token-hud/embedded/start-composer.vbs',
             root / '.runtime/hud/service/start-embedded.vbs', *external]
    return [hashlib.sha256(p.read_bytes()).hexdigest() for p in paths]


def rename_fixture(old, new):
    # These are the only directory moves in the test; production is never moved.
    if not old.resolve().is_relative_to(WORK) or not new.absolute().is_relative_to(WORK):
        raise ValueError('Fixture rename outside task directory')
    old.rename(new)


old, new, env, external = fixture('happy')
before = snapshot(old, external)
check('prepare', invoke(old, env, 'prepare')['status'] == 'prepared')
check('prepare-preserves-live-entry-files', before == snapshot(old, external))
check('apply-before-user-rename-does-nothing', invoke(old, env, 'apply')['status'] == 'prepared' and before == snapshot(old, external))
settings_path = old / '.runtime/token-hud/embedded/settings.json'
settings = json.loads(settings_path.read_text())
settings['readingWidth'] = 1280
settings_path.write_text(json.dumps(settings), encoding='utf-8')
rename_fixture(old, new)
before = snapshot(new, external)
check('renamed-check-is-read-only', invoke(new, env, 'check')['status'] == 'ready' and before == snapshot(new, external) and not old.exists())
check('apply', invoke(new, env, 'apply')['status'] == 'applied')
check('real-old-path-junction', old.is_dir() and os.path.samefile(old, new))
settings = json.loads((new / '.runtime/token-hud/embedded/settings.json').read_text())
check('paths-rebased-and-preferences-preserved', settings['collectorDir'] == str(new / 'tools/token-hud-local/collector') and
      settings['playwright'] == str(new / 'private modules/playwright') and settings['readingWidth'] == 1280 and
      settings['customAccent'] is False and settings['otherPreference'] == {'preserve': True})
for path in [new / 'launchers/Codex.lnk', *external]:
    link = shell.CreateShortcut(str(path))
    store = propsys.SHGetPropertyStoreFromParsingName(str(path), None, shellcon.GPS_DEFAULT)
    check('real-shortcut-' + str(path.relative_to(WORK)),
          str(new) in link.Arguments and Path(link.WorkingDirectory) == new and
          link.IconLocation == str(new / '.runtime/token-hud/embedded/codex.ico') + ',0' and
          store.GetValue(pscon.PKEY_AppUserModel_ID).GetValue() == 'OpenAI.Codex_2p2nqsd0c76g0!App')
    del store
check('old-cached-wrapper-reachable', str(new) in (old / '.runtime/hud/service/start-embedded.vbs').read_text(encoding='utf-16'))
before = snapshot(new, external)
check('repeat-apply-is-idempotent', invoke(new, env, 'apply')['status'] == 'applied' and before == snapshot(new, external))
result = subprocess.run([str(POWERSHELL), '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                         str(new / 'tools/token-hud-local/Repair-WorkspacePaths.ps1'), '-Mode', 'Check'],
                        env=env, capture_output=True, encoding='utf-8-sig')
check('powershell-entry-after-rename', result.returncode == 0 and 'updated' in result.stdout)
check('recovery-files-created', (new / '.runtime/token-hud/embedded/workspace-rename/before-apply/manifest.json').is_file())

holder = subprocess.Popen([sys.executable, '-c', 'import sys; sys.stdin.read(1)', str(old)],
                          stdin=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW)
try:
    before = snapshot(new, external)
    check('finalize-refuses-process-using-old-path', invoke(new, env, 'finalize', False)['reason'] == 'old-path-still-in-use' and
          old.exists() and before == snapshot(new, external))
finally:
    holder.stdin.close()
    holder.wait(timeout=5)
check('finalize-removes-only-real-junction', invoke(new, env, 'finalize')['status'] == 'finalized' and
      not os.path.lexists(old) and (new / 'tools/token-hud-local/workspace_relocation.py').is_file() and
      before == snapshot(new, external))
check('finalized-check-passes-without-old-path', invoke(new, env, 'check')['status'] == 'finalized')
check('repeat-apply-never-recreates-alias', invoke(new, env, 'apply')['status'] == 'finalized' and not os.path.lexists(old))
check('repeat-finalize-is-idempotent', invoke(new, env, 'finalize')['status'] == 'finalized' and not os.path.lexists(old))
old.mkdir()
(old / 'keep.txt').write_text('user-owned')
check('finalized-state-preserves-foreign-old-directory', invoke(new, env, 'finalize', False)['reason'] == 'previous-path-occupied' and
      (old / 'keep.txt').read_text() == 'user-owned')

old, new, env, external = fixture('startup-disabled', startup=False)
invoke(old, env, 'prepare')
rename_fixture(old, new)
invoke(new, env, 'apply')
check('absent-startup-not-enabled', not (Path(env['APPDATA']) / 'Microsoft/Windows/Start Menu/Programs/Startup/Codex with HUD.lnk').exists())

old, new, env, external = fixture('administrator-identity')
numbered_pin = external[0].with_name('Codex (2).lnk')
external[0].rename(numbered_pin)
external[0] = numbered_pin
settings_path = old / '.runtime/token-hud/embedded/settings.json'
settings = json.loads(settings_path.read_text())
entry_paths = [old / 'launchers/Codex.lnk', *external]
entry_targets = [shell.CreateShortcut(str(path)).Arguments for path in entry_paths]
for enabled, identity in [(True, 'com.openai.codex'), (False, 'OpenAI.Codex_2p2nqsd0c76g0!App'),
                          (True, 'com.openai.codex')]:
    settings['runAsAdministrator'] = enabled
    settings_path.write_text(json.dumps(settings), encoding='utf-8')
    result = subprocess.run([sys.executable, '-B', '-X', 'utf8', str(old / 'tools/token-hud-local/install_taskbar_entry.py')],
                            env=env, capture_output=True, check=True, encoding='utf-8')
    identities = []
    for path in entry_paths:
        store = propsys.SHGetPropertyStoreFromParsingName(str(path), None, shellcon.GPS_DEFAULT)
        identities.append(store.GetValue(pscon.PKEY_AppUserModel_ID).GetValue())
        del store
    check('mode-switch-matches-all-shortcuts-' + str(enabled), identities == [identity] * len(entry_paths) and
          [shell.CreateShortcut(str(path)).Arguments for path in entry_paths] == entry_targets and
          json.loads(result.stdout)['appId'] == identity and json.loads(settings_path.read_text()) == settings)
invoke(old, env, 'prepare')
rename_fixture(old, new)
check('administrator-identity-allows-folder-migration', invoke(new, env, 'apply')['status'] == 'applied')
for path in [new / 'launchers/Codex.lnk', *external]:
    store = propsys.SHGetPropertyStoreFromParsingName(str(path), None, shellcon.GPS_DEFAULT)
    check('administrator-identity-preserved-after-migration-' + path.name,
          store.GetValue(pscon.PKEY_AppUserModel_ID).GetValue() == 'com.openai.codex')
    del store

old, new, env, external = fixture('foreign-shortcut')
invoke(old, env, 'prepare')
link = shell.CreateShortcut(str(external[0]))
link.Arguments = '"C:\\foreign-launcher.vbs"'
link.Save()
rename_fixture(old, new)
before = snapshot(new, external)
check('foreign-shortcut-refused-before-mutation', invoke(new, env, 'apply', False)['reason'] == 'shortcut-ownership-conflict' and
      before == snapshot(new, external) and not old.exists())

old, new, env, external = fixture('occupied-old-path')
invoke(old, env, 'prepare')
rename_fixture(old, new)
old.mkdir()
(old / 'keep.txt').write_text('user-owned')
check('occupied-old-path-preserved', invoke(new, env, 'apply', False)['reason'] == 'previous-path-occupied' and
      (old / 'keep.txt').read_text() == 'user-owned')

old, new, env, external = fixture('rollback')
invoke(old, env, 'prepare')
rename_fixture(old, new)
before = snapshot(new, external)
injection = '''import sys
from pathlib import Path
sys.path.insert(0, str(Path(sys.argv[1]).resolve().parents[1]))
del sys.argv[1]
from src.lifecycle.installation import workspace_relocation as r
def fail(**kwargs):
    r.update_settings(r.RUNTIME / 'settings.json', {'readingWidth': 1408})
    r.links()[0].write_bytes(b'synthetic partial write')
    raise OSError('synthetic installer failure')
r.entries.install = fail
sys.exit(r.main())
'''
result = subprocess.run([sys.executable, '-B', '-X', 'utf8', '-c', injection, str(new / 'tools/token-hud-local'),
                         '--mode', 'apply'], env=env, capture_output=True, encoding='utf-8')
settings = json.loads((new / '.runtime/token-hud/embedded/settings.json').read_text())
check('rollback-restores-links-and-dependencies-keeps-new-preferences', result.returncode != 0 and
      before[0] == snapshot(new, external)[0] and before[2:] == snapshot(new, external)[2:] and
      settings['collectorDir'] == str(old / 'tools/token-hud-local/collector') and settings['readingWidth'] == 1408 and
      os.path.samefile(old, new))

(WORK / 'verification.json').write_text(json.dumps({'scope': 'isolated real Windows shortcuts and junctions; no app activation',
                                                  'passed': len(checks), 'checks': checks}, indent=2), encoding='utf-8')
print(json.dumps({'passed': len(checks), 'processesStarted': 'test interpreters only', 'codexActivated': False}))
