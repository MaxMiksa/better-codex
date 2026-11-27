# 应用装配

本目录组合功能域，提供完整启动入口和唯一后台宿主。

## 入口与职责

| 文件 | 职责 |
| --- | --- |
| [Start-ComposerHud.ps1](Start-ComposerHud.ps1) | 启动条件、后台复用、官方普通激活及回执 |
| [supervisor.py](supervisor.py) | 装配界面连接与可选更新发现 |
| [startup_diagnostics.py](startup_diagnostics.py) | 装配运行管理体检与可选的本机提示词只读探针 |
| [PortableLauncher.cs](PortableLauncher.cs)、[portable_bootstrap.py](portable_bootstrap.py) | 便携检查、准备及启动 |

外部仍调用 tools/token-hud-local/ 下的稳定命令。supervisor 保持既有 PID/创建时间、launcher 回执和命令身份，不另建常驻服务。

运行历史由现有 supervisor tick、启动回执和体检发布点装配：共用 SQLite 在 platform，事件映射在 lifecycle/interface。后台启动/停止、已有连接/页面变化、更新与网络检查结果只记录变化；体检按独立实例保存完整脱敏状态。启动、更新、恢复通过 correlation_id 关联。查询、隐私与失败退让见[运行历史契约](../platform/observability/README.md)。本轮不为加载新代码启停现用后台。

## 命令与生命周期契约

稳定启动入口的 `-CheckOnly` 只读检查，不激活 Codex或启停增强。`-TaskMode Monitor` 在同一启动锁内请求/复用 supervisor 并返回 JSON，不激活 Codex、不打开体检；不再读取旧管理员偏好或派发管理员任务。运行管理只消费命令回执。

快捷方式和便携入口共用同一自动体检判定：拿到启动锁后，先核对当前 Windows 会话中是否有仍在运行的官方 Codex 进程（核对商店包系列、PID 及创建时间，不依赖窗口）。已运行时沿用普通激活和增强复用流程，不打开体检；未确认运行时在增强准备和正式激活前异步打开体检。显式体检及更新监测不受此判断影响。

正式版使用 Node 内置 WebSocket；旧设置的 Playwright 路径保留但不再参与依赖检查和后台复用。源码安装和便携准备均不安装测试用 Playwright。

后台复用同时核对 PID/创建时间、Python 路径及源码/连接设置摘要。旧回执缺摘要或摘要变化时，通过 stop 文件请求自有后台退出，等待完成后再启动；超时不另起重复后台。宽度与配色偏好变化不触发该刷新。

摘要纯函数统一位于 platform/settings/runtime_stamp.ps1，启动器与只读诊断共用原有字节算法。检查发现后台摘要较旧只提示下次启动刷新，不在体检中启停后台。检查装配通过可选导入调用本机提示词诊断；公开包无该模块时显示不适用，运行管理不导入提示词域。

冷启动的端口避让与权限契约见[运行管理](../lifecycle/README.md#启动条件与回执)。后台准备失败仍保留已经确认有效的显示接口启动参数，避免恢复入口再次打开无接口实例。

本机 magpie 的短暂等待由本入口在已确认冷启动、正式激活前调用运行管理 helper；兼容桥仅转发，体检仍提前异步打开。已有实例、只读检查及监测/重载派发不等待；重载完成正常退出后重新进入冷启动时才适用。具体配置选择与期限见[运行管理](../lifecycle/README.md#启动条件与回执)。

提示词监测通过本机可选的 src/prompts/monitoring/Start-Monitor.ps1 启动。公开包缺少该实现时不影响 Codex；监测接收父进程身份和显式停止文件。总停止命令仍停止整套增强后台，不回退已部署指令。

体检先读取提示词快照；仅监测身份或近期检查未确认时，等待应用检查完成（最多 32 秒），再给监测最多 10 秒、每 0.5 秒只读复查。体检早于正式激活和 watcher 启动，不能把首次快照固定成最终结果；超时仍保留未确认，不启动监测、重新登记或放宽身份与新鲜度核验。模块缺失、主动禁用、正文变化或仅通知登记未确认时直接返回原结果。

后台退出只清理自有显示连接和子进程。已经开始的恢复执行独立完成一次增强启动，不能由窗口或 supervisor 的清理顺带终止。

## 验证

从项目根运行 scripts/check.py 的 `supervisor`、`launcher-5`、`launcher-7`；`management` 覆盖提示词探针启动等待与有限复查，跨模块恢复验证见[运行管理](../lifecycle/README.md)。使用假进程或 mock，不通过启动/停止现用后台验收源码。
