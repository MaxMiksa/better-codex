"""Bounded startup diagnostics. Never activate, repair, or restart the app."""
import argparse
import concurrent.futures
from contextlib import closing
import ctypes
from ctypes import wintypes
import datetime
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import tomllib
import urllib.error
import urllib.parse
import urllib.request
import winreg

import psutil

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))  # Bundled Python omits the script directory.
sys.path.insert(0, str(HERE.parent / 'shared'))
from desktop_package import discover
from desktop_listener import verified_listener
from localization import text
from recovery_appearance import appearance
from relaunch import prepare

IDS = ('app', 'sessions', 'sandbox', 'network', 'enhancements', 'permissions')


def t(key, **values):
    return text('check.' + key, **values)


def row(key, state, detail='', suggestion='', status=None, summary=None):
    return {'id': key, 'label': t(key), 'state': state, 'status': status or t('unknownStatus' if state == 'unknown' else state),
            'detail': detail, 'summary': summary, 'suggestion': suggestion}


def summarize(rows):
    if any(r['state'] == 'pending' for r in rows):
        return 'checking'
    if any(r['state'] == 'fail' and r['id'] in ('app', 'sessions', 'sandbox', 'network') for r in rows):
        return 'failed'
    if any(r['state'] in ('fail', 'warning') for r in rows):
        return 'partial'
    if any(r['state'] == 'unknown' for r in rows):
        return 'unknown'
    return 'healthy'


def report(rows, version=None):
    state = summarize(rows)
    return {'state': state, 'title': t(state), 'description': t(state + 'Description'),
            'rows': rows, 'checkedAt': datetime.datetime.now().astimezone().isoformat(timespec='seconds'),
            'packageVersion': version or '', 'note': t('note'), 'modelMessageSent': False}


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def process_matches(pid, created, executable=None):
    try:
        p = psutil.Process(pid)
        return abs(p.create_time() - created) < .01 and (not executable or
            os.path.normcase(p.exe()) == os.path.normcase(str(executable)))
    except (psutil.Error, TypeError, ValueError):
        return False


def process_elevated(pid):
    kernel, advapi = ctypes.WinDLL('kernel32', use_last_error=True), ctypes.WinDLL('advapi32', use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    advapi.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    advapi.GetTokenInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p,
                                         wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
    handle, token = kernel.OpenProcess(0x1000, False, pid), wintypes.HANDLE()
    if not handle:
        return None
    try:
        if not advapi.OpenProcessToken(handle, 8, ctypes.byref(token)):
            return None
        value, length = wintypes.DWORD(), wintypes.DWORD()
        if not advapi.GetTokenInformation(token, 20, ctypes.byref(value), ctypes.sizeof(value), ctypes.byref(length)):
            return None
        return bool(value.value)
    finally:
        if token:
            kernel.CloseHandle(token)
        kernel.CloseHandle(handle)


def responsive_window(pid):
    user = ctypes.WinDLL('user32', use_last_error=True)
    user.IsWindowVisible.argtypes = [wintypes.HWND]
    user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user.SendMessageTimeoutW.argtypes = [wintypes.HWND, wintypes.UINT, ctypes.c_size_t, ctypes.c_ssize_t,
                                       wintypes.UINT, wintypes.UINT, ctypes.POINTER(ctypes.c_size_t)]
    user.SendMessageTimeoutW.restype = ctypes.c_ssize_t
    found = []
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]

    @callback_type
    def visit(hwnd, unused):
        owner = wintypes.DWORD()
        user.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value == pid and user.IsWindowVisible(hwnd):
            result = ctypes.c_size_t()
            # WM_NULL only, bounded; never switch, close, or write to the window.
            if user.SendMessageTimeoutW(hwnd, 0, 0, 0, 2, 300, ctypes.byref(result)):
                found.append(True)
        return True

    user.EnumWindows(visit, 0)
    return bool(found)


class Checks:
    def __init__(self, settings_path, package=None):
        self.settings = read_json(settings_path)
        self.runtime = Path(settings_path).parent / 'runtime'
        self.home = Path(self.settings.get('codexHome') or Path.home() / '.codex')
        self.config = tomllib.loads((self.home / 'config.toml').read_text(encoding='utf-8-sig'))
        self.package = package
        self.started = time.time()
        self.package_ready = threading.Event()
        self.app_ready = threading.Event()
        self.desktop = None

    def launch_reason(self):
        try:
            receipt = read_json(self.runtime / 'launch-receipt.json')
            stamp = datetime.datetime.fromisoformat(receipt['checkedAtUtc'].replace('Z', '+00:00')).timestamp()
            if self.started - 4 <= stamp <= time.time() + 2:
                return receipt.get('hudReason')
        except (OSError, ValueError, KeyError, TypeError):
            pass
        return None

    def app(self):
        deadline = time.monotonic() + 30
        try:
            self.package = self.package or discover()
        except (OSError, ValueError, KeyError, subprocess.SubprocessError):
            self.package_ready.set()
            self.app_ready.set()
            return row('app', 'unknown', t('packageUnavailable'), t('appHint'))
        self.package_ready.set()
        while time.monotonic() < deadline:
            candidates = []
            other_instances = False
            for p in psutil.process_iter(['pid', 'ppid', 'name', 'exe', 'create_time']):
                if (p.info['name'] or '').lower() != 'chatgpt.exe':
                    continue
                if p.info['exe'] and os.path.normcase(p.info['exe']) == os.path.normcase(self.package['executable']):
                    candidates.append(p.info)
                elif p.info['exe']:
                    other_instances = True
            ids = {p['pid'] for p in candidates}
            roots = [p for p in candidates if p['ppid'] not in ids]
            ready = [p for p in roots if responsive_window(p['pid'])]
            if len(ready) == 1:
                self.desktop = ready[0]
                self.app_ready.set()
                return row('app', 'pass', t('appReady'), summary=t('previewApp'))
            if len(ready) > 1 or other_instances:
                self.app_ready.set()
                return row('app', 'unknown', t('packageUnavailable'), t('appHint'))
            if not candidates and self.launch_reason() == 'activation-failed':
                self.app_ready.set()
                return row('app', 'fail', text('launch.activation-failed'), t('appHint'), summary=t('activationFailed'))
            time.sleep(.5)
        self.app_ready.set()
        return row('app', 'fail', t('appMissing'), t('appHint'))

    def sessions(self):
        index = self.home / 'session_index.jsonl'
        databases = list(self.home.glob('state_*.sqlite'))
        if not index.exists() and not databases:
            return row('sessions', 'notApplicable', t('sessionsEmpty'))
        try:
            if index.exists():
                with index.open('rb') as stream:
                    first = stream.readline(1024 * 1024)
                    if first.strip():
                        json.loads(first.decode('utf-8-sig'))
            if not databases:
                return row('sessions', 'unknown', t('sessionsBusy'), t('sessionsHint'))
            database = max(databases, key=lambda p: p.stat().st_mtime)
            with closing(sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True, timeout=.2)) as connection:
                connection.execute('PRAGMA query_only=ON')
                paths = connection.execute('SELECT rollout_path FROM threads ORDER BY updated_at DESC LIMIT 5').fetchall()
            checked = 0
            for (filename,) in paths:
                filename = str(filename or '')
                if filename.startswith('\\\\?\\'):
                    filename = filename[4:]
                path = Path(os.path.normpath(filename))
                if not path.is_absolute():
                    path = self.home / path
                # Do not inspect unrelated files referenced by a damaged index.
                if not any(path.absolute().is_relative_to((self.home / d).absolute()) or
                           path.resolve().is_relative_to((self.home / d).resolve()) for d in ('sessions', 'archived_sessions')):
                    return row('sessions', 'unknown', t('sessionsBusy'), t('sessionsHint'))
                with path.open('rb') as stream:
                    first = stream.readline(1024 * 1024)
                if not first.endswith(b'\n'):
                    return row('sessions', 'unknown', t('sessionsBusy'), t('sessionsHint'))
                json.loads(first.decode('utf-8-sig'))
                checked += 1
            return row('sessions', 'pass' if checked else 'notApplicable',
                       t('sessionsReady', count=checked) if checked else t('sessionsEmpty'),
                       summary=t('previewSessions') if checked else None)
        except sqlite3.OperationalError:
            return row('sessions', 'unknown', t('sessionsBusy'), t('sessionsHint'))
        except (OSError, ValueError, sqlite3.DatabaseError):
            return row('sessions', 'fail', t('sessionsUnavailable'), t('sessionsHint'))

    def sandbox(self):
        self.package_ready.wait(22)
        try:
            mode = self.config.get('sandbox_mode')
            if mode == 'danger-full-access':
                marker = 'BETTER_CODEX_BASIC_OK'
                result = subprocess.run([str(Path(os.environ['WINDIR']) / 'System32/cmd.exe'), '/d', '/c', 'echo', marker],
                                        capture_output=True, timeout=5, creationflags=subprocess.CREATE_NO_WINDOW)
                if result.returncode == 0 and marker.encode() in result.stdout:
                    return row('sandbox', 'notApplicable', t('executionReady'), status=t('fullAccess'))
                return row('sandbox', 'fail', t('executionFailed'))
            if not self.package:
                return row('sandbox', 'unknown', t('packageUnavailable'), t('sandboxHint'))
            resources = Path(self.package['executable']).parent / 'resources'
            if not (resources / 'codex.exe').exists() or not (resources / 'codex-command-runner.exe').exists():
                return row('sandbox', 'fail', t('sandboxMissing'), t('sandboxHint'))
            backend = self.config.get('windows', {}).get('sandbox')
            if backend == 'mxc':
                # MXC has no legacy account/ACL provisioning. Never switch backends.
                result = subprocess.run([str(resources / 'codex.exe'), '-c', 'approval_policy="never"',
                    'sandbox', '--include-managed-config', '--permission-profile', ':read-only', '--',
                    str(Path(os.environ['WINDIR']) / 'System32/cmd.exe'), '/d', '/c', 'echo', 'BETTER_CODEX_MXC_OK'],
                    capture_output=True, timeout=8, creationflags=subprocess.CREATE_NO_WINDOW)
                if result.returncode == 0 and b'BETTER_CODEX_MXC_OK' in result.stdout:
                    return row('sandbox', 'pass', t('mxcReady'), status=t('basicPassed'))
                return row('sandbox', 'unknown', t('sandboxUnconfirmed'), t('sandboxHint'))
            # Legacy sandbox execution may reconcile machine accounts and ACLs.
            # Presence of setup_marker.json is evidence, never proof of health.
            return row('sandbox', 'unknown', t('sandboxUnconfirmed'), t('sandboxHint'))
        except (OSError, subprocess.SubprocessError):
            return row('sandbox', 'unknown', t('executionFailed'), t('sandboxHint'))

    def proxy(self):
        values = dict(os.environ)
        # Load only proxy keys. Never expose .env contents or credentials.
        try:
            for line in (self.home / '.env').read_text(encoding='utf-8-sig').splitlines():
                key, sep, value = line.partition('=')
                key = key.strip().removeprefix('export ')
                if sep and key.lower() in ('https_proxy', 'http_proxy', 'all_proxy', 'no_proxy'):
                    values.setdefault(key.upper(), value.strip().strip('"').strip("'"))
        except OSError:
            pass
        proxy = values.get('HTTPS_PROXY') or values.get('https_proxy') or values.get('ALL_PROXY') or values.get('all_proxy')
        if not proxy:
            try:
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Internet Settings') as key:
                    enabled = winreg.QueryValueEx(key, 'ProxyEnable')[0]
                    server = winreg.QueryValueEx(key, 'ProxyServer')[0] if enabled else ''
                for part in server.split(';'):
                    if part.startswith('https='):
                        proxy = part.partition('=')[2]
                        break
                    if '=' not in part:
                        proxy = part
            except OSError:
                pass
        return proxy if not proxy or '://' in proxy else 'http://' + proxy

    def network(self):
        provider = self.config.get('model_provider', 'openai')
        url = self.config.get('model_providers', {}).get(provider, {}).get('base_url') or self.config.get('chatgpt_base_url') or 'https://chatgpt.com/'
        target = urllib.parse.urlsplit(url)
        if target.scheme != 'https' or not target.hostname:
            return row('network', 'unknown', t('networkFailed'), t('networkHint'))
        # No authentication, no inference request, no prompt, no redirects.
        url = urllib.parse.urlunsplit(('https', target.netloc.split('@')[-1], '/', '', ''))
        proxy = self.proxy()
        vpn_kernel, vpn_helper, vpn_installed = False, False, False
        try:
            service = psutil.win_service_get('luyucloudHelperService')
            vpn_installed = True
            vpn_helper = service.status() == 'running'
        except psutil.Error:
            pass
        for p in psutil.process_iter(['name', 'exe', 'ppid']):
            name = (p.info['name'] or '').lower()
            if name == 'luyucloudcore.exe':
                vpn_kernel = True
        if proxy:
            address = urllib.parse.urlsplit(proxy)
            if address.scheme not in ('http', 'https') or not address.hostname:
                return row('network', 'unknown', t('networkFailed'), t('networkHint'))
            try:
                with socket.create_connection((address.hostname, address.port or 80), timeout=2):
                    pass
            except OSError:
                return row('network', 'fail', t('proxyFailed'), t('networkHint'))

        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None

        opener = urllib.request.build_opener(urllib.request.ProxyHandler({'https': proxy} if proxy else {}),
                                             NoRedirect)
        try:
            request = urllib.request.Request(url, method='HEAD', headers={'User-Agent': 'Better-Codex-Startup-Check'})
            try:
                with opener.open(request, timeout=6) as response:
                    response.read(0)
            except urllib.error.HTTPError:
                # 401/403/405 etc. prove HTTP reachability, not account readiness.
                pass
        except (OSError, urllib.error.URLError, ValueError) as error:
            import ssl
            reason = getattr(error, 'reason', error)
            detail = 'tlsFailed' if isinstance(reason, ssl.SSLCertVerificationError) else 'networkFailed'
            return row('network', 'fail', t(detail), t('networkHint'))
        known_vpn = vpn_installed or vpn_kernel or vpn_helper
        if known_vpn and not (vpn_kernel and vpn_helper):
            return row('network', 'warning', t('vpnDown'), t('networkHint'))
        return row('network', 'pass', t('vpnReady' if vpn_kernel and vpn_helper else 'networkReady'))

    def enhancements(self):
        self.app_ready.wait(30)
        if not self.desktop:
            return row('enhancements', 'unknown', t('hudUnavailable'), t('hudHint'))
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                launcher = read_json(self.runtime / 'launcher.json')
                created = datetime.datetime.fromisoformat(launcher['startedAt'].replace('Z', '+00:00')).timestamp()
                supervisor = read_json(self.runtime / 'supervisor.json')
                view = read_json(self.runtime / 'view-status.json')
                fresh = -2 <= time.time() - supervisor['checkedAt'] < 10 and -2 <= time.time() - view['checkedAt'] / 1000 < 8
                owner = verified_listener(self.settings['port'], Path(self.package['executable']), self.package['sha256']) if self.package else None
                if fresh and owner and supervisor.get('desktopPid') == owner[0] and process_matches(launcher['supervisorPid'], created, self.settings.get('python')):
                    windows = [w for w in view.get('windows', []) if w.get('visible') or w.get('readingWidth', {}).get('applied')]
                    if not windows:
                        windows = view.get('windows', [])
                    controller = psutil.Process(supervisor['controllerPid'])
                    controller_valid = os.path.normcase(controller.exe()) == os.path.normcase(self.settings['node']) and controller.ppid() == launcher['supervisorPid']
                    if controller_valid and windows and all(-2 <= time.time() - w.get('checkedAt', 0) / 1000 < 8 for w in windows):
                        loaded = all(isinstance(w.get('fileChanges', {}).get('cards'), int) and
                                     not w.get('readingWidth', {}).get('reason', '').startswith('layout-or-settings') for w in windows)
                        if loaded and any(w.get('visible') and w.get('readingWidth', {}).get('applied') for w in windows):
                            return row('enhancements', 'pass', t('hudReady'), summary=t('previewEnhancements'))
                        if loaded:
                            return row('enhancements', 'notApplicable', t('hudWaiting'))
                        return {**row('enhancements', 'warning', t('hudPartial'), t('hudHint')), 'restartRecommended': True}
            except (OSError, ValueError, KeyError, TypeError, psutil.Error):
                pass
            time.sleep(.5)
        reason = self.launch_reason()
        if reason in ('restart-required', 'unverified-listener', 'hud-preparation-failed'):
            summary = {'restart-required': 'hudNoInterface', 'unverified-listener': 'hudIdentityUnverified',
                       'hud-preparation-failed': 'hudDependencies'}[reason]
            return {**row('enhancements', 'warning', text('launch.' + reason), t('hudHint'), summary=t(summary)),
                    'restartRecommended': reason == 'restart-required'}
        # A missing listener on an identified running app confirms that our
        # enhancements cannot attach; stale/unknown snapshots alone do not.
        try:
            absent = not any(c.status == psutil.CONN_LISTEN and c.laddr.port == self.settings['port']
                             for c in psutil.net_connections('tcp'))
        except psutil.Error:
            absent = False
        return {**row('enhancements', 'warning' if absent else 'unknown', t('hudUnavailable'), t('hudHint')),
                'restartRecommended': absent}

    def permissions(self):
        self.app_ready.wait(32)
        if not self.desktop or not process_matches(self.desktop['pid'], self.desktop['create_time'], self.package['executable']):
            return row('permissions', 'unknown', t('permissionUnknown'))
        elevated = process_elevated(self.desktop['pid'])
        if elevated is None:
            return row('permissions', 'unknown', t('permissionUnknown'))
        state = 'warning' if self.settings.get('runAsAdministrator') and not elevated else 'pass'
        return row('permissions', state, t('permissionMismatch' if state == 'warning' else 'permissionReady'),
                   status=t('admin' if elevated else 'ordinary'))


def run(settings, output, after_update=False):
    output = Path(output)
    rows = {key: row(key, 'pending') for key in IDS}
    checks = None

    def publish():
        data = report(list(rows.values()), (checks.package or {}).get('packageVersion') if checks else None)
        if checks:
            if data['state'] != 'checking' and checks.package:
                try:
                    data['relaunch'] = prepare(settings, checks.package, rows['enhancements'], after_update)
                    if data['relaunch'].get('automatic') and data['relaunch'].get('reason') == 'updated':
                        rows['app']['summary'] = t('updatedSummary')
                        rows['app']['status'] = t('updatedStatus')
                        if data['state'] == 'healthy':
                            data.update(state='partial', title=t('partial'))
                except (OSError, ValueError, KeyError, TypeError, psutil.Error):
                    data['relaunch'] = {'allowed': False}
            try:
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Themes\Personalize') as key:
                    dark = winreg.QueryValueEx(key, 'AppsUseLightTheme')[0] == 0
            except OSError:
                dark = False
            data['appearance'] = appearance(checks.home / 'config.toml', dark)
        temporary = output.with_suffix('.next')
        temporary.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
        temporary.replace(output)

    try:
        checks = Checks(settings)
    except (OSError, ValueError, TypeError):
        rows = {key: row(key, 'unknown', t('workerUnavailable')) for key in IDS}
        publish()
        return
    publish()
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        pending = {pool.submit(getattr(checks, key)): key for key in IDS}
        for future in concurrent.futures.as_completed(pending):
            key = pending[future]
            try:
                rows[key] = future.result()
            except Exception:
                # Diagnostics must not serialize raw exceptions, paths or URLs.
                rows[key] = row(key, 'unknown', t('workerUnavailable'))
            publish()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--settings', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--after-update', action='store_true')
    args = parser.parse_args()
    run(args.settings, args.output, args.after_update)
