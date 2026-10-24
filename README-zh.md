<h1 align="center">Better-Codex</h1>

<p align="center">
  <a href="https://github.com/MaxMiksa/better-codex/releases/tag/v0.4.1"><img alt="版本" src="https://img.shields.io/badge/version-v0.4.1-blue.svg?logo=github&amp;logoColor=white" /></a>
  <a href="#"><img alt="Windows" src="https://img.shields.io/badge/Platform-Windows-blue.svg?logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cGF0aCBkPSJNNi4zMzcgMTguNjA1bDM1LjY4Ny00Ljg2LjAxNiAzNC40MjItMzUuNjcuMjAzem0zNS42NyAzMy41MjlsLjAyOCAzNC40NTMtMzUuNjctNC45MDUtLjAwMi0yOS43OHptNC4zMjctMzkuMDI1bDQ3LjMxOC02LjkwNlY0Ny43M2wtNDcuMzE4LjM3NXptNDcuMzI5IDM5LjM0OWwtLjAxMiA0MS4zNC00Ny4zMTgtNi42NzktLjA2Ni0zNC43Mzl6IiBmaWxsPSIjZmZmIi8+PC9zdmc+&amp;logoColor=white" /></a>
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/License-MIT-green.svg?logo=opensourceinitiative&amp;logoColor=white" /></a>
  &nbsp;&nbsp;
  <a href="README.md"><img alt="[English]" src="https://img.shields.io/badge/%5BEnglish%5D-2f3640.svg" /></a>
</p>

让 Windows Codex 的聊天界面更方便阅读：在输入框旁查看统计，调整正文宽度，收起多文件变更。社区独立项目，与 OpenAI 没有隶属关系。

**Windows 11 x64 · 官方 Codex 商店应用 · 英文 / 简体中文 · 便携包自带运行环境**

<p align="center"><img src="Presentation/overview.png" alt="Better-Codex：内嵌统计、正文宽度调节与文件变更列表收起" width="900" /></p>

## 开始使用

1. 从 [v0.4.1 Releases](https://github.com/MaxMiksa/better-codex/releases/tag/v0.4.1) 下载 `better-codex-v0.4.1-windows-x64-portable.zip`。
2. **完整解压**到可写、准备长期保留的目录。
3. 双击 `BetterCodex.exe`；点击输入框底部的统计文字调节正文宽度。便携包不需要安装 Python/Node.js，首次启动不下载依赖。

联合入口会异步打开启动体检。确认增强未加载或刚完成 Codex 更新后，检测全部结束才开始 **15 秒重开倒计时**；点击按钮立即执行，**X / Esc 取消**。重开请求正常退出，失败不强制终止、不循环。当前工作需要保留时请取消，方便后再重开。

随时双击 `Stop.cmd` 停止增强、恢复原生布局；Codex 和聊天历史保留。再次运行联合入口可恢复增强。

## 功能

| 使用场景 | 能力 |
| --- | --- |
| 查看统计 | 输入框旁显示最近已完成响应的平均输出速度、输入缓存比例和统计时间；每个窗口独立关联自己的主聊天 |
| 调整阅读空间 | 点击统计文字设置最高 1600px 的正文宽度；主聊天、侧边聊天与子代理各自受面板宽度约束，输入框保持原宽度 |
| 浏览文件变更 | 多文件列表默认收起，可展开全部；保留查看变更和撤销，手动展开的同一卡片保持状态 |
| 使用 Custom 配色 | 修正自定义强调色下的消息气泡和发送按钮，保持文字可读；预设色沿用原生 |
| 启动与维护 | 联合快捷方式、独立登录启动开关、启动体检与脱敏报告；可选监测 Codex 更新后恢复增强入口 |

统计随主输入区布局变化；语言跟随 Codex 的英文/简体中文界面，未声明语言时回退启动语言，其他语言回退英文。Chat 模式只沿用正文宽度，不显示本项目统计；文档和空白页保持原生。

采集器异常退出时仅暂时缺失统计，正文宽度、文件列表与配色保留；后台按频率预算局部恢复，并拒绝旧采集进程的数据。

## 常用设置

以下命令在已初始化的解压目录运行。新安装默认关闭登录启动、Codex 更新监测和管理员启动。

| 任务 | PowerShell 命令 |
| --- | --- |
| 启用登录启动 | `.\tools\token-hud-local\Set-LoginStartup.ps1 -Mode Enable` |
| 启用 Codex 更新监测 | `.\tools\token-hud-local\Set-UpdateRecovery.ps1 -Mode Enable` |
| 查看开关状态 | 对应脚本使用 `-Mode Status` |
| 关闭上述开关 | 对应脚本使用 `-Mode Disable` |
| 只读启动检查 | `.\tools\token-hud-local\Start-ComposerHud.ps1 -CheckOnly` |

登录启动应保持单一入口：启用本项目入口时关闭 Codex 自身的登录启动。更新监测依赖增强后台，确认新版本后打开同一体检，再进行可取消的重开；关闭监测不会取消已经打开的倒计时。它不负责更新 Better-Codex，未来真实 Codex 升级恢复仍待自然使用验收。

需要固定任务栏时使用 `launchers/Codex.lnk`。已固定原 Codex 图标时先取消固定，再固定联合入口；Windows 缓存路径或应用身份后可能需要重新固定。

<details>
<summary>可选管理员启动</summary>

运行 `.\tools\token-hud-local\Set-AdministratorLaunch.ps1 -Mode Enable`，首次请求一次 UAC，后续复用核实后的当前用户任务；`-Mode Disable` 取消入口，不停止 Codex。

这是默认关闭的实验功能，只在全新启动时生效，不能将现有实例原地提权。管理员模式下，Codex 原生通知点击可能无法返回对应聊天；依赖该行为时使用普通启动。

</details>

<details>
<summary>升级、移动与卸载</summary>

升级或移动前先取消旧副本的管理员入口及已启用的登录启动，再用 Stop.cmd 停止旧副本的增强。完整解压新包或整体移动目录，运行新位置的 BetterCodex.exe；路径重建保留原目录中的宽度偏好，必要时重新固定快捷方式，再按需启用开关。其他安装副本的快捷方式不会被接管。

卸载时先取消已启用的登录启动和管理员入口，运行 Stop.cmd、取消固定，最后删除解压目录。Codex 本身和聊天历史保留。

</details>

## 问题与限制

| 现象 | 处理 |
| --- | --- |
| 统计未出现 | 先做只读检查；需完整体检时运行 `tools/token-hud-local/Show-StartupCheck.ps1`，工作中注意取消重开倒计时 |
| `restart-required` | 现有实例缺少显示接口或不满足启动条件；方便时正常退出，再从联合入口打开 |
| `hud-preparation-failed` | 检查文件是否完整；停止本副本增强后将完整 ZIP 解压到新目录，不在压缩包内运行 |
| 显示 `-` 或暂时隐藏 | 缺少用量/计时、聊天关联不确定、数据过期或布局不兼容；不代表速度为零，也不借用其他聊天数据 |

速度是已知请求边界至用量记录的**已完成响应均速**，包含等待和推理、排除已知工具执行；输出用量含推理和工具调用 token。它不是逐 token 实时速度或纯模型解码基准，不承诺加快生成。只有云端记录的聊天无法提供本地统计。

体检不发送模型消息、不验证模型鉴权、不控制 VPN；无法确定的沙箱或代理条件保留待确认。点击已运行的任务栏分组可能只激活应用，不重复打开体检。

Codex 页面更新可能需要适配；不同版本、全部窗口布局和显示缩放比例尚未全面验收。启动程序尚未签名，Windows 可能提示发布者信息。

## 隐私

模型请求继续使用 Codex 原有连接，不增加模型转发代理，不需要额外 API 密钥。便携打包不代表模型可以离线运行；体检会通过检测到的网络路径发送不带模型凭据的轻量 HTTPS 请求。

运行文件可含聊天标识、标题、路径和用量。**请勿上传 .runtime/、认证文件或原始 Codex 日志**；反馈时提供版本、现象与体检的脱敏报告。不要向外网暴露或转发本机显示接口。详见[隐私说明](docs/PRIVACY.md)。

## 开发与来源

另有 `better-codex-v0.4.1-source.zip`。源码安装需要 Python 3.11+、Node.js 20+，运行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1`；可选 `-Language en` / `-Language zh-CN`。开发时使用所选源码版本随附的[开发说明](docs/DEVELOPMENT.md)，避免混用不同版本路径。

本地采集器复用自 [codex-token-hud](https://github.com/drkang7/codex-token-hud)。感谢 [codex-lite-hud](https://github.com/flitfancy/codex-lite-hud)、[codex-speed-hud](https://github.com/Creative-developer-single/codex-speed-hud) 与 [openai/codex](https://github.com/openai/codex)。复用范围、版本和许可见[第三方声明](THIRD_PARTY_NOTICES.md)。

欢迎通过 Issue / Pull Request 反馈和贡献。联系 Zheyuan (Max) Kong：kongzheyuan@outlook.com · zheyuank@andrew.cmu.edu。
