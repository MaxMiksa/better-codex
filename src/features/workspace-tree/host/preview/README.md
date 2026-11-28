# 在 Better-Codex 中接入 Preview

这是工作区文件树的可选原生预览窗口。支持静态 JPEG／PNG（不超过 1200 万像素、12 MiB）、常见 UTF‑8 文本及源代码。新版 Preview 会先缩小大图，连续切换时优先处理最后选中的文件。大文本只显示开头，复杂内容可用纯文本显示；脚本不会执行。工具栏的「打开」或「定位」沿用文件树的权限与类型判断。

安装带 `PreviewMedia.exe` 的整包后，本地 MP4/H.264 可显示一张封面，不播放。配置原生 Preview 时，不支持的 MP4 不会交给其他播放器；更大的图片、未知编码、PDF、Office 和其他不支持的类型仍按原规则交给 QuickLook（已配置时）或 Peek。旧版 Preview 可继续处理原有的文字和图片。

预览器由独立的 [Preview](https://github.com/MaxMiksa/preview) 项目维护。下载 [Preview v1.0.0 的 Windows x64 ZIP](https://github.com/MaxMiksa/preview/releases/tag/v1.0.0)，解压整个 `BetterCodexPreview` 目录，在本机增强配置 `settings.json` 中把 `workspaceTreePreviewPath` 指向可信的 `BetterCodexPreview.exe` 绝对路径，然后重新加载增强控制器。已经安装的 1.0.0 可继续使用，无需迁移。清空该项即可回退。

从 Codex 文件树、资源管理器或桌面打开时，预览窗口会接收键盘焦点。按 **Esc** 收起，未在编辑时也可按 **空格** 收起；编辑时空格正常输入，Esc 仍会检查未保存的修改。新版关闭窗口后退出，不为下次打开而常驻。不安装服务、注册文件关联或修改全局空格键。Better-Codex 只保留文件树的接入，不含预览器源码或二进制，也不会自动下载它。

使用包含 `PreviewRequestHost.exe` 的新版整包时，大图缩放和视频封面提取可以与窗口启动并行，窗口只在内容就绪后显示。旧包仍按原方式处理文件，不需要改配置。

如果 Windows 把键盘焦点留在 Codex，保持文件树焦点在同一个文件上，按 **Esc** 或再按一次 **空格** 也能关闭新版预览，无需先点击窗口。

两端都支持编辑时，可在预览窗口修改不超过 160 KiB、未被截断的可写 UTF‑8 文件：

- **自动保存**：Markdown、TXT、RST、AsciiDoc、Org、LOG、CSV／TSV、无后缀的 `README` 和 `LICENSE`，以及 `.json`、`.jsonc`、`.yaml`、`.yml`、`.toml`、`.ini`、`.gitignore`、`.gitattributes`、`.env.example`。停下输入后写回原件；结构化配置语法不通过时只保留草稿。INI 检查常见的节标题和键值行，不检查具体程序的配置要求。
- **手动保存**：`.js`、`.ts`、`.py`、`.sh`、`.ps1`、`Dockerfile`、`Makefile`。按 **Ctrl+S** 才写回；关闭有未保存修改的预览时会提醒，不会代为保存。预览不会执行代码。
- **仍不支持编辑**：实际的 `.env` 和环境变体、其他代码格式、图片、只读文件和截断预览。

Markdown 默认显示排版，按 **Ctrl+E** 切换源码和排版；其余可编辑文件直接点击正文。Ctrl+Z 撤销、Ctrl+Y 重做，关闭窗口后不保留撤销记录。如果原文件在别处被改动，窗口会保留草稿，不覆盖外部修改。只更新 Better-Codex 时，旧版 Preview 仍会把需要手动保存的代码显示为只读。

## 接入边界

本项目的文件树适配器负责校验工作区、传递有限大小的临时副本、清理并回退。请求打开或保存原件时，控制器重新校验工作区权限；只有控制器写原文件，预览器不接收原文件路径。协议与构建说明见 [Preview 项目](https://github.com/MaxMiksa/preview)。
