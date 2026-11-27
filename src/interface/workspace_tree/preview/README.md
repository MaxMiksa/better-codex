# 在 Better-Codex 中接入 Preview

这是工作区文件树的可选原生预览窗口。支持静态 JPEG／PNG（不超过 1200 万像素、12 MiB）、常见 UTF‑8 文本及源代码；更大的图片、未知编码、PDF、Office 和媒体文件等继续交给 QuickLook（已配置时）或 Peek。大文本只显示开头，Markdown 显示源文，脚本不会执行；工具栏的「打开」或「定位」沿用文件树的权限与类型判断。

预览器由独立的 [Preview](https://github.com/MaxMiksa/preview) 项目维护。下载 [Preview v1.0.0 的 Windows x64 ZIP](https://github.com/MaxMiksa/preview/releases/tag/v1.0.0)，解压整个 `BetterCodexPreview` 目录，在本机增强配置 `settings.json` 中把 `workspaceTreePreviewPath` 指向可信的 `BetterCodexPreview.exe` 绝对路径，然后重新加载增强控制器。已经安装的 1.0.0 可继续使用，无需迁移。清空该项即可回退。

预览窗口支持空格或 Esc 收起，约 5 秒后退出。不安装服务、注册文件关联或修改全局空格键。Better-Codex 只保留文件树的接入，不含预览器源码或二进制，也不会自动下载它。

## 接入边界

本项目的文件树适配器仍负责校验工作区、传递有限大小的临时副本、清理并回退。窗口请求打开原件时，控制器按原来的工作区权限重新校验。协议与构建说明见 [Preview 项目](https://github.com/MaxMiksa/preview/blob/v1.0.0/docs/host-protocol.md)。
