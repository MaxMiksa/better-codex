"""Guard module direction and explicit shipping scope without running the app."""
import ast
import json
import re
from pathlib import Path

from src.platform.paths import ROOT

manifest = json.loads((ROOT / 'release/public-files.json').read_text(encoding='utf-8'))
runtime, extras = set(manifest['runtime']), set(manifest['sourceExtras'])
assert not runtime & extras
assert all((ROOT / name).is_file() and (ROOT / name).resolve().is_relative_to(ROOT) for name in runtime | extras)
assert not any(name.startswith(('tests/', 'prompts/', 'src/prompts/', '.runtime/')) for name in runtime)
checks = 3
for path in (ROOT / 'src').rglob('*'):
    if not path.is_file() or '__pycache__' in path.parts:
        continue
    name = path.relative_to(ROOT).as_posix()
    if not name.startswith('src/prompts/'):
        assert name in runtime | extras, 'Unclassified implementation file: ' + name
    if path.suffix == '.ps1':
        for relative in re.findall(r"^\s*\.\s*\(Join-Path \$PSScriptRoot ['\"]([^'\"]+)['\"]\)", path.read_text(encoding='utf-8-sig'), re.MULTILINE):
            target = (path.parent / relative).resolve()
            assert target.is_file(), (name, relative)
            source = path.relative_to(ROOT).parts[1]
            destination = target.relative_to(ROOT).parts[1]
            assert source == 'app' or source == destination or destination == 'platform', (name, relative)
            checks += 1
    if path.suffix != '.py':
        continue
    for node in ast.walk(ast.parse(path.read_text(encoding='utf-8-sig'))):
        if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith('src.'):
            source = path.relative_to(ROOT).parts[1]
            destination = node.module.split('.')[1]
            assert source == 'app' or source == destination or destination == 'platform', (name, node.module)
            target = ROOT / node.module.replace('.', '/')
            assert target.is_dir() or target.with_suffix('.py').is_file(), (name, node.module)
            checks += 1
for folder in ('tools/token-hud-local', 'prompts/model_instructions_file'):
    for path in (ROOT / folder).rglob('*.py'):
        if '.runtime' in path.parts or '.validation-runtime' in path.parts or '__pycache__' in path.parts:
            continue
        for node in ast.walk(ast.parse(path.read_text(encoding='utf-8-sig'))):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in ('run_module', 'import_module'):
                if node.args and isinstance(node.args[0], ast.Constant):
                    module = node.args[0].value
                    target = ROOT / (module.replace('.', '/') + '.py')
                    # The public copy excludes local prompt bridges and implementation together.
                    assert target.is_file(), (str(path), module)
                    checks += 1
print(json.dumps({'passed': checks, 'scope': 'static module direction, bridges and explicit public file sets'}))
