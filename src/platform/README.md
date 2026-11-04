# 共用机制

本目录提供功能域共用的机制，不决定产品行为。依赖只能从 app/功能域指向本层。

## 模块边界

| 位置 | 提供什么 | 留在上层的内容 |
| --- | --- | --- |
| codex/ | 官方包发现、监听/进程身份、已知主题字段读取 | 完整功能依赖、恢复资格与重开决策 |
| windows/ | 针对已核实实例的正常退出原语 | 倒计时、重试政策与恢复编排 |
| settings/ | 同一跨运行时锁内的顶层 patch、未知字段与最后有效值 | 功能开关含义与界面 |
| i18n/ | 共用词表及 Python/PowerShell/Node/C# 适配 | 页面交互与业务政策 |
| [observability/](observability/README.md) | 通用追加事件、SQLite、只读 JSON 查询与记录器健康 | 事件含义与采集点由各域和 app 持有 |
| paths.py / paths.ps1 | 定位本安装副本根目录 | 部署迁移与旧安装接管 |

## 持久契约与维护

现有 .runtime/token-hud/embedded/settings.json 及状态位置保持，设置使用扁平结构，不能以嵌套对象覆盖或重新建锁破坏合并。持久取消、防重放、提示词批准和恢复链不属于可丢弃缓存。

settings/runtime_stamp.ps1 提供启动与只读诊断共用的源码/连接摘要纯函数，保留既有字节算法；读取摘要本身不刷新后台，版本不一致如何处理由上层决定。

本层不得导入 app、interface、lifecycle 或 prompts，不放业务 UI、完整启动预检或提示词审批。修改共用机制时核对所有语言适配及调用方；按影响运行 scripts/check.py 的 `structure`、`i18n`、相关启动/迁移检查，不为基础层改动重启现用 App。

正常退出原语将唯一 PID 和内核创建时间登记给 Windows Restart Manager，并核对受影响实例；`RmShutdown` 使用 0 标志，不强制终止，也不要求应用通过 RegisterApplicationRestart 登记重启。原生退出回归入口为 `native-exit`，只使用自建的接受/拒绝退出测试进程。
