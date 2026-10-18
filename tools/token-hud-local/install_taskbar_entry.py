"""Maintain owned current-HUD launchers without editing Explorer's pin database."""
import json
import os
from pathlib import Path
import shutil
import win32com.client
from win32com.propsys import propsys, pscon
from win32com.shell import shell, shellcon

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / '.runtime/token-hud/embedded'
COMPAT = ROOT / '.runtime/hud/service/start-embedded.vbs'
ICON = RUNTIME / 'codex.ico'
APP_ID = 'OpenAI.Codex_2p2nqsd0c76g0!App'


def install():
    wrapper = RUNTIME / 'start-composer.vbs'
    recovery = RUNTIME / 'taskbar-recovery'
    links = [ROOT / 'launchers/Codex.lnk', Path(os.environ['APPDATA']) /
             'Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar/Codex.lnk',
             Path(os.environ['APPDATA']) / 'Microsoft/Windows/Start Menu/Programs/Startup/Codex with HUD.lnk']
    wscript = Path(os.environ['WINDIR']) / 'System32/wscript.exe'
    shell_object = win32com.client.Dispatch('WScript.Shell')
    if not ICON.is_file():
        raise FileNotFoundError('Run Install.ps1 to prepare the installed app icon')
    if not links[0].exists():
        links[0].parent.mkdir(parents=True, exist_ok=True)
        link = shell_object.CreateShortcut(str(links[0]))
        link.TargetPath = str(wscript)
        link.Arguments = '"'+str(wrapper)+'"'
        link.Save()
        store = propsys.SHGetPropertyStoreFromParsingName(str(links[0]), None, shellcon.GPS_READWRITE)
        store.SetValue(pscon.PKEY_AppUserModel_ID, propsys.PROPVARIANTType(APP_ID))
        store.Commit()
        del store
    selected, skipped = [], []
    for index, path in enumerate(links):
        if not path.exists():
            continue
        link = shell_object.CreateShortcut(str(path))
        if Path(link.TargetPath) != wscript or Path(link.Arguments.strip('"')) not in (COMPAT, wrapper):
            if index != 0:
                skipped.append(str(path))
                continue
            raise ValueError('Shortcut was changed externally; refusing to overwrite: '+str(path))
        store = propsys.SHGetPropertyStoreFromParsingName(str(path), None, shellcon.GPS_DEFAULT)
        if store.GetValue(pscon.PKEY_AppUserModel_ID).GetValue() != APP_ID:
            raise ValueError('Unexpected shortcut application identity')
        del store
        selected.append((index, path, link))
    if not selected or selected[0][0] != 0:
        raise FileNotFoundError('Project shortcut is required')
    template = (ROOT / 'tools/token-hud-local/start-composer.vbs').read_text(encoding='utf-8')
    text = template.replace('@POWERSHELL@', str(Path(os.environ['WINDIR']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'))
    text = text.replace('@SCRIPT@', str(ROOT / 'tools/token-hud-local/Start-ComposerHud.ps1'))
    for target in (wrapper, COMPAT):
        if target.exists() and target.read_text(encoding='utf-16') != text:
            raise ValueError('Owned wrapper changed externally; refusing to overwrite: '+str(target))
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
        link.Description = 'Codex with local token HUD'
        link.Save()
        store = propsys.SHGetPropertyStoreFromParsingName(str(path), None, shellcon.GPS_READWRITE)
        store.SetValue(pscon.PKEY_AppUserModel_ID, propsys.PROPVARIANTType(APP_ID))
        store.Commit()
        assert store.GetValue(pscon.PKEY_AppUserModel_ID).GetValue() == APP_ID
        del store
        verify = shell_object.CreateShortcut(str(path))
        assert Path(verify.Arguments.strip('"')) == target and verify.IconLocation == str(ICON)+',0'
        backup = recovery / ('project.lnk' if index == 0 else 'taskbar.lnk' if index == 1 else 'startup.lnk')
        if not backup.exists():
            shutil.copy2(path, backup)
    shell.SHChangeNotify(shellcon.SHCNE_ASSOCCHANGED, shellcon.SHCNF_IDLIST, None, None)
    print(json.dumps({'updatedShortcuts': [str(p) for _, p, _ in selected],
                      'pinnedShortcutUpdated': any(i == 1 for i, _, _ in selected),
                      'skippedUnmanagedShortcuts': skipped,
                      'appIdPreserved': True, 'recovery': str(recovery)}, ensure_ascii=False))


if __name__ == '__main__':
    install()
