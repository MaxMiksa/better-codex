# Changelog

All notable changes to Better-Codex are summarized here. Full release downloads live on [GitHub Releases](https://github.com/MaxMiksa/better-codex/releases).

## [1.0.0] - 2026-11-28

### Architecture & Tech Stack Convergence
- **Single script runtime (Node.js 24) + thin Windows native C# helper**: Converged supervisor, per-window session statistics collector (with magpie integration), 5-day SQLite runtime history (`node:sqlite`), startup diagnostics, graceful recovery, and build/test tooling onto Node.js 24 + `BetterCodexNative.exe` (52.5 KB, zero external SDK).
- **Removed Python runtime dependency**: Eliminated embedded Python, `psutil`, `pywin32`, and per-window Python collector child processes. Portable ZIP shrank from ~55.6 MB to ~37.2 MB (-33%).
- **Feature-First modular layout & TypeScript + CSS frontend**: Reorganized all 8 UI enhancements into self-contained `src/features/<name>/` modules with strict TypeScript, separated CSS stylesheets, esbuild bundling, and per-feature fault isolation.
- **Clean public repository & automated packaging**: Separated local-only prompt management into its own private repo, archived legacy v0 evidence records off `main`, consolidated root `pnpm`, made `package.json` the single version source, and replaced manual `public-files.json` with directory-based packaging.

### Breaking Changes & Migration (see [UPGRADE-v1.md](docs/UPGRADE-v1.md))
- Retired all 48 legacy `tools/token-hud-local/` compatibility bridges in favor of direct `src/` entries and `package.json` scripts.
- Simplified local state layout to flat `.runtime/settings.json`, `.runtime/state/`, and `.runtime/launchers/`. Existing v0.5.x settings and recovery records migrate automatically and losslessly on first run.

### Improvements Included
- Improved collapsed composer text selection and first-key typing expand animation.
- Stabilized native file-page breadcrumb truncation at fixed widths.
- Reduced workspace preview decoding and staging overhead (EXIF orientation probe, larger images, extended formats, native PDF preview).

## [0.5.44] - 2026-11-28

- Added **Batch AI rename** in each sidebar project's `…` menu (processes active local and worktree chats without `：`, up to 3 concurrent requests, re-checks before saving).

## [0.5.42] - 2026-11-28

- Fixed main transcript left-edge clipping when the workspace tree and native right panel are open together.

## [0.5.41] - 2026-11-27

- Added native workspace file preview integration backed by the standalone [Preview](https://github.com/MaxMiksa/preview) companion project.

## [0.5.35 - 0.5.40] - 2026-11-27

- Switched production display attachment to native Node.js WebSocket (removed Playwright runtime dependency from startup, checks, recovery, and portable ZIPs).
- Added IME-ready first-key typing and cursor preservation for auto-hidden composer; added optional QuickLook preview fallback.
- Enabled concurrent AI rename across different chats with proper child-process cleanup.
- Fixed slash menu keyboard isolation, inactive-tab statistics filtering, table sort persistence across remounts, and file-change card expand state recovery.

## [0.5.0 - 0.5.34] - 2026-11-17 to 2026-11-26

- Added workspace file tree (Pierre Trees renderer, type grouping, resizable rail, native Explorer open/reveal, PowerToys Peek preview).
- Added AI rename (single-chat via sidebar or `/` menu using Luna with `type：description` format and native App Server save).
- Added slash command menu enhancements (grouped command buttons, Skills visibility toggles, three-column Skills/Prompt sections, `Ctrl+↑/↓` navigation, on-demand loading).
- Added centered chat titles, AI reply font size setting, auto-hide composer modes, and startup check auto-minimize/auto-retract when already running.

## [0.4.0 - 0.4.4] - 2026-10-20 to 2026-11-21

- Reorganized codebase into `src/` domains, added local SQLite runtime history, unified settings panel with undo/redo, sortable Markdown tables, and minimized startup check dialog with 15-second cancelable relaunch countdown.

## [0.2.0 - 0.3.2] - 2026-10

- Initial public Windows Codex enhancements: inline composer statistics HUD, adjustable reading width, collapsed file-change lists, Custom accent contrast correction, portable offline ZIP launcher, and Windows Restart Manager graceful relaunch.
