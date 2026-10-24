"""Read only the desktop appearance needed by the native recovery dialog."""
import json
from pathlib import Path
import re
import sys
import tomllib
import winreg


def appearance(config, system_dark):
    try:
        desktop = tomllib.loads(Path(config).read_text(encoding='utf-8-sig')).get('desktop', {})
    except (OSError, ValueError):
        desktop = {}
    mode = desktop.get('appearanceTheme', 'system')
    dark = mode == 'dark' or (mode not in ('light', 'dark') and system_dark)
    theme = desktop.get('appearanceDarkChromeTheme' if dark else 'appearanceLightChromeTheme', {})
    if isinstance(theme, str):
        try:
            theme = json.loads(theme)
        except ValueError:
            theme = {}
    surface = theme.get('surface') if isinstance(theme, dict) else None
    if not isinstance(surface, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', surface):
        surface = '#111111' if dark else '#ffffff'
    return {'dark': dark, 'surface': surface}


if __name__ == '__main__':
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                r'Software\Microsoft\Windows\CurrentVersion\Themes\Personalize') as key:
            system_dark = winreg.QueryValueEx(key, 'AppsUseLightTheme')[0] == 0
    except OSError:
        system_dark = False
    print(json.dumps(appearance(sys.argv[1], system_dark)))
