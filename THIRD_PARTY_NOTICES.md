# Third-party notices and acknowledgements

Better Codex is an independent community project and is not affiliated with OpenAI.

## Code reused

Thank you to [drkang7/codex-token-hud](https://github.com/drkang7/codex-token-hud) and its contributors. `tools/token-hud-local/collector/metrics.py` and `history.py` derive from its `v1.3.0-beta.8` sources at commit [`1c51c0a`](https://github.com/drkang7/codex-token-hud/tree/1c51c0aead8814a140b14cd33e7a2fa08453317c). The local adaptation removes the unused dashboard entry point. Its [MIT copyright and license](tools/token-hud-local/collector/LICENSE) are preserved. This substantial reuse is not presented as original Better Codex work.

## Related work

Thank you to [flitfancy/codex-lite-hud](https://github.com/flitfancy/codex-lite-hud) for its local Windows HUD approach, and [Creative-developer-single/codex-speed-hud](https://github.com/Creative-developer-single/codex-speed-hud) for exploring in-app Codex metrics. These projects informed our research and comparison; their program code is not included.

Thank you to [openai/codex](https://github.com/openai/codex) and its contributors. Better Codex does not ship Codex binaries or an alternative model client. The launcher icon is obtained from the user's installed app during setup, not bundled with this project.

## Runtime dependencies

The portable ZIP bundles [Playwright](https://github.com/microsoft/playwright) (Apache-2.0), [psutil](https://github.com/giampaolo/psutil) (BSD-3-Clause), and [pywin32](https://github.com/mhammond/pywin32) (its PSF-derived license). Their original license files are included with the bundled distributions. The source installer downloads these dependencies instead.

The portable ZIP also includes the official Windows x64 CPython 3.14.8 embeddable distribution (PSF-2.0 and its included component notices), and Node.js 24.22.0 (MIT and the complete bundled third-party notices). Python LICENSE.txt and Node LICENSE are preserved under runtime/. Fixed download URLs and integrity digests are recorded in scripts/portable-lock.json; runtime/manifest.json identifies the assembled files. The Codex app remains a user-installed prerequisite and is not bundled.

---

感谢以上项目与贡献者。本项目直接复用了 codex-token-hud 的采集器，并保留署名和 MIT 许可；另外两个 HUD 项目用于调研和对比，没有随包分发其程序代码。本项目由社区独立开发，与 OpenAI 没有隶属关系。
