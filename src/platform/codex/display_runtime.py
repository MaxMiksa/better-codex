"""Test the native Node display transport without starting a browser or connection."""
import subprocess


def node_has_websocket(node):
    try:
        result = subprocess.run([str(node), '-e', 'if(typeof WebSocket!=="function")process.exit(1)'],
                                capture_output=True, timeout=4, creationflags=subprocess.CREATE_NO_WINDOW)
        return result.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False
