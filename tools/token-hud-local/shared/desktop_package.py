"""Resolve the current registered Store package; never trust a process name alone."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

FAMILY = 'OpenAI.Codex_2p2nqsd0c76g0'


def discover():
    command = "$p=@(Get-AppxPackage -Name OpenAI.Codex | Where-Object {$_.PackageFamilyName -eq 'OpenAI.Codex_2p2nqsd0c76g0'}); if($p.Count -ne 1){exit 1}; $p[0] | Select-Object InstallLocation,Version,PackageFamilyName,SignatureKind,Status | ConvertTo-Json -Compress"
    powershell = Path(os.environ['WINDIR']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
    result = subprocess.run([str(powershell), '-NoProfile', '-NonInteractive', '-Command', command],
                            check=True, capture_output=True, text=True, timeout=20,
                            creationflags=subprocess.CREATE_NO_WINDOW)
    package = json.loads(result.stdout)
    # Enum values in Get-AppxPackage JSON: Store=3, Ok=0.
    if package['PackageFamilyName'] != FAMILY or package['SignatureKind'] not in (3, 'Store') or package['Status'] not in (0, 'Ok'):
        raise ValueError('Expected a healthy registered Codex Store package')
    executable = Path(package['InstallLocation']) / 'app/ChatGPT.exe'
    return {'executable': str(executable), 'sha256': hashlib.sha256(executable.read_bytes()).hexdigest(),
            'packageVersion': str(package['Version']), 'packageFamily': FAMILY}


if __name__ == '__main__':
    print(json.dumps(discover()))
