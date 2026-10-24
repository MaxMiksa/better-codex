<h1 align="center">Better-Codex</h1>

<p align="center">
  <a href="https://github.com/MaxMiksa/better-codex/releases/tag/v0.4.0"><img alt="Version" src="https://img.shields.io/badge/version-v0.4.0-blue.svg?logo=github&amp;logoColor=white" /></a>
  <a href="#"><img alt="Windows" src="https://img.shields.io/badge/Platform-Windows-blue.svg?logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cGF0aCBkPSJNNi4zMzcgMTguNjA1bDM1LjY4Ny00Ljg2LjAxNiAzNC40MjItMzUuNjcuMjAzem0zNS42NyAzMy41MjlsLjAyOCAzNC40NTMtMzUuNjctNC45MDUtLjAwMi0yOS43OHptNC4zMjctMzkuMDI1bDQ3LjMxOC02LjkwNlY0Ny43M2wtNDcuMzE4LjM3NXptNDcuMzI5IDM5LjM0OWwtLjAxMiA0MS4zNC00Ny4zMTgtNi42NzktLjA2Ni0zNC43Mzl6IiBmaWxsPSIjZmZmIi8+PC9zdmc+&amp;logoColor=white" /></a>
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/License-MIT-green.svg?logo=opensourceinitiative&amp;logoColor=white" /></a>
  &nbsp;&nbsp;
  <a href="README-zh.md"><img alt="[中文说明]" src="https://img.shields.io/badge/%5B%E4%B8%AD%E6%96%87%E8%AF%B4%E6%98%8E%5D-2f3640.svg" /></a>
</p>

✅ **No Python/Node.js installation · English / 简体中文 · Local processing**  
✅ **Inline statistics · Adjustable reading width · Compact file changes**  
✅ **Windows 11 · Official Codex desktop app**  

A collection of small enhancements that make Codex more comfortable to use. It puts useful statistics by the input box and gives you more control over reading space. Independent community project; not affiliated with OpenAI.

<p align="center"><img src="Presentation/overview.png" alt="Better-Codex: inline statistics, reading-width control and collapsed file changes" width="900" /></p>

<p align="center"><em>Inline statistics, reading-width control and collapsed file changes.</em></p>

## ✨ Features

| Feature | What you get |
| --- | --- |
| Inline statistics | Muted gray text shows the latest response's output speed, input cache percentage and sample age by the input box. |
| Reading width | Click the statistics to adjust conversation width up to 1600px. Main chats, side chats and subagents keep the saved limit within their own panels; the input box keeps its width. |
| Stable HUD placement | Statistics stay with the main chat while switching panels, documents and subagents, and follow the input area's layout changes. |
| Multiple windows | Each Codex window binds its own chat statistics; display settings are shared safely. |
| Custom accent | Correct user-message and send-button colors when Codex uses a Custom accent, with readable foreground colors. |
| Compact file changes | Multi-file lists start collapsed. Expand the full list when needed; review and undo remain accessible. |
| English and Simplified Chinese | Interface labels, setup and launch messages select the language automatically. |
| Familiar launch | Start Codex and the enhancements together with a shortcut. Login startup is optional. |
| Startup check | Check app startup, local history, sandbox conditions, network transport, permissions and enhancements; copy a redacted report. |
| Recovery | Confirmed enhancement-loading failures offer a cancellable 15-second relaunch. Optional background monitoring opens the same check after a Codex update. |
| Easy to stop | Restore the native layout while Codex keeps running. |

Speed is the **average of the latest completed response**, calculated from a known request boundary to the usage record. It includes waiting and reasoning and excludes known tool execution. Uncertain boundaries or restored cumulative usage show a dash. It is not a live per-token speed meter or a pure model decoding benchmark. Output usage includes reasoning and tool-call tokens. Missing measurements stay missing.

The width popup uses the same font size as the statistics and follows the native input controls. Chat mode shares the reading-width setting without displaying this HUD. A narrow panel can display less than the selected width; document and blank tabs keep their native layout.

## 🚀 Get started

You need **Windows 11 x64 and the official Codex Store app**. The portable ZIP includes its own Python, Node.js and dependencies. No system runtime installation or first-run dependency download is needed.

1. Download **`better-codex-v0.4.0-windows-x64-portable.zip`** from [Releases](https://github.com/MaxMiksa/better-codex/releases/tag/v0.4.0).
2. Extract the **entire ZIP** to a writable folder you plan to keep.
3. Double-click **`BetterCodex.exe`**. Click the statistics to adjust reading width; use `Stop.cmd` to stop the enhancements.

The combined entry opens a startup check asynchronously. If it confirms that enhancements did not load, the launch button starts a **15-second countdown after checks finish**. Click it to relaunch immediately, or close the check with X / Esc to cancel. Relaunch requests a normal exit, then uses the complete enhancement entry; it never forces termination or loops after failure. Save ongoing work and cancel the countdown when you need to keep the current session running.

## 📚 More Info

<details>
<summary><b>📋 Requirements and limits</b></summary>

Interface checks began on Codex desktop package `26.1013.4894.0`, with later targeted checks through `26.1016.8622.0`. This release also has isolated package checks. These do not establish complete compatibility with every app version, window layout or display scale. A Codex update may require adaptation. The launcher is unsigned; Windows may show an unfamiliar-publisher notice.

Statistics need readable local Codex session records; cloud-only chats are not measured. Chat mode can share reading width but receives no Codex statistics.

Setup and launch messages default to the Windows display language. Once inside Codex, HUD labels, relative times, reading-width controls and file-list buttons follow Codex's interface language, including language changes. If Codex does not declare a language, they use the computer language selected at launch. English and Simplified Chinese are supported; other languages use English. Native Codex buttons and third-party setup tools keep their own language.

Better-Codex itself is updated manually. Optional Codex-update recovery restores the enhancement launch path; it does not install updates. This release has no model-quality/downgrade detector or plugin marketplace. It does not promise faster model generation. Keep its local display port on loopback; do not expose or forward it.

</details>

<details>
<summary><b>🧭 Shortcuts, login startup and removal</b></summary>

To pin the combined launcher, use `launchers/Codex.lnk`. If the original Codex icon is already pinned, unpin it before pinning the combined launcher. Shortcuts belonging to other targets are left untouched. To upgrade or move the folder, disable any optional administrator entry in the old copy, then stop that copy first. If its login startup is enabled, disable that old entry before switching folders and enable the new one afterwards if wanted. Then open BetterCodex.exe in the new location. The launcher regenerates local paths and preserves saved width preferences when the whole folder is moved. Windows may retain an old pinned path; repin the new shortcut if necessary.

Login startup is off on first installation. Enable it with:

```powershell
.\tools\token-hud-local\Set-LoginStartup.ps1 -Mode Enable
```

If enabled, turn off official Codex login startup in its own settings so the app uses one entry. Remove this project's login entry with `-Mode Disable`. To uninstall, disable login startup and the optional administrator entry if enabled, run `Stop.cmd`, unpin its shortcut, then delete the extracted folder. Codex and its chat history are preserved.

</details>

<details>
<summary><b>🩺 Startup checks and optional recovery</b></summary>

Open the check independently with `tools/token-hud-local/Show-StartupCheck.ps1`. It checks local startup/history, sandbox conditions, network transport, enhancement loading and actual permissions, and provides a redacted copyable report. It sends no model test message, does not verify model authentication and does not change Codex or VPN configuration. Unsupported sandbox or proxy conditions remain unconfirmed.

Background monitoring for future Codex updates is **off by default**. After preparing this installation, enable it with:

```powershell
.\tools\token-hud-local\Set-UpdateRecovery.ps1 -Mode Enable
```

Use `-Mode Status` or `-Mode Disable` to inspect or stop monitoring. It depends on the enhancement supervisor remaining active. After a confirmed update, the same check opens and starts a cancellable 15-second relaunch countdown when detection finishes, even if enhancements appear connected. A cancelled version is not repeatedly reopened. Real future-update recovery still needs natural-use validation. Clicking a running taskbar group may only activate the app and may not open another check.

Administrator startup is an **optional experimental setting**, off by default. Use `Set-AdministratorLaunch.ps1 -Mode Enable` in the same tools folder; initial setup requests UAC once, then uses a verified current-user task. `-Mode Disable` removes that entry without stopping Codex. It takes effect on a fresh launch and does not elevate an existing instance. Native Codex notification clicks may fail to return to the chat in this mode; use ordinary startup if this matters. After changing taskbar identity, Windows may require repinning `launchers/Codex.lnk` through its native menu.

</details>

<details>
<summary><b>🔎 Comparison with three similar projects</b></summary>

| Project | Main focus | Best fit |
| --- | --- | --- |
| **Better-Codex** | Windows in-app statistics plus reading-width and file-list improvements | A compact set of enhancements inside the conversation interface |
| [codex-token-hud](https://github.com/drkang7/codex-token-hud) | Local response-speed/cache statistics, floating HUDs, history and range views | Richer standalone statistics; our collector derives from this project |
| [codex-lite-hud](https://github.com/flitfancy/codex-lite-hud) | Lightweight native Windows strip with usage, context, timing and quota | A small native .NET HUD without bundled Node.js or Python |
| [codex-speed-hud](https://github.com/Creative-developer-single/codex-speed-hud) | In-app stream-speed estimates, latency and cost views | Live output estimates; documented desktop validation is currently Linux |

Based on the projects' own documentation checked on 2026-10-18. Speed definitions differ, so their readings are not one performance benchmark. This compares documented scope, not every release's tested behavior.

</details>

<details>
<summary><b>🔐 Local data and privacy</b></summary>

Model requests continue through Codex's existing connection. Better-Codex reads local usage records and adjusts the local interface. It adds no model proxy and requires no extra API key. The portable launcher downloads no dependencies. Codex model requests still need their usual network connection; offline packaging does not make the model itself offline. The optional source installer contacts Python/npm registries. Startup checks also make a small credential-free HTTPS request through the detected network path to check transport reachability.

Local state can include conversation identifiers, titles, file paths and usage metadata. Do not upload `.runtime/` or raw Codex logs with an issue. See [Privacy](docs/PRIVACY.md).

</details>

<details>
<summary><b>🛠️ Troubleshooting and known issues</b></summary>

Use the startup check and its Copy report button if the HUD is absent. For a read-only command check, run `tools/token-hud-local/Start-ComposerHud.ps1 -CheckOnly`. `restart-required` means a normal exit and launch through the combined shortcut is needed. `hud-preparation-failed` usually means missing or damaged files; stop this HUD and extract a complete portable ZIP to a new folder. Do not run from inside the ZIP. Only source installation needs the `Install.ps1` Python/Node options.

A dash means timing or usage is unavailable, not zero speed. New turns, uncertain chat identity, stale measurements or incompatible page structure may hide the HUD. `Stop.cmd` restores the native layout.

</details>

<details>
<summary><b>💻 Developer guide</b></summary>

A separate `better-codex-v0.4.0-source.zip` remains available. Source installation requires Python 3.11+ and Node.js 20+; run `powershell -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1` from its extracted folder. Add `-Language en` or `-Language zh-CN` to choose setup messages explicitly; the default is automatic. The portable build already includes its runtimes and needs no browser download. See [Development](docs/DEVELOPMENT.md) for module boundaries, isolated checks and packaging. Runtime files, private research and local configuration are excluded from the public package.

</details>

## 🙏 Acknowledgements

Thank you to [codex-token-hud](https://github.com/drkang7/codex-token-hud) for the reused local collector, and to [codex-lite-hud](https://github.com/flitfancy/codex-lite-hud), [codex-speed-hud](https://github.com/Creative-developer-single/codex-speed-hud) and [openai/codex](https://github.com/openai/codex) for their work. See [Third-party notices](THIRD_PARTY_NOTICES.md) for reuse scope, source versions and licenses.

## 🤝 Contribution & Contact

Welcome to submit Issues and Pull Requests!
Any questions or suggestions? Please contact Zheyuan (Max) Kong (Carnegie Mellon University, Pittsburgh, PA).

Zheyuan (Max) Kong: kongzheyuan@outlook.com | zheyuank@andrew.cmu.edu
