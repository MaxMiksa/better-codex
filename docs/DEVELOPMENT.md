# Development

The source package keeps the existing module boundaries:

| Location | Responsibility |
| --- | --- |
| `tools/token-hud-local/collector/` | MIT-derived local event measurements and session discovery |
| `tools/token-hud-local/shared/` | Official app activation, Store package discovery and listener identity checks |
| `tools/token-hud-local/embedded/` | Controller, chat binding, statistics display, reading width and file-list presentation |
| `Install.ps1` | Private runtime dependencies, machine-local settings and the owned launch shortcut |
| `scripts/package.py` | Explicit public-file allowlist, ZIP and SHA-256 generation |

Run setup with Python 3.11+, Node.js 20+ and the official Windows Store app installed. Production attaches to the app; it does not launch a separate browser or download browser binaries. `Install.ps1 -CheckOnly` checks prerequisites without writing files. For an existing development environment, `-SkipDependencies -PlaywrightPath <absolute module path>` uses the supplied Python and Playwright instead of installing private dependencies.

## Isolated checks

Run from the repository root. The browser checks use installed Edge and synthetic pages, not your real conversation. `HUD_PLAYWRIGHT` and `HUD_BROWSER` can override their module/browser paths.

```powershell
.\tools\token-hud-local\Verify-Launcher.ps1
python -B -X utf8 tools/token-hud-local/embedded/verify_supervisor.py .validation-runtime/lock-check
node tools/token-hud-local/embedded/verify.cjs .validation-runtime/view/evidence .validation-runtime/view/browser
node tools/token-hud-local/embedded/verify-reading-width.cjs .validation-runtime/width/browser
node tools/token-hud-local/embedded/verify-file-changes.cjs .validation-runtime/files/browser
python scripts/package.py
```

Use the Python interpreter prepared by setup if `psutil` or `pywin32` is unavailable in your default interpreter. Clean only your newly created validation directories after checking their absolute paths. Do not delete a running HUD's `.runtime/`.

The version in root `VERSION` and `package.json` is the Better Codex product version. `collector/VERSION` records the independent upstream collector version and intentionally differs. Upstream source is pinned in `THIRD_PARTY_NOTICES.md`.

Page structure and the local display interface are not a stable extension API. Keep unknown layouts hidden rather than guessing; preserve program identity checks and Codex's ability to start when the HUD fails. New features should stay independent of model traffic.
