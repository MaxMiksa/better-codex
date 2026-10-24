"""Verify actual release ZIPs and non-activating portable modes on Windows."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--portable', type=Path, required=True)
    parser.add_argument('--work', type=Path, required=True)
    args = parser.parse_args()
    work = args.work.resolve()
    if not work.is_relative_to(ROOT / '.validation-runtime') or work.exists():
        parser.error('Use a fresh work directory inside this copy\'s .validation-runtime')
    work.mkdir(parents=True)
    spec = importlib.util.spec_from_file_location('package', ROOT / 'scripts/package.py')
    package = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(package)
    expected_source = {p.relative_to(ROOT).as_posix(): p.read_bytes() for p in package.public_files()}
    expected_runtime = {p.relative_to(ROOT).as_posix(): p.read_bytes() for p in package.public_files(False)}
    checks = []

    def check(name, condition):
        if not condition:
            raise AssertionError(name)
        checks.append(name)

    def contents(path):
        with zipfile.ZipFile(path) as archive:
            check(path.name + '-integrity', archive.testzip() is None)
            names = archive.namelist()
            prefix = names[0].split('/')[0]
            check(path.name + '-single-root', all(name.startswith(prefix + '/') for name in names))
            values = {name[len(prefix) + 1:]: archive.read(name) for name in names}
            check(path.name + '-unique-paths', len(values) == len(names))
            check(path.name + '-bounded-paths', all(not Path(name).is_absolute() and '..' not in Path(name).parts for name in values))
            return values

    source = contents(args.source)
    portable = contents(args.portable)
    check('source-exact-manifest', source == expected_source)
    check('portable-product-files', all(portable.get(name) == value for name, value in expected_runtime.items()))
    check('portable-no-tests-or-private-state', not any(name.startswith(('tests/', 'prompts/', 'src/prompts/', '.runtime/')) for name in portable))
    manifest = json.loads(portable['runtime/manifest.json'])
    runtime = {name for name in portable if name.startswith('runtime/') and name != 'runtime/manifest.json'}
    check('runtime-manifest-set', set(manifest['files']) == runtime)
    check('runtime-file-digests', all(hashlib.sha256(portable[name]).hexdigest() == digest for name, digest in manifest['files'].items()))
    check('portable-exact-file-set', set(portable) == set(expected_runtime) | runtime | {'runtime/manifest.json', 'BetterCodex.exe'})
    app = work / 'portable'
    for name, content in portable.items():
        path = app / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    env = {**os.environ, 'PATH': str(Path(os.environ['WINDIR']) / 'System32'),
           'APPDATA': str(work / 'appdata'), 'CODEX_HOME': str(work / 'synthetic-home')}
    for key in ('PYTHONHOME', 'PYTHONPATH'):
        env.pop(key, None)

    def invoke(folder, mode, locale='auto'):
        result = subprocess.run([str(folder / 'BetterCodex.exe'), mode], cwd=folder,
            env={**env, 'BETTER_CODEX_LANGUAGE': locale}, capture_output=True,
            encoding='utf-8-sig', errors='replace', timeout=90, creationflags=subprocess.CREATE_NO_WINDOW)
        if result.returncode:
            raise AssertionError(mode + ': ' + result.stdout + result.stderr)
        return json.loads(result.stdout)

    for locale in ('en', 'zh-CN', 'auto'):
        receipt = invoke(app, '--check', locale)
        check('portable-check-' + locale, receipt['status'] == 'ready' and not receipt['downloads'])
    check('check-does-not-create-state', not (app / '.runtime').exists())
    for number in (1, 2):
        check('prepare-' + str(number), invoke(app, '--prepare-only')['status'] == 'prepared')
    settings = app / '.runtime/token-hud/embedded/settings.json'
    data = json.loads(settings.read_text(encoding='utf-8-sig'))
    check('optional-modes-default-off', not data.get('recoverAfterUpdate') and not data.get('runAsAdministrator'))
    data.update(readingWidth=1280, customAccent=False)
    settings.write_text(json.dumps(data), encoding='utf-8')
    moved = work / '移动后的 portable'
    app.rename(moved)
    check('prepare-after-move', invoke(moved, '--prepare-only')['status'] == 'prepared')
    data = json.loads((moved / '.runtime/token-hud/embedded/settings.json').read_text(encoding='utf-8-sig'))
    check('move-keeps-preferences', data['readingWidth'] == 1280 and data['customAccent'] is False)
    check('move-rebases-private-python', data['python'] == str(moved / 'runtime/python/python.exe'))
    result = {'passed': len(checks), 'checks': checks, 'sourceFiles': len(source),
              'runtimeProductFiles': len(expected_runtime), 'portableFiles': len(portable),
              'scope': 'Actual ZIPs, --check and --prepare-only; synthetic APPDATA/home. No launch, stop or real Codex action.'}
    (work / 'results.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
