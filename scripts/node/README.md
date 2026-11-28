# Browser-test dependencies

This workspace member provides Playwright for browser tests. From the repository root, run `pnpm install --frozen-lockfile` to install the workspace, or use `scripts/Install-NodeDependencies.ps1` for an isolated prefix. See the [development guide](../../docs/DEVELOPMENT.md) for arguments.

Use pnpm 12.16.1 and Node.js 24.11.1 or later in the 24.x line. The isolated installer uses the same root lockfile and workspace manifests and disables lifecycle scripts. The source installer and portable ZIP do not need these test modules at runtime.
