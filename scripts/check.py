"""Run named isolated checks. Live-model and real-app actions are never registered."""
import argparse
import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    cases = json.loads((ROOT / 'tests/cases.json').read_text(encoding='utf-8'))
    cases = {key: value for key, value in cases.items() if (ROOT / value['path']).is_file()}
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('case', nargs='?', choices=sorted(cases))
    parser.add_argument('--list', action='store_true')
    parser.add_argument('--work', type=Path, default=ROOT / '.validation-runtime/checks')
    parser.add_argument('--dependencies', type=Path)
    args = parser.parse_args()
    if args.list or not args.case:
        print(json.dumps(cases, indent=2, ensure_ascii=False))
        return
    work = args.work.resolve()
    if not work.is_relative_to(ROOT / '.validation-runtime'):
        parser.error('Work must stay inside this copy\'s .validation-runtime')
    work.mkdir(parents=True, exist_ok=True)
    case = cases[args.case]
    folder = work / args.case
    values = {'work': str(folder), 'evidence': str(folder / 'evidence'), 'browser': str(folder / 'browser')}
    dependencies = json.loads(args.dependencies.read_text(encoding='utf-8-sig')) if args.dependencies else {}
    os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
    os.environ['BETTER_CODEX_TEST_WORK'] = str(folder)
    if dependencies.get('playwright'):
        os.environ['HUD_PLAYWRIGHT'] = dependencies['playwright']
    if dependencies.get('node'):
        os.environ['PATH'] = str(Path(dependencies['node']).parent) + os.pathsep + os.environ.get('PATH', '')
    script = ROOT / case['path']
    arguments = [value.format(**values) for value in case.get('args', [])]
    if case['kind'] == 'python':
        sys.argv = [str(script), *arguments]
        runpy.run_path(str(script), run_name='__main__')
        return
    if case['kind'] == 'node':
        command = [dependencies.get('node') or shutil.which('node'), str(script), *arguments]
    else:
        shell = shutil.which('pwsh') if case['kind'] == 'pwsh' else str(Path(os.environ['WINDIR']) / 'System32/WindowsPowerShell/v1.0/powershell.exe')
        command = [shell, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(script), *arguments]
    if args.case == 'multi-window':
        selected = {key: dependencies[key] for key in ('python', 'node', 'playwright')}
        fixture = work / 'dependencies.json'
        fixture.write_text(json.dumps(selected), encoding='utf-8')
        command.append(str(fixture))
    result = subprocess.run(command, cwd=ROOT, capture_output=True, encoding='utf-8-sig', errors='replace',
                            creationflags=subprocess.CREATE_NO_WINDOW)
    print(result.stdout, end='')
    print(result.stderr, end='', file=sys.stderr)
    raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()
