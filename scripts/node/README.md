# Source Node runtime

This is the reproducible dependency root for the source installer's dedicated `.runtime/token-hud/node` prefix. The product root remains a descriptor; it is not an ordinary pnpm workspace. Run `scripts/Install-NodeDependencies.ps1` from the product root, or let `Install.ps1` invoke it during a source installation. See the [development guide](../../docs/DEVELOPMENT.md) for arguments.

Playwright and playwright-core stay at 1.62.1, with the same integrity values as `scripts/portable-lock.json`. The lock also preserves Playwright's optional macOS fsevents dependency; it is skipped on Windows. The initial npm lock was generated in an isolated directory because this prefix design had no previous npm lock, then imported into pnpm without changing its resolved graph.

Use pnpm 12.16.1 and Node.js 24.11.1 or later in the 24.x line. The installer copies this manifest, lock and configuration into the selected prefix and performs a frozen install. Lifecycle scripts are disabled. The hoisted layout contains ordinary package directories, with global virtual store disabled. The portable builder continues to extract its independently verified archives and never copies the installed prefix or a pnpm store link.
