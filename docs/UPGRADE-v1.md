# 从 v0.5.x 升级到 v1.0.0 指南

v1.0.0 将运行环境统一收敛为 **单一 Node.js 24 运行时 + 极薄 Windows 原生 C# 助手**，彻底移除了 Python 依赖与 48 个改名前遗留的 `tools/token-hud-local/` 桥接文件，同时保留全部既有用户设置并自动无损迁移。

## 核心变化一览

| 项目 | v0.5.x | v1.0.0 |
| --- | --- | --- |
| **运行依赖** | Python 3.11+ (`psutil`, `pywin32`) + Node.js 22+ | **仅需 Node.js 24+**（便携包已内置） |
| **本地配置路径** | `.runtime/token-hud/embedded/settings.json` | `.runtime/settings.json`（首次运行自动无损迁移） |
| **运行状态路径** | `.runtime/token-hud/embedded/runtime/` | `.runtime/state/` |
| **快捷方式包装器** | `.runtime/token-hud/embedded/start-composer.vbs` | `.runtime/launchers/start-better-codex.vbs` |
| **命令行入口** | `tools/token-hud-local/*.ps1` | `src/` 直接入口或 `package.json` 脚本 |

## 升级步骤

### 便携版用户

1. 若之前启用了开机自启，先在旧目录关闭开机自启；运行旧目录的 `Stop.cmd` 停止旧版增强后台（无需关闭 Codex）。
2. 将新的 `better-codex-v1.0.0-windows-x64-portable.zip` 完整解压到目标目录；若需保留旧目录偏好，直接复制旧 `.runtime/token-hud/embedded/settings.json` 至新目录（或原位覆盖后启动）。
3. 运行 `BetterCodex.exe`：首次启动会自动把旧配置迁移到 `.runtime/settings.json` 并更新本副本拥有的快捷方式。
4. 若任务栏仍固定了旧版快捷方式，重新固定新目录的 `launchers/Codex.lnk` 即可。

### 源码安装用户

1. 先运行旧版 `Stop.cmd` 停止旧的 Python 增强后台（不重启 Codex）。
2. 拉取 v1.0.0 代码，在仓库根目录运行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1`。
3. `Install.ps1` 会自动完成：
   - 将 `.runtime/token-hud/embedded/settings.json` 中的全部偏好（阅读宽度、字号、统计排序、斜杠命令显隐、输入框自动隐藏、Preview 路径、端口等）无损迁移至 `.runtime/settings.json`，原文件只读保留作备份；
   - 将当前副本已登记的快捷方式（含任务栏固定项）平滑切换至 `.runtime/launchers/start-better-codex.vbs`，保持官方 `AppUserModelID`。

## 命令对照表

| 常见操作 | 旧命令（已移除） | v1.0.0 新命令 |
| --- | --- | --- |
| 启动 / 只读检查 | `tools/token-hud-local/Start-ComposerHud.ps1 [-CheckOnly]` | `src/app/Start-ComposerHud.ps1 [-CheckOnly]` 或 `Start.cmd` |
| 停止增强 | `tools/token-hud-local/Stop-ComposerHud.ps1` | `src/lifecycle/startup/Stop-ComposerHud.ps1` 或 `Stop.cmd` |
| 启动体检 | `tools/token-hud-local/Show-StartupCheck.ps1` | `src/lifecycle/diagnostics/Show-StartupCheck.ps1` |
| 开机自启开关 | `tools/token-hud-local/Set-LoginStartup.ps1` | `src/lifecycle/installation/Set-LoginStartup.ps1` |
| 更新监测开关 | `tools/token-hud-local/Set-UpdateRecovery.ps1` | `src/lifecycle/recovery/Set-UpdateRecovery.ps1` |
| 运行历史查询 | `tools/token-hud-local/Get-RuntimeHistory.ps1` | `src/platform/observability/Get-RuntimeHistory.ps1` |
| 目录迁移修复 | `tools/token-hud-local/Repair-WorkspacePaths.ps1` | `src/lifecycle/installation/Repair-WorkspacePaths.ps1` |
