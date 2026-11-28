# Development

This guide describes the v1.0 architecture and development workflow of Better-Codex. Upgrading from v0.5.x? See [UPGRADE-v1.md](UPGRADE-v1.md).

## Architecture Overview

Better-Codex runs on a single script runtime (**Node.js 24**) plus a thin Windows native helper (**C# compiled with the built-in Windows .NET compiler — zero external SDK or Python required**).

| Location | Responsibility |
| --- | --- |
| `src/app/` | Combined startup orchestration, portable bootstrap, and single Node supervisor |
| `src/runtime/` | Native WebSocket CDP host, per-window scheduler, and feature plugin registry |
| `src/features/` | 8 self-contained Feature-First UI enhancements (`ui/` TypeScript + CSS, optional `host/`) |
| `src/generated/` | Prebuilt browser UI bundles (`ui/*.js`) and `native/BetterCodexNative.exe` |
| `src/lifecycle/` | Official Codex activation, startup diagnostics, update detection, installation, and graceful recovery |
| `src/platform/` | Paths, process/package identity, cross-runtime settings store, i18n, and 5-day `node:sqlite` runtime history |
| `src/native/` | Thin Windows C# helper (`BetterCodexNative.exe`) for Restart Manager, Shell shortcuts, Explorer actions, and process/port inspection |
| `tests/`, `scripts/` | Pure Node.js + PowerShell isolated checks, build scripts, and packaging |

Dependencies flow strictly downward: `app → runtime / features / lifecycle → platform`. Features never cross-import each other; `platform` never imports upper layers.

## Set Up a Source Copy

Requirements: **Windows 11 x64**, official **Codex Store app**, **Node.js 24.11.1+ (24.x line)**, and **pnpm 12.16.1** (dev builds/tests only; production runtime has zero npm dependencies).

```powershell
# Prepare local settings and taskbar/launcher shortcuts
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1

# Install dev tooling (TypeScript, esbuild, workspace-tree builder)
pnpm install
```

Optional browser test dependency (Playwright + local installed Edge; no browser download needed):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-NodeDependencies.ps1 -PnpmExecutable (Get-Command pnpm).Source
```

## Build & Verify

```powershell
# Typecheck TypeScript UI sources
pnpm run typecheck

# Build all 8 UI feature bundles + BetterCodexNative.exe
pnpm run build

# List or run isolated verification suites
node scripts/check.mjs --list
node scripts/check.mjs structure --work .validation-runtime/structure
node scripts/check.mjs composer --work .validation-runtime/composer --dependencies .runtime/settings.json
node scripts/check.mjs --all --work .validation-runtime/all --dependencies .runtime/settings.json
```

All registered checks run in isolated temporary directories inside `.validation-runtime/` with mocks or synthetic Edge pages. They never send real model messages or restart an active Codex instance.

### Rebuild Workspace Tree Renderer & Parsers

```powershell
pnpm run build:workspace-tree
node scripts/check.mjs workspace-tree --work .validation-runtime/workspace-tree --dependencies .runtime/settings.json
```

## Package & Release Preparation

Packaging discovers public runtime and source files automatically (see [release/README.md](../release/README.md)). `package.json` `"version"` is the single source of truth.

```powershell
# Sync README badges/links, typecheck, build, package source + portable ZIPs, and verify both
pnpm run release:prepare
```

Or run steps individually:

```powershell
pnpm run sync:version
pnpm run package
node scripts/build-portable.mjs --work .validation-runtime/portable-build
node scripts/verify-package.mjs --source dist/better-codex-v1.0.0-source.zip --portable dist/better-codex-v1.0.0-windows-x64-portable.zip --work .validation-runtime/package-check
```

## Runtime Safety & Persistence Contracts

- **Never terminate or restart live Codex during development**; frontend edits hot-reload by restarting only Better-Codex's own controller/supervisor.
- **Flat settings & auto-migration**: `.runtime/settings.json` preserves unknown fields and uses cross-process locking. Legacy `.runtime/token-hud/embedded/settings.json` migrates automatically on first v1.0 run while leaving the old folder intact as backup.
- **Optional external diagnostics hook**: Startup diagnostics remains 100% open-source; local extensions (such as private prompt tools) may optionally attach via a read-only `promptDiagnosticsCommand` entry in `.runtime/settings.json`.
- **Privacy**: Model traffic stays on Codex's native connection. Never commit `.runtime/`, `.validation-runtime/`, raw logs, or credentials.
