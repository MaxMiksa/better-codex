"""Compatibility entry; implementation lives under src/."""
import importlib
from pathlib import Path
import runpy
import sys

root = next(p for p in Path(__file__).resolve().parents if (p / 'src').is_dir() and (p / 'VERSION').is_file())
sys.path.insert(0, str(root))
if __name__ == '__main__':
    runpy.run_module('src.platform.codex.desktop_package', run_name='__main__')
else:
    sys.modules[__name__] = importlib.import_module('src.platform.codex.desktop_package')
