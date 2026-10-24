"""Own the display controller without owning application or prompt lifetimes."""
from pathlib import Path
import subprocess
import psutil

from src.platform.codex.desktop_package import discover
from src.platform.codex.desktop_listener import verified_listener

HERE = Path(__file__).resolve().parent


def owner_alive(owner):
    if owner is None:
        return False
    try:
        return psutil.Process(owner[0]).create_time() == owner[1]
    except psutil.Error:
        return False


class DisplayConnection:
    def __init__(self, settings, settings_path, runtime):
        self.settings, self.settings_path, self.runtime = settings, settings_path, runtime
        self.child, self.owner, self.package = None, None, None
        self.child_exits, self.last_child_exit = 0, None

    def tick(self):
        if self.child and self.child.poll() is None and not owner_alive(self.owner):
            self.child.terminate()
            self.child.wait(timeout=5)
        if self.child and self.child.poll() is not None:
            self.child_exits += 1
            self.last_child_exit = self.child.returncode
            self.child, self.owner = None, None
        if self.child is None and not (self.runtime / 'stop').exists():
            self.owner = None
            listeners = [c for c in psutil.net_connections('tcp')
                         if c.status == psutil.CONN_LISTEN and c.laddr.port == self.settings['port']]
            if listeners:
                self.package = discover()
                self.owner = verified_listener(self.settings['port'], Path(self.package['executable']), self.package['sha256'])
                if self.owner:
                    self.child = subprocess.Popen([self.settings['node'], str(HERE / 'controller.cjs'),
                        str(self.settings_path), str(self.runtime)], stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
        return {'phase': 'controller-running' if self.child else 'waiting-desktop-connection',
                'desktopPid': self.owner[0] if self.owner else None,
                'controllerPid': self.child.pid if self.child else None,
                'packageVersion': (self.package or {}).get('packageVersion'),
                'childExits': self.child_exits, 'lastChildExit': self.last_child_exit}

    def stop(self):
        if self.child and self.child.poll() is None:
            try:
                self.child.wait(timeout=6)
            except subprocess.TimeoutExpired:
                self.child.terminate()
                self.child.wait(timeout=5)
