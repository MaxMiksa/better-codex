<h1 align="center">Better-Codex</h1>

<p align="center">
  <a href="https://github.com/MaxMiksa/better-codex/releases/tag/v0.4.0"><img alt="版本" src="https://img.shields.io/badge/version-v0.4.0-blue.svg?logo=github&amp;logoColor=white" /></a>
  <a href="#"><img alt="Windows" src="https://img.shields.io/badge/Platform-Windows-blue.svg?logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cGF0aCBkPSJNNi4zMzcgMTguNjA1bDM1LjY4Ny00Ljg2LjAxNiAzNC40MjItMzUuNjcuMjAzem0zNS42NyAzMy41MjlsLjAyOCAzNC40NTMtMzUuNjctNC45MDUtLjAwMi0yOS43OHptNC4zMjctMzkuMDI1bDQ3LjMxOC02LjkwNlY0Ny43M2wtNDcuMzE4LjM3NXptNDcuMzI5IDM5LjM0OWwtLjAxMiA0MS4zNC00Ny4zMTgtNi42NzktLjA2Ni0zNC43Mzl6IiBmaWxsPSIjZmZmIi8+PC9zdmc+&amp;logoColor=white" /></a>
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/License-MIT-green.svg?logo=opensourceinitiative&amp;logoColor=white" /></a>
  &nbsp;&nbsp;
  <a href="README.md"><img alt="[English]" src="https://img.shields.io/badge/%5BEnglish%5D-2f3640.svg" /></a>
</p>

✅ **不用安装 Python/Node.js · 中英文支持 · 本地处理**  
✅ **内嵌统计 · 正文宽度调节 · 文件变更列表收起**  
✅ **Windows 11 · 官方 Codex 桌面应用**  

让 Codex 更好用的小功能合集。它把实用统计放在输入框旁，并让你按自己的习惯调整阅读空间。本项目由社区独立开发，与 OpenAI 没有隶属关系。

<p align="center"><img src="Presentation/overview.png" alt="Better-Codex：内嵌统计、正文宽度调节与文件变更列表收起" width="900" /></p>

<p align="center"><em>内嵌统计、正文宽度调节与文件变更列表收起。</em></p>

## ✨ 功能

| 功能 | 使用体验 |
| --- | --- |
| 内嵌统计 | 用灰色文字在输入框旁显示最近一次响应的输出速度、输入缓存比例和统计时间。 |
| 正文宽度 | 点击统计文字调整正文宽度，最大 1600px。主聊天、侧边聊天与子代理在各自面板内沿用已保存的上限，输入框保持原宽度。 |
| HUD 布局跟随 | 切换侧栏、文档与子代理时，统计保持关联主聊天，并跟随输入区布局变化。 |
| 多窗口 | 每个 Codex 窗口独立关联自己的聊天统计，显示设置安全共享。 |
| Custom 配色 | 使用 Custom 强调色时，修正用户消息与发送按钮的配色，并保持文字可读。 |
| 文件列表收起 | 多文件变更列表默认收起，需要时展开全部；保留查看变更和撤销入口。 |
| 中英文支持 | 界面标签、安装与启动提示自动选择英文或简体中文。 |
| 联合启动 | 用快捷方式一起打开 Codex 和增强功能，登录启动可以单独开启。 |
| 启动体检 | 检查启动、本地历史、沙箱条件、网络传输、权限和增强状态，可复制脱敏报告。 |
| 故障恢复 | 确认增强未加载后提供可取消的 15 秒重开；可选后台监测在 Codex 更新后打开同一体检。 |
| 随时停止 | 恢复原生布局，Codex 继续运行。 |

速度是从已知请求边界到用量记录计算的**最近一次已完成响应均速**，包含等待和推理，排除已知工具执行；边界不明或只有恢复的累计用量时显示破折号。它不是逐 token 实时速度或纯模型解码基准。输出用量包含推理和工具调用 token；缺失数据不会记成零。

宽度弹出栏与统计文字使用相同字号，并跟随原生输入区控件。Chat 模式沿用正文宽度，不显示本项目 HUD。窄面板的实际宽度可能小于所选上限；文档与空白页保持原生布局。

## 🚀 开始使用

需要 **Windows 11 x64 和官方 Codex 商店应用**。便携包已包含独立的 Python、Node.js 和依赖，不用安装系统运行环境，首次启动也不下载依赖。

1. 从 [Releases](https://github.com/MaxMiksa/better-codex/releases/tag/v0.4.0) 下载 **`better-codex-v0.4.0-windows-x64-portable.zip`**。
2. 将 ZIP **完整解压**到可写且准备长期保留的目录。
3. 双击 **`BetterCodex.exe`**。点击输入框底部的统计文字调节正文宽度；双击 `Stop.cmd` 可停止增强功能。

联合入口会异步打开启动体检。确认增强未加载时，检测全部结束后，启动按钮开始 **15 秒倒计时**；点击立即重开，X 或 Esc 关闭可取消。恢复会请求正常退出，再从完整增强入口启动，不强制终止，失败不循环。当前仍有工作需要保留时，请取消倒计时，方便后再重开。

## 📚 更多

<details>
<summary><b>📋 环境要求与限制</b></summary>

界面验证始于 Codex 桌面包 `26.1013.4894.0`，后续定向检查覆盖至 `26.1016.8622.0`，本次另有隔离包验证；这些不代表所有版本、窗口布局和显示缩放比例均已充分验收。Codex 更新后可能需要适配。启动程序尚未签名，Windows 可能显示发布者提示。

统计依赖可读取的本地 Codex 会话记录，不测量只有云端记录的聊天。Chat 模式可以沿用正文宽度，但不显示 Codex 统计。

安装和启动提示默认跟随 Windows 显示语言；进入 Codex 后，HUD 标签、相对时间、正文宽度控件和文件列表按钮跟随 Codex 的实际界面语言，切换语言时同步更新。Codex 未声明语言时，才使用启动时选定的电脑语言。支持英文和简体中文，其他语言回退英文；Codex 原生按钮和第三方安装工具沿用各自语言。

Better-Codex 本身仍需手动更新；可选的 Codex 更新恢复只恢复增强启动路径，不负责安装更新。当前没有模型能力或降级检测、插件市场，不承诺加快模型生成。请保持本地显示接口仅供本机访问，不要暴露或转发到外网。

</details>

<details>
<summary><b>🧭 快捷方式、登录启动与卸载</b></summary>

固定到任务栏时，使用 `launchers/Codex.lnk`。若已固定原 Codex 图标，请先取消固定，再固定联合入口。其他程序或其他安装目录的快捷方式不会被覆盖。升级或移动目录前，先取消旧副本已启用的管理员入口，再停止旧副本；若启用了登录启动，切换目录前先取消旧入口，之后按需启用新入口。再双击新位置的 BetterCodex.exe；整体移动时会重建本机路径并保留宽度偏好。Windows 可能缓存旧任务栏路径，必要时重新固定新快捷方式。

首次安装默认不开启登录启动。需要时执行：

```powershell
.\tools\token-hud-local\Set-LoginStartup.ps1 -Mode Enable
```

启用后，请在 Codex 自身设置中关闭官方登录启动，保持单一入口。取消本项目登录启动时使用 `-Mode Disable`。卸载时先取消已启用的登录启动及管理员入口，再运行 `Stop.cmd`、取消固定该快捷方式，最后删除解压目录；Codex 本身和聊天历史保留。

</details>

<details>
<summary><b>🩺 启动体检与可选恢复</b></summary>

可单独运行 `tools/token-hud-local/Show-StartupCheck.ps1` 打开体检，检查启动与本地历史、沙箱条件、网络传输、增强加载及实际权限，并复制脱敏报告。体检不发送模型测试消息，不验证模型鉴权，不修改 Codex 或 VPN 配置；无法确认的沙箱或代理条件保留待确认。

未来 Codex 更新的后台监测**默认关闭**。完成本副本初始化后，可执行：

```powershell
.\tools\token-hud-local\Set-UpdateRecovery.ps1 -Mode Enable
```

使用 `-Mode Status` 查看，`-Mode Disable` 关闭监测。它依赖增强监督后台持续运行。确认新版本后打开统一体检，检测结束再开始可取消的 15 秒重开倒计时，即使接口已连接也会执行这套流程；取消的同次更新不会反复弹出。未来真实更新恢复仍待自然使用验收。点击已经运行的任务栏分组可能仅激活应用，不会重复打开体检。

管理员启动是**默认关闭的可选实验功能**。在同一工具目录运行 `Set-AdministratorLaunch.ps1 -Mode Enable`，首次请求一次 UAC，后续复用核实后的当前用户任务；`-Mode Disable` 移除入口，不停止 Codex。它在全新启动时生效，不会将现有实例原地提权。此模式下，Codex 原生通知点击可能无法返回对应聊天；依赖该行为时请使用普通启动。修改任务栏身份后，Windows 可能需要通过原生菜单重新固定 `launchers/Codex.lnk`。

</details>

<details>
<summary><b>🔎 与三个相近项目对比</b></summary>

| 项目 | 主要侧重 | 适合的需求 |
| --- | --- | --- |
| **Better-Codex** | Windows 应用内统计，以及正文宽度和文件列表优化 | 希望在聊天界面内获得一组简洁增强功能 |
| [codex-token-hud](https://github.com/drkang7/codex-token-hud) | 本地速度与缓存统计、悬浮窗口、历史及区间统计 | 需要更丰富的独立统计工具；本项目采集器来自该项目 |
| [codex-lite-hud](https://github.com/flitfancy/codex-lite-hud) | Windows 原生轻量悬浮条，提供用量、上下文、用时和额度 | 希望使用不携带 Node.js/Python 的小型原生 .NET HUD |
| [codex-speed-hud](https://github.com/Creative-developer-single/codex-speed-hud) | 应用内流式估速、延迟和费用显示 | 需要实时输出估算；文档目前记录的桌面验收平台为 Linux |

依据各项目自身文档，于 2026-10-18 核对。不同项目的速度口径不同，不宜把读数当作同一性能基准；此表比较功能定位，不代表完整测试了它们的所有发行版。

</details>

<details>
<summary><b>🔐 本地数据与隐私</b></summary>

模型请求继续使用 Codex 既有连接。本工具读取本地用量记录并调整本机界面，不增加模型转发代理，也不需要额外 API 密钥。便携版启动时不下载依赖。Codex 模型请求仍需要原有网络连接，离线打包不代表模型可以离线运行；可选的源码安装流程访问 Python/npm 软件包源；启动体检也会沿检测到的网络路径发起不带凭据的轻量 HTTPS 请求，以确认传输可达性。

本地运行文件可能包含聊天标识、标题、文件路径和用量信息。反馈问题时不要上传 `.runtime/` 或原始 Codex 日志。详见[隐私说明](docs/PRIVACY.md)。

</details>

<details>
<summary><b>🛠️ 故障排查与已知限制</b></summary>

统计未出现时，先查看启动体检并复制报告；命令行只读检查可运行 `tools/token-hud-local/Start-ComposerHud.ps1 -CheckOnly`。`restart-required` 表示需要用户方便时正常退出应用，再从联合入口启动；`hud-preparation-failed` 通常是文件缺失或损坏，可先停止本 HUD，再将完整便携 ZIP 解压到新目录。不要直接在压缩包中运行。只有源码安装才需要 Install.ps1 的 Python/Node 参数。

破折号表示缺少用量或计时，不是速度为零。新轮次、聊天关联不确定、数据过期或页面结构不兼容时，统计可能隐藏，避免显示其他聊天的旧数据。随时可以运行 `Stop.cmd` 恢复原生界面。

</details>

<details>
<summary><b>💻 开发说明</b></summary>

同时保留 `better-codex-v0.4.0-source.zip`。源码安装需要 Python 3.11+ 和 Node.js 20+，在解压目录运行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1`。可加 `-Language en` 或 `-Language zh-CN` 明确选择安装提示语言，默认自动选择。便携版已经包含运行环境，无需下载浏览器。[开发说明](docs/DEVELOPMENT.md)列出模块职责、隔离检查及打包方式。公开包不包含运行数据、私人探索记录或本机配置。

</details>

## 🙏 致谢

感谢 [codex-token-hud](https://github.com/drkang7/codex-token-hud) 提供本项目复用的本地采集器，也感谢 [codex-lite-hud](https://github.com/flitfancy/codex-lite-hud)、[codex-speed-hud](https://github.com/Creative-developer-single/codex-speed-hud) 和 [openai/codex](https://github.com/openai/codex) 的开源工作。代码复用范围、来源版本及许可证见[第三方声明](THIRD_PARTY_NOTICES.md)。

## 🤝 贡献与联系

欢迎提交 Issue 和 Pull Request！  
如有任何问题或建议，请联系 Zheyuan (Max) Kong (卡内基梅隆大学，宾夕法尼亚州)。

Zheyuan (Max) Kong: kongzheyuan@outlook.com | zheyuank@andrew.cmu.edu
