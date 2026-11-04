# 本机运行历史

本模块提供通用事件、唯一 SQLite store 和跨进程 JSON CLI，不决定恢复资格或其他业务行为。生命周期映射位于 `src/lifecycle/runtime_events.py`，界面映射位于 `src/interface/runtime_events.py`，由现有 app 装配。Node 只发布既有状态快照，不访问数据库。

## 查询与参数

从安装根调用稳定薄入口；查询不启动组件、不探测网络，也不初始化、迁移、修复或清理数据库。

```powershell
& '.\tools\token-hud-local\Get-RuntimeHistory.ps1' -Since '2026-11-03T00:00:00+08:00' -Limit 100
& '.\tools\token-hud-local\Get-RuntimeHistory.ps1' -Kind diagnostic-completed
& '.\tools\token-hud-local\Get-RuntimeHistory.ps1' -CorrelationId '<查询结果中的关联编号>'
```

| 参数 | 契约 |
| --- | --- |
| Since / Until | 可选 ISO 8601，必须含时区；默认最近 5 天至当前时间，包含边界，按 occurred_at 筛选 |
| Kind / Source | 可选精确匹配，不使用模糊或正则搜索 |
| CorrelationId | 可选精确关联编号；一次启动/更新的体检与恢复沿用该编号，独立体检仍有不同事件身份 |
| Limit | 1–1000，默认 100；按发生时间降序，相同时间按 event_id 排序，truncated 表示还有记录 |
| SettingsPath / Runtime | 可选安装设置路径、状态根覆盖，主要供隔离诊断；默认本安装副本 |

结果为一个 JSON 对象，含 `schema_version`、`ok`、`events`、`health`、`coverage` 和 `truncated`。每条事件含 event_id、occurred_at、observed_at、kind、status、source、correlation_id、payload。缺数据库为成功空结果，coverage.note 为 database_missing；数据库不可读/损坏/未来 schema 为 ok=false，并提供脱敏 error_category。这些情况下 health.state 均为 unknown，保留安全的最近已知时间；不沿用旧文件中的 healthy。查询成功时，记录器已知的 degraded 状态仍保留。Python CLI 退出码为 0（成功）、1（存储/读取不可用）、2（无效参数）。PowerShell 输出同一 JSON；设置/解释器不可用也返回完整字段，events 为空、health.state=unknown、coverage.note=query_runtime_unavailable。

Python 使用 `Store.append(record)`；其他进程可调用 `python -m src.platform.observability.cli --runtime <目录> append`，从标准输入接收单个事件 JSON（最多 64 KiB），或接收 event() 的 kind/status/source/correlation_id/instance/occurred_at/context 参数对象。命令须从安装根运行；稳定 PowerShell 命令已处理任意当前目录。原始异常和输入不会出现在错误输出中。

## 持久与失败契约

状态位于 `.runtime/token-hud/embedded/runtime/observability.sqlite3`，WAL 模式，schema 由 `PRAGMA user_version=1` 标记。首次写入幂等建表和索引；未知版本拒绝写入，不替换数据库。event_id 是来源、类型与一次发生身份的 SHA-256；重复投递不覆盖，独立发生用新身份。occurred_at 是来源发生时间，observed_at 是采集时间；观察到退出不推断退出原因，启动请求成功不推断增强加载。

每次连接忙等待最多 120ms，短事务；失败后同一进程和共享状态均退让 15 秒。现有 supervisor tick 重投最多 32 条内存待写记录，不新增服务/定时器；进程退出或队列溢出可能丢失，缺口不会伪装成正常。记录调用失败不能中断业务。损坏库不自动删除或覆盖。

最近 5 天按 observed_at 保留；写入时最多每小时物理删除过期记录，只读查询始终过滤过期记录。没有写入时可能仍有过期页，SQLite 的空闲页/WAL 不提供安全擦除保证。只读查询使用 mode=ro/query_only，不执行 schema、DELETE、checkpoint 或状态更新。

`observability-status.json` 原子保存记录器自身的最新健康、首次覆盖时间和最近一次缺口起止/类别，不复制事件历史。恢复后追加 recorder-gap / recorder-recovered。状态写入也不可用时 health=unknown；该文件只保留最近缺口，历史缺口以数据库恢复事件为准。查询 coverage.continuous 始终为 false：没有心跳历史，无法据缺少事件断言期间正常；缺失状态、未加载新源码、进程突然退出和首次记录前的时间均未知。

payload 严格筛选字段、数值、布尔、版本及符号代码，不接受任意嵌套文本。完整体检保存固定八个显示项对应的十个底层检查状态和可识别的说明代码，不保存本地化原文、动态值、会话标识、标题、路径、凭据、账户元数据、URL、原始异常或日志。未知说明记 evidenceUnavailable；中断由窗口提交 workerTimeout/workerStopped/cancelled，已完成事件按同一实例幂等，不被后续清理覆盖。

## 验证与发行

`python -B -X utf8 scripts/check.py observability --work .validation-runtime/observability-check` 覆盖存储、并发、故障、脱敏、映射和发行集合。数据库、WAL、状态和导出均不进入包；运行机制和稳定查询随 runtime，隔离测试随 sourceExtras。源码与隔离通过不等于现用后台已加载，也不等于未来自然升级、真实桌面恢复和长期稳定性已验收。
