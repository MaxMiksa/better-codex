# Third-party notices and acknowledgements

Better-Codex is an independent community project and is not affiliated with OpenAI.

## Code reused

The standalone workspace tree bundles the [Pierre Trees](https://trees.software/docs) renderer and its dependencies. The bundle uses a distinct custom-element name so it can coexist with Codex's viewer. Its [versions, copyrights and licenses](src/features/workspace-tree/ui/TREE-RENDERER-LICENSES.txt) are included in both distributions.

Thank you to [drkang7/codex-token-hud](https://github.com/drkang7/codex-token-hud) and its contributors. The Node.js collector adapts its `v1.3.0-beta.8` sources at commit [`1c51c0a`](https://github.com/drkang7/codex-token-hud/tree/1c51c0aead8814a140b14cd33e7a2fa08453317c), including response timing and restored-usage handling. Its [MIT copyright and license](src/features/statistics/host/collector/LICENSE) are preserved.

The native preview host bundles parsers for configuration syntax checks. The [parser versions, copyrights and licenses](src/features/workspace-tree/host/preview/CONFIG-PARSER-LICENSES.txt) are included in both distributions.

## Related work

The startup-check status symbols reproduce the geometry of Lucide's circle-check, circle-x, loader-circle and circle-ellipsis icons using native drawing. Copyright (c) 2026 Lucide Icons and Contributors. The [ISC license and upstream notices](src/lifecycle/diagnostics/LUCIDE-LICENSE) are preserved. No icon runtime or font is added.

The table sorting controls embed Lucide's arrow-down-narrow-wide and arrow-down-wide-narrow SVG geometry under the same preserved [ISC/MIT notices](src/lifecycle/diagnostics/LUCIDE-LICENSE). They use local inline SVG without an icon runtime or external requests.

Thank you to [flitfancy/codex-lite-hud](https://github.com/flitfancy/codex-lite-hud) for its local Windows HUD approach, and [Creative-developer-single/codex-speed-hud](https://github.com/Creative-developer-single/codex-speed-hud) for exploring in-app Codex metrics. These projects informed our research and comparison; their program code is not included.

Thank you to [openai/codex](https://github.com/openai/codex) and its contributors. Better-Codex does not ship Codex binaries or an alternative model client. The launcher icon is obtained from the user's installed app during setup, not bundled with this project.

## Runtime dependencies

The portable ZIP includes official Windows x64 Node.js 24.22.0 with its MIT license and bundled third-party notices in `runtime/node/LICENSE`. The pinned download and digest are recorded in `scripts/portable-lock.json`; `runtime/manifest.json` identifies the assembled files. Python, Playwright and the Codex app are not bundled.

---

感谢以上项目与贡献者。本项目直接复用了 codex-token-hud 的采集器，并保留署名和 MIT 许可；另外两个 HUD 项目用于调研和对比，没有随包分发其程序代码。本项目由社区独立开发，与 OpenAI 没有隶属关系。
