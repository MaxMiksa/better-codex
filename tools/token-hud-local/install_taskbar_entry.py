"""Maintain owned current-HUD launchers without editing Explorer's pin database."""
import json
import os
from pathlib import Path
import shutil
import sys
import win32com.client
from win32com.propsys import propsys, pscon
from win32com.shell import shell, shellcon

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / '.runtime/token-hud/embedded'
COMPAT = ROOT / '.runtime/hud/service/start-embedded.vbs'
ICON = RUNTIME / 'codex.ico'
APP_ID = 'OpenAI.Codex_2p2nqsd0c76g0!App'
# Direct elevated EXE launches use Electron's identity rather than the Store identity.
ADMIN_APP_ID = 'com.openai.codex'
MANAGED_APP_IDS = (APP_ID, ADMIN_APP_ID)
sys.path.insert(0, str(Path(__file__).resolve().parent / 'shared'))
from localization import language, text as translate


def pinned_shortcuts():
    directory = Path(os.environ['APPDATA']) / 'Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar'
    # Explorer adds a numeric suffix when an old, unregistered link is still here.
    return [directory / 'Codex.lnk', *sorted(directory.glob('Codex (*).lnk'))]


def install(previous_root=None, quiet=False):
    settings_path = RUNTIME / 'settings.json'
    settings = json.loads(settings_path.read_text(encoding='utf-8-sig')) if settings_path.exists() else {}
    app_id = ADMIN_APP_ID if settings.get('runAsAdministrator') is True else APP_ID
    wrapper = RUNTIME / 'start-composer.vbs'
    recovery = RUNTIME / 'taskbar-recovery'
    project = ROOT / 'launchers/Codex.lnk'
    links = [(0, project), *((1, path) for path in pinned_shortcuts()),
             (2, Path(os.environ['APPDATA']) / 'Microsoft/Windows/Start Menu/Programs/Startup/Codex with HUD.lnk')]
    wscript = Path(os.environ['WINDIR']) / 'System32/wscript.exe'
    shell_object = win32com.client.Dispatch('WScript.Shell')
    previous_root = previous_root or ROOT
    previous_wrapper = previous_root / '.runtime/token-hud/embedded/start-composer.vbs'
    previous_compat = previous_root / '.runtime/hud/service/start-embedded.vbs'
    if not ICON.is_file():
        raise FileNotFoundError(translate('shortcut.iconMissing'))
    if not project.exists():
        project.parent.mkdir(parents=True, exist_ok=True)
        link = shell_object.CreateShortcut(str(project))
        link.TargetPath = str(wscript)
        link.Arguments = '"'+str(wrapper)+'"'
        link.Save()
        store = propsys.SHGetPropertyStoreFromParsingName(str(project), None, shellcon.GPS_READWRITE)
        store.SetValue(pscon.PKEY_AppUserModel_ID, propsys.PROPVARIANTType(app_id))
        store.Commit()
        del store
    selected, skipped = [], []
    identity_changed = False
    for index, path in links:
        if not path.exists():
            continue
        link = shell_object.CreateShortcut(str(path))
        allowed = {COMPAT, wrapper}
        if index == 0 or not previous_root.exists() or previous_root.resolve() == ROOT.resolve():
            allowed.update((previous_wrapper, previous_compat))
        if Path(link.TargetPath) != wscript or Path(link.Arguments.strip('"')) not in allowed:
            if index != 0:
                skipped.append(str(path))
                continue
            raise ValueError(translate('shortcut.changed', path=path))
        store = propsys.SHGetPropertyStoreFromParsingName(str(path), None, shellcon.GPS_DEFAULT)
        identity = store.GetValue(pscon.PKEY_AppUserModel_ID).GetValue()
        if identity not in MANAGED_APP_IDS:
            raise ValueError(translate('shortcut.identity'))
        identity_changed = identity_changed or identity != app_id
        del store
        selected.append((index, path, link))
    if not selected or selected[0][0] != 0:
        raise FileNotFoundError(translate('shortcut.required'))
    template = (ROOT / 'tools/token-hud-local/start-composer.vbs').read_text(encoding='utf-8')
    text = template.replace('@POWERSHELL@', str(Path(os.environ['WINDIR']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'))
    text = text.replace('@SCRIPT@', str(ROOT / 'tools/token-hud-local/Start-ComposerHud.ps1'))
    previous_text = text.replace(str(ROOT), str(previous_root))
    for target in (wrapper, COMPAT):
        if target.exists() and target.read_text(encoding='utf-16') not in (text, previous_text):
            raise ValueError(translate('shortcut.wrapperChanged', path=target))
    recovery.mkdir(parents=True, exist_ok=True)
    for target in (wrapper, COMPAT):
        target.parent.mkdir(parents=True, exist_ok=True)
        temp = target.with_suffix('.next.vbs')
        temp.write_text(text, encoding='utf-16')
        os.replace(temp, target)
    # Explorer may retain the original target and icon. Both compatibility files
    # contain only current HUD assets and cannot start a retired backend.
    shutil.copy2(ICON, COMPAT.parent / 'codex.ico')
    for index, path, link in selected:
        target = COMPAT if index == 1 else wrapper
        link.Arguments = '"'+str(target)+'"'
        link.IconLocation = str(ICON)+',0'
        link.WorkingDirectory = str(ROOT)
        link.Description = translate('shortcut.description')
        link.Save()
        store = propsys.SHGetPropertyStoreFromParsingName(str(path), None, shellcon.GPS_READWRITE)
        store.SetValue(pscon.PKEY_AppUserModel_ID, propsys.PROPVARIANTType(app_id))
        store.Commit()
        assert store.GetValue(pscon.PKEY_AppUserModel_ID).GetValue() == app_id
        del store
        verify = shell_object.CreateShortcut(str(path))
        assert Path(verify.Arguments.strip('"')) == target and verify.IconLocation == str(ICON)+',0'
        backup = recovery / ('project.lnk' if index == 0 else 'taskbar.lnk' if index == 1 else 'startup.lnk')
        if index == 1 and path.name != 'Codex.lnk':
            backup = recovery / ('taskbar-' + path.name)
        if not backup.exists():
            shutil.copy2(path, backup)
        shell.SHChangeNotify(shellcon.SHCNE_UPDATEITEM, shellcon.SHCNF_PATHW, str(path), None)
    shell.SHChangeNotify(shellcon.SHCNE_ASSOCCHANGED, shellcon.SHCNF_IDLIST, None, None)
    result = {'locale': language(), 'message': translate('shortcut.updated'),
                      'updatedShortcuts': [str(p) for _, p, _ in selected],
                      'pinnedShortcutUpdated': any(i == 1 for i, _, _ in selected),
                      'skippedUnmanagedShortcuts': skipped,
                      'appId': app_id, 'appIdPreserved': not identity_changed, 'recovery': str(recovery)}
    if not quiet:
        print(json.dumps(result, ensure_ascii=False))
    return result


if __name__ == '__main__':
    install()
