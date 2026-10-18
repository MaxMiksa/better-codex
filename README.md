<h1 align="center">Better Codex</h1>

<p align="center">
  <a href="https://github.com/MaxMiksa/better-codex/releases/tag/v0.1.0"><img alt="Version" src="https://img.shields.io/badge/version-v0.1.0-blue.svg?logo=github&amp;logoColor=white" /></a>
  <a href="#"><img alt="Windows" src="https://img.shields.io/badge/Platform-Windows-blue.svg?logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cGF0aCBkPSJNNi4zMzcgMTguNjA1bDM1LjY4Ny00Ljg2LjAxNiAzNC40MjItMzUuNjcuMjAzem0zNS42NyAzMy41MjlsLjAyOCAzNC40NTMtMzUuNjctNC45MDUtLjAwMi0yOS43OHptNC4zMjctMzkuMDI1bDQ3LjMxOC02LjkwNlY0Ny43M2wtNDcuMzE4LjM3NXptNDcuMzI5IDM5LjM0OWwtLjAxMiA0MS4zNC00Ny4zMTgtNi42NzktLjA2Ni0zNC43Mzl6IiBmaWxsPSIjZmZmIi8+PC9zdmc+&amp;logoColor=white" /></a>
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/License-MIT-green.svg?logo=opensourceinitiative&amp;logoColor=white" /></a>
  &nbsp;&nbsp;
  <a href="README-zh.md"><img alt="[中文说明]" src="https://img.shields.io/badge/%5B%E4%B8%AD%E6%96%87%E8%AF%B4%E6%98%8E%5D-2f3640.svg" /></a>
</p>

✅ **Local processing · Open source · Reversible UI enhancements**  
✅ **Inline statistics · Adjustable reading width · Compact file changes**  
✅ **Windows 11 · Official Codex desktop app**  

A collection of small enhancements that make Codex more comfortable to use. The first release puts useful statistics by the input box and gives you more control over reading space. Independent community project; not affiliated with OpenAI.

## 🎬 Preview

<p align="center"><img src="Presentation/overview.png" alt="Inline statistics, reading-width control and collapsed file changes" width="800" /></p>

*Actual enhancement modules on an illustrative page with synthetic data. No private conversation is shown.*

## ✨ Features

| Feature | What you get |
| --- | --- |
| Inline statistics | See the latest response's output speed, input cache percentage and sample age by the input box. |
| Reading width | Click the statistics to adjust conversation width up to 1600px. Your choice is saved; the input box keeps its width. |
| Compact file changes | Multi-file lists start collapsed. Expand the full list when needed; review and undo remain accessible. |
| Familiar launch | Start Codex and the enhancements together with a shortcut. Login startup is optional. |
| Easy to stop | Restore the native layout while Codex keeps running. |

Speed is the **average of the latest completed response**, calculated from local recorded usage and timing. It is not a live per-token speed meter. Missing measurements stay missing.

## 🚀 Get started

You need **Windows 11, the official Codex Store app, Python 3.11+ and Node.js 20+**. Setup downloads dependencies; this is a source package, not a standalone EXE.

1. Download `better-codex-v0.1.0-windows-x64.zip` from [Releases](https://github.com/MaxMiksa/better-codex/releases/tag/v0.1.0) and extract it to a writable folder you plan to keep.
2. Open PowerShell in that folder and run:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1
   ```

3. Double-click `Start.cmd` or `launchers/Codex.lnk`. Click the statistics to adjust reading width; use `Stop.cmd` to stop the enhancements.

If the existing Codex window has no local display interface, save your work and **exit Codex normally when convenient**, then use the new shortcut. Better Codex never forces the app to restart.

## 📚 More Info

<details>
<summary><b>📋 Requirements and limits</b></summary>

Tested on Windows 11 x64 with Codex desktop package `26.1013.4894.0`. Other app versions, multiple windows and every display scale are not fully verified. A Codex update may require adaptation.

Statistics need readable local Codex session records; cloud-only chats are not measured. Chat mode can share reading width but receives no Codex statistics. UI control labels currently use Simplified Chinese; documentation is bilingual.

This release has no model-quality/downgrade detector, plugin marketplace or automatic updater. It does not promise faster model generation. Keep its local display port on loopback; do not expose or forward it.

</details>

<details>
<summary><b>🧭 Shortcuts, login startup and removal</b></summary>

To pin the combined launcher, use `launchers/Codex.lnk`. If the original Codex icon is already pinned, unpin it before pinning the combined launcher. Shortcuts belonging to other targets are left untouched.

Login startup is off on first installation. Enable it with:

```powershell
.\tools\token-hud-local\Set-LoginStartup.ps1 -Mode Enable
```

If enabled, turn off official Codex login startup in its own settings so the app uses one entry. Remove this project's login entry with `-Mode Disable`. To uninstall, disable that entry if enabled, run `Stop.cmd`, unpin its shortcut, then delete the extracted folder. Codex and its chat history are preserved.

</details>

<details>
<summary><b>🔎 Comparison with three similar projects</b></summary>

| Project | Main focus | Best fit |
| --- | --- | --- |
| **Better Codex** | Windows in-app statistics plus reading-width and file-list improvements | A compact set of enhancements inside the conversation interface |
| [codex-token-hud](https://github.com/drkang7/codex-token-hud) | Local response-speed/cache statistics, floating HUDs, history and range views | Richer standalone statistics; our collector derives from this project |
| [codex-lite-hud](https://github.com/flitfancy/codex-lite-hud) | Lightweight native Windows strip with usage, context, timing and quota | A standalone HUD without Node.js or Python runtime prerequisites |
| [codex-speed-hud](https://github.com/Creative-developer-single/codex-speed-hud) | In-app stream-speed estimates, latency and cost views | Live output estimates; documented desktop validation is currently Linux |

Based on the projects' own documentation checked on 2026-10-18. Speed definitions differ, so their readings are not one performance benchmark. This compares documented scope, not every release's tested behavior.

</details>

<details>
<summary><b>🔐 Local data and privacy</b></summary>

Model requests continue through Codex's existing connection. Better Codex reads local usage records and adjusts the local interface. It adds no model proxy and requires no extra API key. Setup contacts Python/npm registries to download dependencies.

Local state can include conversation identifiers, titles, file paths and usage metadata. Do not upload `.runtime/` or raw Codex logs with an issue. See [Privacy](docs/PRIVACY.md).

</details>

<details>
<summary><b>🛠️ Troubleshooting and known issues</b></summary>

Run `tools/token-hud-local/Start-ComposerHud.ps1 -CheckOnly` if the HUD is absent. `restart-required` means a normal exit and launch through the combined shortcut is needed. `hud-preparation-failed` usually means a missing dependency; stop this HUD before rerunning setup. Pass `-PythonExecutable` or `-NodeExecutable` to `Install.ps1` when a runtime is not on PATH.

A dash means timing or usage is unavailable, not zero speed. New turns, uncertain chat identity, stale measurements or incompatible page structure may hide the HUD. `Stop.cmd` restores the native layout.

</details>

<details>
<summary><b>💻 Developer guide</b></summary>

The runtime uses Python and Node.js; production attachment needs no browser download. See [Development](docs/DEVELOPMENT.md) for module boundaries, isolated checks and packaging. Runtime files, private research and local configuration are excluded from the public package.

</details>

## 🙏 Acknowledgements

Thank you to [codex-token-hud](https://github.com/drkang7/codex-token-hud) for the reused local collector, and to [codex-lite-hud](https://github.com/flitfancy/codex-lite-hud), [codex-speed-hud](https://github.com/Creative-developer-single/codex-speed-hud) and [openai/codex](https://github.com/openai/codex) for their work. See [Third-party notices](THIRD_PARTY_NOTICES.md) for reuse scope, source versions and licenses.

## 🤝 Contribution & Contact

Welcome to submit Issues and Pull Requests!
Any questions or suggestions? Please contact Zheyuan (Max) Kong (Carnegie Mellon University, Pittsburgh, PA).

Zheyuan (Max) Kong: kongzheyuan@outlook.com | zheyuank@andrew.cmu.edu
