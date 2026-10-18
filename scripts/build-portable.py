"""Build a complete offline Windows ZIP from pinned, verified upstream archives."""
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def download(item, cache):
    path = cache / item['url'].rsplit('/', 1)[-1]
    algorithm, expected = ('sha256', item['sha256']) if 'sha256' in item else item['integrity'].split('-', 1)
    if 'sha256' not in item:
        expected = base64.b64decode(expected).hex()
    if not path.exists():
        with urllib.request.urlopen(item['url'], timeout=60) as response, path.with_suffix('.part').open('wb') as stream:
            shutil.copyfileobj(response, stream)
        path.with_suffix('.part').replace(path)
    if hashlib.new(algorithm, path.read_bytes()).hexdigest() != expected:
        raise ValueError('Download digest mismatch: '+path.name)
    return path


def target(folder, name):
    path = folder / name
    if not path.resolve().is_relative_to(folder.resolve()):
        raise ValueError('Archive path outside build folder')
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def unzip(archive, folder):
    with zipfile.ZipFile(archive) as bundle:
        for item in bundle.infolist():
            if not item.is_dir():
                target(folder, item.filename).write_bytes(bundle.read(item))


def build(work):
    work = work.resolve()
    if not work.is_relative_to((ROOT / '.validation-runtime').resolve()):
        raise ValueError('Build work must stay inside this project validation directory')
    work.mkdir(parents=True, exist_ok=True)
    cache = work / 'downloads'
    cache.mkdir(exist_ok=True)
    lock = json.loads((ROOT / 'scripts/portable-lock.json').read_text(encoding='utf-8'))
    items = [lock['python'], lock['node'], *lock['wheels'], *lock['npm']]
    with ThreadPoolExecutor(max_workers=4) as pool:
        archives = list(pool.map(lambda item: download(item, cache), items))
    spec = importlib.util.spec_from_file_location('source_package', ROOT / 'scripts/package.py')
    source = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(source)
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    if version != (ROOT / 'VERSION').read_text().strip():
        raise ValueError('Version mismatch')
    app = work / 'app'
    app.mkdir(exist_ok=True)
    product = source.public_files()
    for path in product:
        target(app, path.relative_to(ROOT)).write_bytes(path.read_bytes())
    python = app / 'runtime/python'
    unzip(archives[0], python)
    prefix = 'node-v'+lock['node']['version']+'-win-x64/'
    with zipfile.ZipFile(archives[1]) as bundle:
        for filename in ['node.exe', 'LICENSE']:
            target(app / 'runtime/node', filename).write_bytes(bundle.read(prefix+filename))
    site = python / 'Lib/site-packages'
    for archive in archives[2:2+len(lock['wheels'])]:
        unzip(archive, site)
    (python / 'python314._pth').write_text('python314.zip\n.\nLib/site-packages\nLib/site-packages/win32\nLib/site-packages/win32/lib\nLib/site-packages/Pythonwin\nimport site\n', encoding='utf-8')
    (site / 'sitecustomize.py').write_text('import os\nfrom pathlib import Path\n_dll = os.add_dll_directory(str(Path(__file__).parent / "pywin32_system32"))\n', encoding='utf-8')
    for item, archive in zip(lock['npm'], archives[2+len(lock['wheels']):]):
        with tarfile.open(archive, 'r:gz') as bundle:
            for member in bundle.getmembers():
                if member.isfile() and member.name.startswith('package/'):
                    path = member.name.removeprefix('package/')
                    target(app / 'runtime/node_modules' / item['name'], path).write_bytes(bundle.extractfile(member).read())
    compiler = Path(os.environ['WINDIR']) / 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    assembly = work / 'AssemblyInfo.cs'
    assembly.write_text('using System.Reflection;\n[assembly: AssemblyTitle("Better Codex")]\n[assembly: AssemblyVersion("'+version+'.0")]\n[assembly: AssemblyFileVersion("'+version+'.0")]\n', encoding='utf-8')
    subprocess.run([str(compiler), '/nologo', '/target:winexe', '/platform:x64', '/optimize+',
                    '/reference:System.Windows.Forms.dll', '/out:'+str(app / 'BetterCodex.exe'),
                    str(ROOT / 'tools/token-hud-local/PortableLauncher.cs'), str(assembly)], check=True)
    runtime_files = [p for p in (app / 'runtime').rglob('*') if p.is_file() and p.name != 'manifest.json']
    manifest = {'productVersion': version, 'architecture': 'windows-x64', 'dependencies': lock,
                'files': {p.relative_to(app).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in runtime_files}}
    target(app, 'runtime/manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    output = ROOT / 'dist'
    output.mkdir(exist_ok=True)
    name = 'better-codex-v'+version+'-windows-x64-portable'
    archive = output / (name+'.zip')
    include = [app / p.relative_to(ROOT) for p in product]
    include += [app / 'BetterCodex.exe', app / 'runtime/manifest.json', *runtime_files]
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
        for path in sorted(include):
            bundle.write(path, name+'/'+path.relative_to(app).as_posix())
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    source.write_checksums(version)
    print(json.dumps({'archive': str(archive), 'bytes': archive.stat().st_size,
                      'files': len(include), 'sha256': digest, 'staging': str(app)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--work', type=Path, default=ROOT / '.validation-runtime/portable-build')
    build(parser.parse_args().work)
