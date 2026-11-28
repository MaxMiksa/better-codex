# 应用装配（`src/app/`）

组合运行管理、运行宿主与共用底座，提供统一启动入口、便携启动器与唯一 Node.js 后台宿主。

## 入口与职责

| 文件 | 职责 |
| --- | --- |
| `Start-ComposerHud.ps1` | 启动条件、后台复用、官方普通激活与回执；`-CheckOnly` 只读检查，`-TaskMode Monitor` 仅复用/启动后台 |
| `supervisor.cjs` | 唯一 Node.js 24 后台宿主，调度 CDP 连接、更新监测与 5 天运行历史记录 |
| `startup-diagnostics.cjs` | 装配 8 行体检（10 项底层检查）与可选的外部只读探针（`promptDiagnosticsCommand`） |
| `PortableLauncher.cs` / `portable-bootstrap.cjs` | 便携入口 `BetterCodex.exe`（启动内置 `runtime/node/node.exe`）、检查、准备与旧配置自动迁移 |

## 核心契约

- 仅当未确认官方 Codex 已运行时异步打开启动体检；点击任务栏唤起已运行实例（含后台）不重复触发体检。
- 后台复用同时核对 PID/创建时间、Node 路径及源码/连接摘要；不因宽度或配色偏好重启后台。
- 停止增强只断开己方连接与后台进程，绝不关闭 Codex；已经开始的正常退出/恢复动作独立完成，不被后台清理打断。
- 验证入口：`node scripts/check.mjs supervisor launcher-5 launcher-7 management`。
