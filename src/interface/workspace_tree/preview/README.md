# Better Codex Preview

这是工作区文件树的可选原生预览窗口。支持静态 JPEG／PNG（不超过 1200 万像素、12 MiB）、常见 UTF‑8 文本及源代码；更大的图片、未知编码、PDF、Office 和媒体文件等继续交给 QuickLook（已配置时）或 Peek。大文本只显示开头，Markdown 显示源文，脚本不会执行；工具栏的「打开」或「定位」沿用文件树的权限与类型判断。

从同版本发行下载可选的预览 ZIP，解压后填入可信的 `BetterCodexPreview.exe` 绝对路径作为本机增强设置 `workspaceTreePreviewPath`，然后重新加载增强控制器。删除该项即可回退。可保留现有 QuickLook 配置作为格式补充。预览窗口支持空格或 Esc 收起，约 5 秒后退出；短时间切换使用原进程，连续切换不同图片时每处理四张会换新进程，限制解码缓存。不在启动时预热，不安装服务、注册文件关联或修改全局空格键。

## 从源码打包

使用 [NSH v0.7.2 Windows x64 官方预编译包](https://github.com/longbridge/nsh/releases/tag/v0.7.2)。校验发布资产的摘要，解压整套工具（`bin` 和 `runtime`）后，从仓库根运行：

```powershell
powershell -NoProfile -File .\scripts\Build-WorkspacePreview.ps1 -NshExe <absolute-path-to-nsh.exe> -OutputDir <new-output-directory>
```

使用输出的整个 `BetterCodexPreview` 目录（或者解压对应 ZIP），不要只搬 EXE。打包脚本只在子命令的进程环境中移除 Rust 工具链，不编译 Rust。Better-Codex 的标准包不附带该可选预览器二进制。

预览沙箱只可读写自身的请求目录。控制器仅给它选中文件的有界副本；窗口请求打开原件时，控制器按原来的工作区权限重新校验。复用窗口不保留历史请求，关闭或切换时清理副本；中断遗留的请求下次使用时清理。
