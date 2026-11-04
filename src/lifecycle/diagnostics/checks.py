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
from src.platform.codex.desktop_package import discover
from src.platform.codex.desktop_listener import verified_listener
from src.platform.codex.processes import desktops
from src.platform.i18n.localization import text
from src.platform.codex.recovery_appearance import appearance
from src.lifecycle.recovery.relaunch import prepare

from src.lifecycle.diagnostics.results import t, row, summarize, report
from src.lifecycle.diagnostics import management
from src.lifecycle.startup import model_gateway

IDS = ('app', 'sessions', 'sandbox', 'network', 'enhancements', 'permissions')
MANAGEMENT_IDS = ('prompts', 'updates', 'entries', 'runtime')
SEVERITY = {'fail': 5, 'warning': 4, 'unknown': 3, 'pass': 2, 'notApplicable': 1}


def with_gateway(result, gateway):
    """Fold loopback gateway evidence into the single displayed network item."""
    if not gateway:
        return result
    clauses = [value.rstrip('.。') for value in (result['detail'], gateway['detail']) if value]
    detail = '\n'.join(clause for clause in clauses if clause)
    if SEVERITY.get(gateway['state'], 3) > SEVERITY.get(result['state'], 2):
        return {**result, 'state': gateway['state'], 'status': gateway['status'], 'detail': detail,
                'suggestion': gateway['suggestion']}
    return {**result, 'detail': detail, 'suggestion': result['suggestion'] or gateway['suggestion']}


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


def window_state(pid):
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
        if owner.value == pid:
            if not user.IsWindowVisible(hwnd):
                found.append('hidden')
                return True
            result = ctypes.c_size_t()
            # WM_NULL only, bounded; never switch, close, or write to the window.
            if user.SendMessageTimeoutW(hwnd, 0, 0, 0, 2, 300, ctypes.byref(result)):
                found.append('ready')
            else:
                found.append('unresponsive')
        return True

    if not user.EnumWindows(visit, 0):
        return 'unknown'
    return next((state for state in ('ready', 'unresponsive', 'hidden') if state in found), 'missing')


class Checks:
    def __init__(self, settings_path, package=None, extra_checks=None):
        self.settings_path = Path(settings_path)
        self.extra_checks = extra_checks or {}
        self.settings_error = self.config_error = False
        try:
            self.settings = read_json(settings_path)
            if not isinstance(self.settings, dict):
                raise ValueError('Invalid settings')
        except (OSError, ValueError):
            self.settings, self.settings_error = {}, True
        self.runtime = Path(settings_path).parent / 'runtime'
        self.home = Path(self.settings.get('codexHome') or Path.home() / '.codex')
        try:
            self.config = tomllib.loads((self.home / 'config.toml').read_text(encoding='utf-8-sig'))
        except (OSError, ValueError):
            self.config, self.config_error = {}, True
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
        desktop, state = None, 'missing'
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
            if len(roots) > 1 or other_instances:
                self.app_ready.set()
                return row('app', 'unknown', t('packageUnavailable'), t('appHint'))
            desktop = roots[0] if len(roots) == 1 else None
            state = window_state(desktop['pid']) if desktop else 'missing'
            if desktop and state == 'ready':
                if process_matches(desktop['pid'], desktop['create_time'], self.package['executable']):
                    self.desktop = desktop
                    self.app_ready.set()
                    return row('app', 'pass', t('appReady'), summary=t('previewApp'))
            if not candidates and self.launch_reason() == 'activation-failed':
                self.app_ready.set()
                return row('app', 'fail', text('launch.activation-failed'), t('appHint'), summary=t('activationFailed'))
            time.sleep(.5)
        # Window visibility is not process identity. Keep verified process facts
        # available to token/interface probes even when the window stays hidden.
        if desktop and process_matches(desktop['pid'], desktop['create_time'], self.package['executable']):
            self.desktop = desktop
        self.app_ready.set()
        if self.desktop:
            if state == 'hidden':
                return row('app', 'notApplicable', t('appHidden'), status=t('appBackground'))
            if state == 'unresponsive':
                return row('app', 'fail', t('appUnresponsive'), t('appHint'))
            return row('app', 'unknown', t('appWindowUnknown'), t('appHint'))
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
        started = datetime.datetime.now().astimezone().isoformat(timespec='seconds')
        attempts = []
        for attempt in range(3):
            result = self.network_attempt()
            attempts.append({'checkedAt': datetime.datetime.now().astimezone().isoformat(timespec='seconds'),
                             'state': result['state'], 'detail': result['detail']})
            if result['state'] not in ('fail', 'warning') or result['detail'] == t('tlsFailed'):
                break
            if attempt < 2:
                time.sleep(8)
        gateway = None
        try:
            gateway = self.gateway()
        except (OSError, ValueError, TypeError, psutil.Error):
            gateway = None  # A local gateway probe must not turn reachability into a failure.
        result = with_gateway(result, gateway)
        # Keep only sanitized outcomes, never target/proxy URLs or raw exceptions.
        try:
            self.runtime.mkdir(parents=True, exist_ok=True)
            path = self.runtime / 'last-network-check.json'
            temporary = path.with_suffix('.next')
            temporary.write_text(json.dumps({'startedAt': started, 'attempts': attempts,
                'gateway': gateway['state'] if gateway else 'notApplicable'}, ensure_ascii=False), encoding='utf-8')
            temporary.replace(path)
        except OSError:
            pass  # Evidence persistence must not turn a completed check into a failure.
        return result

    @staticmethod
    def gateway_owner(address):
        """Name of the process listening on a loopback port; empty when unconfirmed."""
        host, port = address
        hosts = {'::1', '::'} if host == '::1' else {'127.0.0.1', '0.0.0.0'}
        if host == 'localhost':
            hosts |= {'::1', '::'}
        try:
            for connection in psutil.net_connections('tcp'):
                if (connection.status != psutil.CONN_LISTEN or not connection.laddr or
                        connection.laddr.port != port or connection.laddr.ip not in hosts):
                    continue
                try:
                    return (psutil.Process(connection.pid).name() or '').lower()
                except (psutil.Error, TypeError):
                    return ''
        except psutil.Error:
            return ''
        return ''

    @staticmethod
    def gateway_reachable(address):
        # A gateway that is still booting is the known cause of the settings-load
        # failure, so allow a bounded number of short attempts before reporting it down.
        for attempt in range(3):
            if model_gateway.reachable(address):
                return True
            if attempt < 2:
                time.sleep(1)
        return False

    def gateway(self):
        """Read-only check of the local magpie gateway that Codex sends model traffic to.

        Returns None when this configuration does not route model traffic to a
        loopback gateway, so installations without magpie keep the plain network row.
        """
        address = model_gateway.endpoint(self.config)
        catalog = str(self.config.get('model_catalog_json') or '')
        if address is None:
            return None
        if not self.gateway_reachable(address):
            return row('gateway', 'fail', t('gatewayDown'), t('gatewayHint'))
        owner = self.gateway_owner(address)
        if owner and 'magpie' not in owner:
            return row('gateway', 'warning', t('gatewayForeign'), t('gatewayHint'))
        if catalog and not (self.home / catalog).is_file():
            return row('gateway', 'warning', t('gatewayCatalogMissing'), t('gatewayHint'))
        return row('gateway', 'pass', t('gatewayReady'))

    def network_attempt(self):
        provider = self.config.get('model_provider', 'openai')
        url = self.config.get('model_providers', {}).get(provider, {}).get('base_url') or self.config.get('chatgpt_base_url') or 'https://chatgpt.com/'
        target = urllib.parse.urlsplit(url)
        if target.scheme != 'https' or not target.hostname:
            return row('network', 'unknown', t('networkFailed'), t('networkHint'))
        # No authentication, no inference request, no prompt, no redirects.
        url = urllib.parse.urlunsplit(('https', target.netloc.split('@')[-1], '/', '', ''))
        proxy = self.proxy()
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
        known_vpn = vpn_installed or vpn_kernel or vpn_helper
        if known_vpn and not (vpn_kernel and vpn_helper):
            return row('network', 'warning', t('vpnDown'), t('networkHint'))
        return row('network', 'pass', t('vpnReady' if vpn_kernel and vpn_helper else 'networkReady'))

    def enhancements(self):
        self.app_ready.wait(32)
        if not self.desktop or not process_matches(self.desktop['pid'], self.desktop['create_time'], self.package['executable']):
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
                            return row('enhancements', 'notApplicable', t('hudWaiting'), status=t('pass'))
                        return {**row('enhancements', 'warning', t('hudPartial'), t('hudHint')), 'restartRecommended': True}
            except (OSError, ValueError, KeyError, TypeError, psutil.Error):
                pass
            time.sleep(.5)
        if not process_matches(self.desktop['pid'], self.desktop['create_time'], self.package['executable']):
            return row('enhancements', 'unknown', t('hudUnavailable'), t('hudHint'))
        reason = self.launch_reason()
        try:
            # An orphan/foreign listener must not hide a confirmed missing
            # interface on the identified current desktop behind "unknown".
            mains = [p for p in desktops(self.package) if p['main']]
            if (len(mains) == 1 and mains[0]['pid'] == self.desktop['pid'] and
                    abs(mains[0]['started'] - self.desktop['create_time']) < .01 and not mains[0]['debuggingRequested']):
                reason = 'restart-required'
        except (OSError, ValueError, KeyError, TypeError, psutil.Error):
            pass
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
        return row('permissions', 'pass', t('permissionReady'),
                   status=t('admin' if elevated else 'ordinary'))

    def prompts(self):
        if self.config_error:
            return row('prompts', 'unknown', t('runtimeConfigInvalid'))
        probe = self.extra_checks.get('prompts')
        return probe(self) if probe else row('prompts', 'notApplicable', t('promptUnavailable'))

    def updates(self):
        self.app_ready.wait(32)
        return management.updates(self.settings, self.runtime)

    def entries(self):
        return management.entries(self.settings_path)

    def runtime_check(self):
        if not self.settings_error:
            self.app_ready.wait(24)  # Leave room for 4s + 4s + 8s probes inside the 48s UI budget.
        return management.runtime(self)


def run(settings, output, after_update=False, extra_checks=None, observer=None):
    output = Path(output)
    rows = {key: row(key, 'pending') for key in IDS + MANAGEMENT_IDS}
    checks = None

    def publish():
        data = report(list(rows.values()), (checks.package or {}).get('packageVersion') if checks else None)
        data['rows'] = [rows[key] for key in IDS]
        data['managementRows'] = [rows[key] for key in MANAGEMENT_IDS]
        if checks:
            if data['state'] != 'checking' and checks.package:
                try:
                    data['relaunch'] = prepare(settings, checks.package, rows['enhancements'], after_update)
                    activity = data['relaunch'].get('activity', {})
                    if activity.get('state') in ('busy', 'unknown'):
                        key = 'sessionBusy' if activity['state'] == 'busy' else 'sessionUnknown'
                        rows['app']['summary'] = t(key + 'Cancelled' if data['relaunch'].get('cancelledForActivity') else key)
                        if rows['app']['state'] == 'pass':
                            rows['app'].update(state='warning', status=t('sessionBusyStatus' if activity['state'] == 'busy' else 'unknownStatus'))
                        if data['state'] == 'healthy':
                            data.update(state='partial', title=t('partial'))
                    rows['updates'] = management.apply_plan(rows['updates'], data['relaunch'])
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
        data['managementRows'] = [rows[key] for key in MANAGEMENT_IDS]
        if observer:
            try:
                observer(data)
            except Exception:
                pass  # Best effort history cannot interrupt report publication.
        temporary = output.with_suffix('.next')
        temporary.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
        # The Windows dialog can briefly hold the destination while reading it.
        # Keep the previous complete report until replacement succeeds.
        for attempt in range(6):
            try:
                temporary.replace(output)
                break
            except PermissionError:
                if attempt == 5:
                    raise
                time.sleep(.05)

    try:
        checks = Checks(settings, extra_checks=extra_checks)
    except (OSError, ValueError, TypeError):
        rows = {key: row(key, 'unknown', t('workerUnavailable')) for key in IDS + MANAGEMENT_IDS}
        publish()
        return
    publish()
    def probe(key):
        if checks.settings_error and key != 'runtime':
            return row(key, 'unknown', t('runtimeSettingsInvalid'))
        if checks.config_error and key in ('sandbox', 'network'):
            return row(key, 'unknown', t('runtimeConfigInvalid'))
        return getattr(checks, 'runtime_check' if key == 'runtime' else key)()

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        pending = {pool.submit(probe, key): key for key in IDS + MANAGEMENT_IDS}
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
