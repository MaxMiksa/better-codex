<h1 align="center">Better-Codex</h1>

<p align="center">
  <a href="https://github.com/MaxMiksa/better-codex/releases/tag/v0.4.1"><img alt="Version" src="https://img.shields.io/badge/version-v0.4.1-blue.svg?logo=github&amp;logoColor=white" /></a>
  <a href="#"><img alt="Windows" src="https://img.shields.io/badge/Platform-Windows-blue.svg?logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cGF0aCBkPSJNNi4zMzcgMTguNjA1bDM1LjY4Ny00Ljg2LjAxNiAzNC40MjItMzUuNjcuMjAzem0zNS42NyAzMy41MjlsLjAyOCAzNC40NTMtMzUuNjctNC45MDUtLjAwMi0yOS43OHptNC4zMjctMzkuMDI1bDQ3LjMxOC02LjkwNlY0Ny43M2wtNDcuMzE4LjM3NXptNDcuMzI5IDM5LjM0OWwtLjAxMiA0MS4zNC00Ny4zMTgtNi42NzktLjA2Ni0zNC43Mzl6IiBmaWxsPSIjZmZmIi8+PC9zdmc+&amp;logoColor=white" /></a>
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/License-MIT-green.svg?logo=opensourceinitiative&amp;logoColor=white" /></a>
  &nbsp;&nbsp;
  <a href="README-zh.md"><img alt="[中文说明]" src="https://img.shields.io/badge/%5B%E4%B8%AD%E6%96%87%E8%AF%B4%E6%98%8E%5D-2f3640.svg" /></a>
</p>

Make Windows Codex conversations easier to read: see statistics by the input box, adjust reading width, and collapse multi-file changes. Independent community project; not affiliated with OpenAI.

**Windows 11 x64 · Official Codex Store app · English / 简体中文 · Bundled portable runtimes**

<p align="center"><img src="Presentation/overview.png" alt="Better-Codex: inline statistics, reading-width control and collapsed file changes" width="900" /></p>

## Get started

1. Download `better-codex-v0.4.1-windows-x64-portable.zip` from [v0.4.1 Releases](https://github.com/MaxMiksa/better-codex/releases/tag/v0.4.1).
2. **Extract the entire ZIP** to a writable folder you plan to keep.
3. Run `BetterCodex.exe`. Click the statistics beneath the input box to adjust reading width. No Python/Node.js installation or first-launch dependency download is needed.

The combined entry opens a startup check asynchronously. When missing enhancements or a completed Codex update are confirmed, a **15-second relaunch countdown** starts after all checks finish. Click to act immediately; **X / Esc cancels**. Recovery requests normal exit, never forces termination, and does not loop after failure. Cancel while you have work to preserve, then relaunch when convenient.

Run `Stop.cmd` at any time to stop enhancements and restore the native layout. Codex and chat history remain available. Use the combined entry again to restore enhancements.

## Features

| Task | What you get |
| --- | --- |
| Read statistics | Average output speed, input cache percentage and sample age for the latest completed response; each window binds to its own main chat |
| Adjust reading space | Click the statistics to set a width limit up to 1600px; main chats, side chats and subagents stay within their panels, and the input box keeps its width |
| Browse file changes | Multi-file lists start collapsed and can expand together; review/undo remain available, and a manually expanded card keeps its state |
| Use Custom colors | Readable user-message bubbles and send buttons with a custom accent; native presets remain intact |
| Start and maintain | Combined shortcut, separate login-start switch, startup checks and sanitized reports; optional monitoring restores the enhancement entry after Codex updates |

Statistics follow the main input area's layout. Labels follow Codex's English/Simplified Chinese interface, falling back to the launch language when none is declared; other languages fall back to English. Chat mode keeps reading width without these statistics. Documents and blank pages keep their native layout.

If a collector exits, only statistics become unavailable; reading width, file changes and appearance remain in place. Recovery is local and rate-limited, and data from an old collector is rejected.

## Common settings

Run these commands from the initialized extracted folder. Login startup, Codex update monitoring and administrator launch are off by default.

| Task | PowerShell command |
| --- | --- |
| Enable login startup | `.\tools\token-hud-local\Set-LoginStartup.ps1 -Mode Enable` |
| Enable Codex update monitoring | `.\tools\token-hud-local\Set-UpdateRecovery.ps1 -Mode Enable` |
| Read either switch | Use `-Mode Status` with its script |
| Disable either switch | Use `-Mode Disable` with its script |
| Read-only launch check | `.\tools\token-hud-local\Start-ComposerHud.ps1 -CheckOnly` |

Keep a single login entry: turn off Codex's own login startup when enabling this project's entry. Update monitoring needs the enhancement host to keep running. A confirmed new version opens the same check before an optional relaunch; disabling monitoring does not cancel a countdown already open. It does not update Better-Codex itself. Recovery after a real future Codex upgrade still awaits natural-use acceptance.

Use `launchers/Codex.lnk` for taskbar pinning. Unpin the original Codex entry first, then pin the combined shortcut. Windows may require repinning after caching a path or app identity.

<details>
<summary>Optional administrator launch</summary>

Run `.\tools\token-hud-local\Set-AdministratorLaunch.ps1 -Mode Enable`. The first setup requests UAC; later launches reuse the verified current-user task. `-Mode Disable` removes that entry without stopping Codex.

This experimental mode is off by default and applies to a fresh start; it cannot elevate an existing instance. Native Codex notification clicks may fail to return to their chat in administrator mode. Use ordinary launch if you depend on that behavior.

</details>

<details>
<summary>Upgrade, move or uninstall</summary>

Before upgrading or moving, disable the old copy's administrator entry and any enabled login entry, then stop its enhancements with Stop.cmd. Extract the complete new package or move the whole folder, and run BetterCodex.exe from the new location. Path rebuilding preserves width preferences present in that folder. Repin if needed, then enable the switches you want. Shortcuts owned by another installation are not taken over.

To uninstall, disable login startup and administrator launch, run Stop.cmd, unpin the shortcut, and delete the extracted folder. Codex and chat history remain.

</details>

## Problems and limits

| Symptom | Action |
| --- | --- |
| Statistics are absent | Start with the read-only check. For the full check, run `tools/token-hud-local/Show-StartupCheck.ps1`; cancel its relaunch countdown while working |
| `restart-required` | The running instance lacks the display interface or required launch conditions. Exit normally when convenient, then use the combined entry |
| `hud-preparation-failed` | Check for missing files. Stop this copy's enhancements and extract the complete ZIP to a new folder; do not run inside the ZIP |
| A dash or temporarily hidden statistics | Usage/timing is unavailable, chat identity is uncertain, data is stale, or the layout is incompatible; this is not zero speed, and another chat's data is never substituted |

Speed is the **completed response average** from a known request boundary to the usage record, including waiting/reasoning and excluding known tool execution. Output usage includes reasoning and tool-call tokens. It is not a live per-token rate or a pure model decoding benchmark, and does not promise faster generation. Cloud-only chats cannot supply local statistics.

Checks send no model message, do not verify model authentication, and do not control VPN software. Uncertain sandbox or proxy conditions stay unconfirmed. Clicking an already-running taskbar group may only activate the app without reopening checks.

Codex UI updates may need adaptation. All app versions, window layouts and display scales have not been fully validated. The launcher is unsigned, so Windows may show a publisher prompt.

## Privacy

Model requests keep Codex's existing connection. Better-Codex adds no model proxy and needs no extra API key. Portable packaging does not make model requests offline. Startup checks make a small credential-free HTTPS request through the detected network path.

Local state can contain chat identifiers, titles, paths and usage. **Do not upload .runtime/, authentication files or raw Codex logs.** Report the version, symptom and sanitized startup report instead. Do not expose or forward the local display interface to the internet. See [Privacy](docs/PRIVACY.md).

## Development and credits

A separate `better-codex-v0.4.1-source.zip` is available. Source installation needs Python 3.11+ and Node.js 20+; run `powershell -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1`. Optional `-Language en` / `-Language zh-CN` selects setup messages. Use the [development guide](docs/DEVELOPMENT.md) bundled with your chosen source version to avoid mixing paths between versions.

The local collector is reused from [codex-token-hud](https://github.com/drkang7/codex-token-hud). Thank you to [codex-lite-hud](https://github.com/flitfancy/codex-lite-hud), [codex-speed-hud](https://github.com/Creative-developer-single/codex-speed-hud), and [openai/codex](https://github.com/openai/codex). See [Third-party notices](THIRD_PARTY_NOTICES.md) for reuse scope, versions and licenses.

Issues and Pull Requests are welcome. Contact Zheyuan (Max) Kong: kongzheyuan@outlook.com · zheyuank@andrew.cmu.edu.
