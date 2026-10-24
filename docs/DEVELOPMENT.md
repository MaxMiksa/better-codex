# Development

This guide describes the src/ layout of this source revision. Published v0.4.0 ZIPs retain their bundled layout; use the guide shipped with the source version you are editing.

## Find the owner

| Location | Responsibility |
| --- | --- |
| src/app/ | Combined launch, portable preparation and the single supervisor |
| src/interface/ | Per-window statistics, reading width, file changes and appearance |
| src/lifecycle/ | Activation, installation, diagnostics, update detection and recovery |
| src/platform/ | Identity, paths, Windows primitives, settings and localization |
| src/prompts/ and root prompts/ | Local-only prompt implementation and its content/approval owner |
| tools/token-hud-local/ | Stable command and import bridges for registered entries and live helpers |
| tests/, scripts/, release/ | Isolated checks, build commands and explicit shipping scope |

Dependencies point from app to capabilities to platform. Platform does not import a capability. Recovery reenters a stable command rather than importing app internals. Python internal modules use src package imports; external commands use the stable bridges.

Source copies include module READMEs and tests/README.md. Local maintenance copies also have PROJECT.md and AGENTS.md; public exports exclude those files and all private prompt content.

## Set up a source copy

Use Windows 11 x64, the official Codex Store app, Python 3.11+ and Node.js 20+. From the source root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1
```

Source installation may download Python/npm dependencies. Install.ps1 accepts -PythonExecutable, -NodeExecutable and -PlaywrightPath for existing tools, -Language en / zh-CN for messages, and -CheckOnly for dependency checks. Portable users already have their runtimes and do not need this source setup.

Browser checks use installed Edge and Playwright; no browser download is needed. Optional native preview checks also need Pillow in the development interpreter.

## Run the affected checks

```powershell
python -B -X utf8 scripts/check.py --list
python -B -X utf8 scripts/check.py metrics --work .validation-runtime/metrics
python -B -X utf8 scripts/check.py collector-session --work .validation-runtime/collector --dependencies .runtime/token-hud/embedded/settings.json
python -B -X utf8 scripts/check.py composer --work .validation-runtime/composer --dependencies .runtime/token-hud/embedded/settings.json
python -B -X utf8 scripts/check.py relaunch --work .validation-runtime/relaunch
```

The registry is tests/cases.json. The runner hides cases missing from a public source copy and only reads python/node/playwright from the dependency JSON. It does not alter that file. Work stays inside this copy's .validation-runtime/. Choose cases for the actual change; stop widening the scope once they pass without new concerns.

Registered checks use mocks, synthetic pages or explicit native previews. They do not send real model messages or restart the user's Codex/HUD. Real-model prompt scripts are local-only, outside the registry, and require separate authorization. Document-only changes need link, command and content checks, not GUI or runtime restarts.

## Build and inspect candidates

[release/public-files.json](../release/public-files.json) defines runtime and sourceExtras. Source packaging combines both; portable packaging adds pinned runtimes to runtime only. [scripts/portable-lock.json](../scripts/portable-lock.json) fixes dependency versions and integrity hashes. runtime/ is shipped content; .runtime/ is installation state.

Run candidate builds in an isolated source copy. The builders write version-named files in dist/ and can replace an existing candidate of the same name; preserve released artifacts in the main workspace.

```powershell
python -B -X utf8 scripts/package.py
python -B -X utf8 scripts/build-portable.py --work .validation-runtime/portable-build
python -B -X utf8 scripts/verify-package.py --source dist/better-codex-v0.4.1-source.zip --portable dist/better-codex-v0.4.1-windows-x64-portable.zip --work .validation-runtime/package-check
```

Use the version named by package.json/VERSION in the verification arguments. The verification work directory must not already exist. It checks actual ZIP file sets and bytes, runtime hashes, native --check / --prepare-only, restricted PATH, and relocation through a Unicode/space path with synthetic APPDATA/home. It never invokes launch or stop; it is not clean-machine or real-upgrade acceptance.

Neither package contains local state, private research or prompt customization. New files and documentation links must be classified against the actual exported set. Building a candidate does not publish it.

## Preserve installed contracts

Keep settings flat, preserve unknown fields, and use the existing cross-runtime lock. Installation paths, durable cancellation records, prompt owner/approvals and restoration chains retain their locations. Existing task parameters, wrapper validation and PID/creation-time checks are contracts; keep every bridge a live process or external registration can still call.

Collector failure must stay local to statistics and retain other page enhancements. Recovery policy belongs to lifecycle, identity mechanisms to platform. A normal-exit/relaunch operation that has already started must complete once even if its window or background host closes; generic cleanup must not terminate it.

For a layout migration, make canonical files available before replacing bridges. Source checks, actual backend loading and public release are separate facts. Keep dated sanitized evidence, recycle temporary fixtures after checking junction targets, and do not restart active Codex for development validation.
