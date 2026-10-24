"""Cross-runtime localization checks; no installation, app activation or dialogs."""
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

from src.platform.paths import ROOT
HERE = ROOT / 'tools/token-hud-local/shared'

work = Path(sys.argv[1]).resolve()
if not work.is_relative_to(ROOT / '.validation-runtime'):
    raise ValueError('Validation files must stay inside .validation-runtime')
work.mkdir(parents=True, exist_ok=True)
from src.platform.i18n import localization
messages = localization.MESSAGES
results = []


def check(name, condition):
    if not condition:
        raise AssertionError(name)
    results.append(name)


check('catalog-key-parity', messages['en'].keys() == messages['zh-CN'].keys())
for key, value in messages['en'].items():
    check('placeholders-' + key, set(re.findall(r'\{\w+\}', value)) == set(re.findall(r'\{\w+\}', messages['zh-CN'][key])))
    check('nonempty-' + key, bool(value.strip()) and bool(messages['zh-CN'][key].strip()))

# Actual public entry points only; upstream/internal collectors do not expose UI.
entrypoints = [ROOT / 'Install.ps1', *(ROOT / 'src').rglob('*.ps1'), ROOT / 'src/app/PortableLauncher.cs',
               HERE.parent / 'portable_bootstrap.py', HERE.parent / 'install_taskbar_entry.py',
               *(ROOT / 'src/interface').rglob('*.js'), HERE.parent / 'embedded/metrics-view.cjs']
for entry in entrypoints:
    if entry.name.startswith('Verify-'):
        continue
    content = entry.read_text(encoding='utf-8-sig')
    keys = re.findall(r"(?:Get-BetterCodexText\s+|\b(?:t|text|translate)\(|BetterCodexI18n\.Text\(root,\s*)['\"]([\w.-]+)['\"]", content)
    check('referenced-keys-' + entry.name, all(key in messages['en'] for key in keys))

codex_home = work / 'codex-home'
codex_home.mkdir(exist_ok=True)
config = codex_home / 'config.toml'
env = dict(os.environ, CODEX_HOME=str(codex_home), BETTER_CODEX_LANGUAGE='auto', PYTHONDONTWRITEBYTECODE='1')
powershell = Path(os.environ['WINDIR']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
compiler = Path(os.environ['WINDIR']) / 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
harness = work / 'LocalizationCheck.cs'
harness.write_text('''using System;
class LocalizationCheck {
    static void Main(string[] args) {
        Console.OutputEncoding = new System.Text.UTF8Encoding(false);
        Console.WriteLine(BetterCodexI18n.Language());
        Console.WriteLine(BetterCodexI18n.Text(args[0], "install.complete"));
        Console.WriteLine(BetterCodexI18n.OutputMessage("{\\"message\\":\\"ok\\"}"));
    }
}
''', encoding='utf-8')
native = work / 'LocalizationCheck.exe'
subprocess.run([str(compiler), '/nologo', '/codepage:65001', '/reference:System.Web.Extensions.dll',
                '/out:' + str(native), str(harness), str(ROOT / 'src/platform/i18n/NativeI18n.cs')], check=True, capture_output=True)
subprocess.run([str(compiler), '/nologo', '/codepage:65001', '/target:winexe', '/platform:x64',
                '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll',
                '/out:' + str(work / 'BetterCodex.exe'), str(ROOT / 'src/app/PortableLauncher.cs'),
                str(ROOT / 'src/platform/i18n/NativeI18n.cs')], check=True, capture_output=True)
check('native-launcher-compiles', True)
ps_test = work / 'check.ps1'
ps_test.write_text('''. $env:BETTER_CODEX_I18N_SCRIPT
@{locale=(Get-BetterCodexLanguage);message=(Get-BetterCodexText 'install.complete')} | ConvertTo-Json -Compress
''', encoding='utf-8')
env['BETTER_CODEX_I18N_SCRIPT'] = str(ROOT / 'src/platform/i18n/i18n.ps1')
os.environ['BETTER_CODEX_LANGUAGE'] = 'auto'
computer_language = localization.language()

for setting, override, expected in [('zh-CN', 'auto', computer_language), ('en-US', 'auto', computer_language),
                                     ('zh-Hans', 'auto', computer_language), ('fr-FR', 'auto', computer_language),
                                     ('zh-CN', 'en', 'en'), ('en-US', 'zh-CN', 'zh-CN')]:
    # A nested setting must not replace the actual desktop language preference.
    config.write_text('[desktop]\nlocaleOverride = "' + setting + '"\n[desktop.other]\nlocaleOverride = "de-DE"\n', encoding='utf-8')
    env['BETTER_CODEX_LANGUAGE'] = override
    os.environ['CODEX_HOME'] = str(codex_home)
    os.environ['BETTER_CODEX_LANGUAGE'] = override
    name = setting + '-' + override
    check('python-language-' + name, localization.language() == expected)
    check('python-text-' + name, localization.text('install.complete') == messages[expected]['install.complete'])
    ps = subprocess.run([str(powershell), '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(ps_test)],
                        env=env, capture_output=True, encoding='utf-8-sig', check=True)
    receipt = json.loads(ps.stdout)
    check('powershell-language-and-text-' + name, receipt['locale'] == expected and receipt['message'] == messages[expected]['install.complete'])
    cs = subprocess.run([str(native), str(ROOT)], env=env, capture_output=True, encoding='utf-8-sig', check=True)
    check('native-language-and-text-' + name, cs.stdout.splitlines() == [expected, messages[expected]['install.complete'], 'ok'])

for name, contents, expected in [
        ('commented-table', '[desktop] # Display preferences\nlocaleOverride = "zh-CN"\n', computer_language),
        ('indented-table', '  [desktop]\nlocaleOverride = "en-US"\n', computer_language),
        ('indented-next-table', '[desktop]\nlocaleOverride = "zh-CN"\n  [desktop.other]\nlocaleOverride = "en-US"\n', computer_language),
        ('automatic-os-language', '[desktop]\nlocaleOverride = "auto"\n', None),
        ('no-config', None, None)]:
    if contents is None:
        config.unlink()
    else:
        config.write_text(contents, encoding='utf-8')
    env['BETTER_CODEX_LANGUAGE'] = 'auto'
    os.environ['BETTER_CODEX_LANGUAGE'] = 'auto'
    expected = expected or localization.language()
    check('python-configuration-' + name, localization.language() == expected)
    ps = subprocess.run([str(powershell), '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(ps_test)],
                        env=env, capture_output=True, encoding='utf-8-sig', check=True)
    check('powershell-configuration-' + name, json.loads(ps.stdout)['locale'] == expected)
    cs = subprocess.run([str(native), str(ROOT)], env=env, capture_output=True, encoding='utf-8-sig', check=True)
    check('native-configuration-' + name, cs.stdout.splitlines()[0] == expected)

# Missing optional config falls back to OS; malformed config must remain usable.
config.write_text('invalid toml [', encoding='utf-8')
env['BETTER_CODEX_LANGUAGE'] = 'auto'
os.environ['BETTER_CODEX_LANGUAGE'] = 'auto'
check('python-malformed-config-falls-back', localization.language() in messages)
ps = subprocess.run([str(powershell), '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(ps_test)], env=env, capture_output=True, encoding='utf-8-sig', check=True)
check('powershell-malformed-config-falls-back', json.loads(ps.stdout)['locale'] in messages)
cs = subprocess.run([str(native), str(ROOT)], env=env, capture_output=True, encoding='utf-8-sig', check=True)
check('native-malformed-config-falls-back', cs.stdout.splitlines()[0] in messages)
config.unlink()
check('python-missing-config-falls-back', localization.language() in messages)

installer_failure = work / 'installer-failure.ps1'
installer_failure.write_text('''try {
    & $env:BETTER_CODEX_INSTALL -CheckOnly -PythonExecutable 'missing-better-codex-python-for-check'
    exit 1
} catch { Write-Output $_.Exception.Message }
''', encoding='utf-8')
env['BETTER_CODEX_INSTALL'] = str(ROOT / 'Install.ps1')
for selected in ('en', 'zh-CN'):
    env['BETTER_CODEX_LANGUAGE'] = selected
    installed = subprocess.run([str(powershell), '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                                str(ROOT / 'Install.ps1'), '-CheckOnly', '-PythonExecutable', sys.executable,
                                '-NodeExecutable', shutil.which('node')], env=env, capture_output=True,
                               encoding='utf-8-sig', check=True)
    receipt = json.loads(installed.stdout)
    check('installer-read-only-' + selected, receipt['writesPerformed'] is False and receipt['locale'] == selected and receipt['message'] == messages[selected]['install.checkReady'])
    failure = subprocess.run([str(powershell), '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(installer_failure)],
                             env=env, capture_output=True, encoding='utf-8-sig', check=True)
    check('installer-localized-failure-' + selected, failure.stdout.strip() == messages[selected]['install.pythonMissing'])
    help_result = subprocess.run([sys.executable, '-B', '-X', 'utf8', str(HERE.parent / 'portable_bootstrap.py'), '--help'],
                                 env=env, capture_output=True, encoding='utf-8-sig', check=True)
    check('portable-localized-help-' + selected, help_result.stdout.strip() == messages[selected]['portable.help'])

spec = importlib.util.spec_from_file_location('source_package', ROOT / 'scripts/package.py')
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)
check('source-and-portable-include-catalog', ROOT / 'src/platform/i18n/messages.json' in package.public_files())
(work / 'verification.json').write_text(json.dumps({'scope': 'isolated localization; no install or dialogs', 'passed': len(results), 'checks': results}, indent=2), encoding='utf-8')
print(json.dumps({'passed': len(results), 'messageKeys': len(messages['en'])}))
