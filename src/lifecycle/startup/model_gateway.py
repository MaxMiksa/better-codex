"""Resolve the configured local magpie endpoint and briefly wait on cold launch."""
import argparse
import json
from pathlib import Path
import socket
import time
import tomllib
import urllib.parse


def endpoint(config):
    provider = config.get('model_provider', 'openai')
    providers = config.get('model_providers') or {}
    active = providers.get(provider) or {}
    # An explicitly selected provider owns the route; builtin overrides are not
    # candidates for a different provider, and port numbers imply no priority.
    url = active.get('base_url')
    names = [str(provider), str(active.get('name') or ''), str(url or '')]
    if provider == 'openai':
        url = url or config.get('openai_base_url') or config.get('chatgpt_base_url')
        names += [str(config.get('model_catalog_json') or ''), *providers]
    if not isinstance(url, str) or 'magpie' not in ' '.join(names).lower():
        return None
    try:
        address = urllib.parse.urlsplit(url)
        host = (address.hostname or '').lower()
        if address.scheme not in ('http', 'https') or host not in ('127.0.0.1', 'localhost', '::1'):
            return None
        return host, address.port or (443 if address.scheme == 'https' else 80)
    except ValueError:
        return None


def reachable(address, timeout=.8):
    try:
        with socket.create_connection(address, timeout=timeout):
            return True
    except OSError:
        return False


def wait(settings_path, timeout=10):
    try:
        settings = json.loads(Path(settings_path).read_text(encoding='utf-8-sig'))
        if not isinstance(settings, dict):
            return False
        home = Path(settings.get('codexHome') or Path.home() / '.codex')
        address = endpoint(tomllib.loads((home / 'config.toml').read_text(encoding='utf-8-sig')))
    except (OSError, ValueError, TypeError, AttributeError):
        return False
    if address is None:
        return False
    # Leave room in the startup check's existing 30s app-detection deadline.
    deadline = time.monotonic() + timeout
    while (remaining := deadline - time.monotonic()) > 0:
        if reachable(address, min(.5, remaining)):
            return True
        time.sleep(min(.5, max(0, deadline - time.monotonic())))
    return False


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--settings', type=Path, required=True)
    args = parser.parse_args()
    wait(args.settings)  # Never print configuration or prevent official activation.
