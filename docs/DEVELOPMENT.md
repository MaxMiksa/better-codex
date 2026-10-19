# Development

The source package keeps the existing module boundaries:

| Location | Responsibility |
| --- | --- |
| `tools/token-hud-local/collector/` | MIT-derived local event measurements and session discovery |
| `tools/token-hud-local/shared/` | Official app activation, Store package discovery and listener identity checks |
| `tools/token-hud-local/embedded/` | Controller, chat binding, statistics display, reading width and file-list presentation |
| `Install.ps1` | Source setup, or offline preparation when bundled runtimes are present |
| `PortableLauncher.cs` / `portable_bootstrap.py` | Double-click entry, bundled dependency checks, relocatable settings and launch |
| `scripts/build-portable.py` | Verified upstream runtimes, Windows launcher build and offline ZIP |
| `scripts/package.py` | Explicit public-file allowlist, ZIP and SHA-256 generation |

Run setup with Python 3.11+, Node.js 20+ and the official Windows Store app installed. Production attaches to the app; it does not launch a separate browser or download browser binaries. `Install.ps1 -CheckOnly` checks prerequisites without writing files. For an existing development environment, `-SkipDependencies -PlaywrightPath <absolute module path>` uses the supplied Python and Playwright instead of installing private dependencies.

## Isolated checks

Run from the repository root. The browser checks use installed Edge and synthetic pages, not your real conversation. `HUD_PLAYWRIGHT` and `HUD_BROWSER` can override their module/browser paths.

```powershell
.\tools\token-hud-local\Verify-Launcher.ps1
python -B -X utf8 tools/token-hud-local/embedded/verify_supervisor.py .validation-runtime/lock-check
python -B -X utf8 tools/token-hud-local/shared/verify-i18n.py .validation-runtime/i18n/shared
python -B -X utf8 tools/token-hud-local/verify-workspace-relocation.py .validation-runtime/workspace-rename-check
node tools/token-hud-local/embedded/verify.cjs .validation-runtime/view/evidence .validation-runtime/view/browser
node tools/token-hud-local/embedded/verify-reading-width.cjs .validation-runtime/width/browser
node tools/token-hud-local/embedded/verify-file-changes.cjs .validation-runtime/files/browser
node tools/token-hud-local/embedded/verify-custom-accent.cjs .validation-runtime/accent/browser
python scripts/package.py
```

Use the Python interpreter prepared by setup if `psutil` or `pywin32` is unavailable in your default interpreter. Clean only your newly created validation directories after checking their absolute paths. Do not delete a running HUD's `.runtime/`.

The version in root `VERSION` and `package.json` is the Better-Codex product version. `collector/VERSION` records the independent upstream collector version and intentionally differs. Upstream source is pinned in `THIRD_PARTY_NOTICES.md`.

Page structure and the local display interface are not a stable extension API. Keep unknown layouts hidden rather than guessing; preserve program identity checks and Codex's ability to start when the HUD fails. New features should stay independent of model traffic.

The controller recognizes routed main pages and isolates page collectors, bindings and output directories. Cross-runtime settings patches serialize writes and retain the last valid preferences on read errors. Reading-width targets are selected independently per visible transcript, excluding composer containers. The HUD prefers the native main composer and its marked editor, ignores question-card editors, and follows main-panel geometry through resize and layout observations. Custom-accent handling is an independent, removable module; disabling it must leave statistics, width and file changes active.

All owned UI, installer and launcher messages live in `shared/messages.json`. Node and injected page modules use `embedded/i18n.js`; inject its `pageSource()` before the composer and file-list modules. Setup and launch messages default to Windows display language, passed through `BETTER_CODEX_LANGUAGE` to the supervisor and controller. Inside the app, `document.documentElement.lang` takes precedence; the injected launch language is used only when the page declares no language. Browser language does not override this fallback. Page language changes update controls without resetting width or expansion state. Simplified Chinese variants use Chinese and other languages fall back to English. The composer snapshot passes the resolved page locale to the metrics formatter; native Codex labels remain owned by Codex.

PowerShell, Python and the native launcher default to Windows UI language; `auto` uses this default. `BETTER_CODEX_LANGUAGE` can explicitly override it for a process, and `Install.ps1 -Language en` or `-Language zh-CN` selects setup messages without changing Codex configuration or persistent system preferences. JSON status codes remain stable; localized `message` and `locale` fields are additive. Windows owns native dialog button labels; third-party tools own their installation output. The cross-runtime check compiles the launcher, checks language selection including conflicting Codex preferences, and exercises the installer only with `-CheckOnly`; it does not show dialogs, activate Codex or install dependencies.

## Portable build

On Windows x64 with Python 3.11+ and the Windows .NET Framework compiler:

```powershell
python -B scripts/package.py
python -B scripts/build-portable.py
```

The builder downloads archives from scripts/portable-lock.json and verifies their pinned SHA-256 or npm SHA-512 integrity before assembly. It includes CPython's embeddable runtime, architecture-matching wheels, Node.exe, Playwright and their license files; pip, npm and extra browsers are not needed on the user's machine. Source and portable ZIPs plus SHA256SUMS.txt are written to dist/. Build staging remains under .validation-runtime/.

Use BetterCodex.exe for normal portable startup. `--check` verifies bundled dependencies and the installed Codex app without creating settings; `--prepare-only` creates local settings/shortcuts without activating Codex; `--stop` requests this copy's normal stop. Repeated launcher calls are serialized. A stopped folder can be moved; settings are regenerated from its current path, while width preferences are preserved. External shortcuts from another installation are not adopted. Stop the old copy before an upgrade or move.

Do not describe a restricted-PATH test as a clean Windows installation test. Portable acceptance should check bundled module paths, no external downloads, full startup/stop, repeat reuse, Unicode/space paths and relocation. Do not stop or restart the user's Codex for packaging tests.

## Prepared source-folder rename

For a source installation, run `tools/token-hud-local/Repair-WorkspacePaths.ps1 -Mode Prepare` before manually renaming its folder to `Better-Codex` in the same parent directory. Preparation saves a local plan without changing the running launchers. After the user renames the folder, run `Finish-Rename.cmd` from the new root before using the existing shortcuts. `-Mode Check` is read-only.

The migration rebases project dependency paths, rebuilds owned wrappers and updates existing shortcuts while preserving preferences and the login-startup choice. It creates an old-path directory junction to preserve running HUD paths and Explorer's cached entry. Keep that junction until its consumers have been checked separately; it contains no duplicate project data. Migration never activates or restarts Codex or stops the HUD. Original entry files and settings are saved locally before applying; a failed apply attempts to restore owned entries and dependency fields without reverting concurrent display preferences. Foreign shortcuts, changed wrappers and an occupied old path are refused. The isolated check uses real Windows links and junctions in synthetic folders; it does not establish real post-rename or next-login acceptance. Its icon fixture requires an already prepared local installation.

After the Codex project association uses the new root and the entry files have been checked, `Repair-WorkspacePaths.ps1 -Mode Finalize` verifies current-user process paths and removes only the verified old junction with non-recursive `os.rmdir`. An old-path user or inaccessible relevant tool process prevents removal. The plan then stays `finalized`: Check, Apply and repeated Finalize accept the absent alias and never recreate it. Finalize refuses a foreign directory or a different reparse point and does not stop any live processes. The isolated check covers the in-use guard, target preservation, repeat calls and foreign-path rejection.
