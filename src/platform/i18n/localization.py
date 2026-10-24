"""Shared user-facing messages; never write Codex settings to select a language."""
import ctypes
import json
import locale
import os
from pathlib import Path
import re


def normalize(value):
    return 'zh-CN' if re.match(r'^zh($|-(cn|sg|hans)(-|$))', str(value).strip().replace('_', '-'), re.I) else 'en'


def language():
    override = os.environ.get('BETTER_CODEX_LANGUAGE', '')
    if override and override.lower() != 'auto':
        return normalize(override)
    return normalize(locale.windows_locale.get(ctypes.windll.kernel32.GetUserDefaultUILanguage(), 'en'))


MESSAGES = json.loads(Path(__file__).with_name('messages.json').read_text(encoding='utf-8'))


def text(key, **values):
    message = MESSAGES[language()].get(key, MESSAGES['en'].get(key, key))
    return re.sub(r'\{(\w+)\}', lambda match: str(values.get(match[1], match[0])), message)
