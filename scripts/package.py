"""Export only public product files; never publish a workspace or its Git history."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_FILES = [
    'README.md', 'README-zh.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
    '.gitignore', 'VERSION', 'package.json', 'requirements.txt', 'Install.ps1', 'Start.cmd', 'Stop.cmd',
    'Presentation/overview.png', 'docs/PRIVACY.md', 'docs/DEVELOPMENT.md', 'scripts/package.py',
    'scripts/build-portable.py', 'scripts/portable-lock.json',
]
CODE_SUFFIXES = {'.py', '.ps1', '.vbs', '.cjs', '.js', '.cs'}


def public_files():
    files = [ROOT / p for p in PUBLIC_FILES]
    code = ROOT / 'tools/token-hud-local'
    files.extend(p for p in code.rglob('*')
                 if p.is_file() and '__pycache__' not in p.parts and p.suffix in CODE_SUFFIXES)
    files.extend(code / 'collector' / p for p in ['LICENSE', 'VERSION'])
    for p in files:
        if not p.is_file() or not p.resolve().is_relative_to(ROOT):
            raise ValueError('Public file missing or outside root: '+str(p))
    return sorted(set(files))


def package():
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    if version != (ROOT / 'VERSION').read_text(encoding='utf-8').strip():
        raise ValueError('Product version mismatch')
    output = ROOT / 'dist'
    output.mkdir(exist_ok=True)
    name = 'better-codex-v'+version+'-source'
    archive = output / (name+'.zip')
    files = public_files()
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
        for p in files:
            bundle.write(p, name+'/'+p.relative_to(ROOT).as_posix())
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    write_checksums(version)
    print(json.dumps({'archive': str(archive), 'files': len(files), 'sha256': digest}))


def write_checksums(version):
    archives = sorted((ROOT / 'dist').glob('better-codex-v'+version+'-*.zip'))
    lines = [hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name for p in archives]
    (ROOT / 'dist/SHA256SUMS.txt').write_text('\n'.join(lines)+'\n', encoding='utf-8')


if __name__ == '__main__':
    package()
