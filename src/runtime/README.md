# 运行宿主（`src/runtime/`）

负责通过 Node.js 原生 WebSocket 直连已核验的本地 Codex 回环 CDP 接口，调度各窗口任务，并通过特性注册表加载界面增强。

## 模块职责

| 文件 | 职责 |
| --- | --- |
| `local-cdp.cjs` | 零依赖 Node 原生 WebSocket CDP 客户端 |
| `controller.cjs` | 发现并管理所有官方 Codex 主文档窗口，写入 `view-status.json` |
| `window-controller.cjs` | 单个窗口的模块注入、设置热同步、事件桥接与停止撤回 |
| `feature-registry.cjs` | 8 个特性的产物与宿主加载注册表，提供逐特性故障隔离 |
| `page-contract.cjs` | 主文档 URL 判定 |
| `collector-session.cjs` | 在控制器内运行的单窗口统计采集、独立缓存与限流恢复 |
| `runtime-writer.cjs` | 带重试保护的原子状态写入 |
| `connection.cjs` / `runtime_events.cjs` | 核验回环监听归属、托管控制器及映射脱敏事件 |

## 核心边界

- 正式运行不依赖 Playwright，不启动额外浏览器；停止增强仅断开己方连接并调用各模块 `remove()` 还原原生 DOM，绝不关闭 Codex。
- 单特性加载失败或统计采集失败均局部隔离；采集不启动独立进程，也不使用 `settings.python` 或 `settings.collectorDir`。
- 验证入口：`multi-window`、`collector-session`、`structure`。
