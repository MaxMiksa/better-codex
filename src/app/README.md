# 应用装配

本目录组合功能域，提供完整启动入口和唯一后台宿主。

## 入口与职责

| 文件 | 职责 |
| --- | --- |
| [Start-ComposerHud.ps1](Start-ComposerHud.ps1) | 启动条件、权限路由、后台复用、官方激活及回执 |
| [supervisor.py](supervisor.py) | 装配界面连接与可选更新发现 |
| [PortableLauncher.cs](PortableLauncher.cs)、[portable_bootstrap.py](portable_bootstrap.py) | 便携检查、准备及启动 |

外部仍调用 tools/token-hud-local/ 下的稳定命令。supervisor 保持既有 PID/创建时间、launcher 回执和命令身份，不另建常驻服务。

## 命令与生命周期契约

稳定启动入口的 `-CheckOnly` 只读检查，不激活 Codex或启停增强。`-TaskMode Monitor` 在同一启动锁内请求/复用 supervisor 并返回 JSON，不激活 Codex、不打开体检；普通请求尊重管理员偏好，管理员任务核验实际权限。运行管理只消费命令回执。

提示词监测通过本机可选的 src/prompts/monitoring/Start-Monitor.ps1 启动。公开包缺少该实现时不影响 Codex；监测接收父进程身份和显式停止文件。总停止命令仍停止整套增强后台，不回退已部署指令。

后台退出只清理自有显示连接和子进程。已经开始的恢复执行独立完成一次增强启动，不能由窗口或 supervisor 的清理顺带终止。

## 验证

从项目根运行 scripts/check.py 的 `supervisor`、`launcher-5`、`launcher-7`，跨模块恢复验证见[运行管理](../lifecycle/README.md)。使用假进程或 mock，不通过启动/停止现用后台验收源码。
