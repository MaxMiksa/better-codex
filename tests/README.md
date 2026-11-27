# 隔离验证

验证按功能域归属。日常入口为项目根的 scripts/check.py，实际 case 以 [cases.json](cases.json) 和 `--list` 为准。

## 选择检查

| 改动 | case |
| --- | --- |
| 数据与页面 | metrics、collector-session、composer、composer-fold、ai-rename、width、table-sort、files、accent |
| 启动与恢复 | diagnostics、diagnostic-worker、management、relaunch、session-activity、updates、supervisor、launcher-5、launcher-7、entry-wrappers |
| 原生交互 | native-close、native-exit、native-countdown、native-recovery-guard |
| 跨模块 | i18n、relocation、multi-window、structure |
| 运行历史 | observability（存储、并发退让、5 天保留、只读查询、脱敏、业务映射与包内容） |
| 本机提示词 | prompt-manager、prompt-updates、prompt-diagnostics；公开源码副本不提供 |

`interface/`、`lifecycle/`、`prompts/` 存域内检查，`integration/` 覆盖跨域，`helpers/` 仅含测试自建窗口的捕获工具。

`composer-fold` 验证空白聊天、草稿、附件、正在运行与原生交互的保护，以及两种收起、双按 Enter 唤醒、动画反转和减少动态效果。分段控件的键盘选择、保存、撤销、重做和跨窗口同步由 `multi-window` 覆盖。

`width` 覆盖正文宽度和表格独立排版：总开关关闭时移除全部表格排版、重新开启时恢复、单独关闭居中后恢复原生起始对齐并保留列宽增强、768–1600px 正文变化不拉伸表格、短数据列 20px / 长文字列 32px 间距、流式内容变化后重新选择间距、短列和数字紧凑、说明列展开与舒适换行、窄窗多长列保留可读下限并局部滚动、分栏边界、新表格挂载与文本节点增长/缩短、几何缓存复用及字体变化重测、多面板和未知布局隔离、原生操作/对齐保留及停止还原。额外覆盖按整行换行收益扩展说明列、实际行高下降、短列不变、孤立长值、多长列共用预算、嵌套段落/显式换行、正文宽度独立、窄窗边界与内容缩短释放宽度；另覆盖六列长说明表的整表上限、大屏两侧留白、超宽屏保持宽度、字体放大后的绝对上限及窄窗滚动/可读下限。全部使用合成页面，不替代现用聊天表格的视觉确认。

`table-sort` 使用合成页面验证总开关关闭时移除全部排序入口、重新开启时恢复，以及智能、默认升序、默认降序三种首次方向、智能模式下的编号判断、显式模式覆盖编号判断、三态恢复、Ctrl 按键区段重建优先级、Alt 预设/反向及其保留、大小图标和优先级数字、仅在控件增加自然列宽时浮动/按需显示、正文已有足够空间时保持常显、悬停/聚焦/组合排序不撑宽、内容增长/缩短时重新判断及几何缓存复用、窄窗与双倍像素密度下优先级不遮字、复制/展开按钮在常规和窄窗口保持原生表头右侧布局、容器与末列标题留白，以及悬停、聚焦、点击和键盘操作，以及中文和数值/货币/百分比/单位比较、缺失值和稳定同值顺序，以及原始节点顺序、文字、模拟模型数据和原生链接事件不变；还覆盖不同行高、窄窗、流式追加、表头重绘、键盘与语言切换、规则表格边界和停止还原。`table-sort` 与 `width` 均覆盖 Codex 容器类名的旧下划线及新连字符形式，避免只有合成旧结构通过。`multi-window` 同时核对表格总开关、居中和排序方向偏好同步、排序模块的安装、旧语言包残留后的键名现象及语言包与表格模块同步重载、窗口隔离、重载与停止清理。测试不发送真实模型消息，不以模拟数据不变代替真实上下文链路验收。

## 运行

从项目根执行，例如：

```powershell
python -B -X utf8 scripts/check.py --list
python -B -X utf8 scripts/check.py metrics --work .validation-runtime/metrics
python -B -X utf8 scripts/check.py composer --work .validation-runtime/composer --dependencies .runtime/token-hud/embedded/settings.json
```

Playwright 仅用于启动和操作隔离的 Edge 测试窗口，可单独执行 scripts/Install-NodeDependencies.ps1 安装。也可指定依赖 JSON 或 HUD_PLAYWRIGHT；runner 不修改运行设置。按实际改动选择 case，工作目录须在本副本 .validation-runtime/ 内。源码版本与 runner/测试必须配套。

## 副作用与验收边界

observability 使用隔离 SQLite、子进程写锁/并发写入、只读文件属性和合成体检/页面快照，覆盖幂等与独立发生身份、schema、缺口恢复、CLI、敏感字段及发行集合 ZIP；不连接现用 Codex/HUD，不执行真实恢复。数据库目录不可写且健康状态也无法保存时，查询只报告 unknown 和非连续覆盖。

登记 case 只使用合成数据、mock 或显式原生预览。多窗口使用独立 Edge、原生 WebSocket 连接层和假日志，覆盖窗口刷新、拒绝非目标文档、停止清理及浏览器断线；迁移操作隔离 APPDATA 下的快捷方式及内部 junction；原生测试只操作自己创建的窗口。native-exit 验证未登记系统重启的自建进程可以正常退出，以及拒绝退出的进程保持存活，清理只回收自建进程。不得把现用 Codex、HUD 或其他任务作为可重启的测试对象。

`metrics` 还使用合成网关记录和 mock 本机 opener 覆盖 magpie 数据源：显式与 XDG/default settings 路径、固定查询、0.75 秒和 2 MiB 边界、聊天 ID 与 `response_id` 精确关联、provider/model 路由、旁路/后台/子代理/失败过滤、输入缓存与输出计时口径、`ttft_ms` 边界、原生 route 速度汇总、同 route 恰一条精确关联记录、`calls=1`/`decode_n=1`/`decode_out`/`decode_ms` 边界、TTFT 与 TPS 独立缺失、本轮首次 TTFT 锁定、首个 canonical 无 response_id 时不冒充、20→500 条查找、每窗 8 个首次 TTFT scope、跨 15 分钟首样本和失败回退缓存、重复身份、坏配置/传输/载荷时整份回退及恢复后重新采用。该 case 还核对 monitor 发布结果保留来源关联和新增 last 字段，不访问真实 magpie、Codex 或网络。

速度状态另覆盖 2 秒普通轮询、连续 3 次连接/传输失败确认离线、30 秒退避探测及恢复、HTTP 错误/坏格式不判定离线、单 route 失败冷却；每窗 8 个速度 scope、新轮清空、magpie 缺值/API 失败保留有效速度、同轮不切本地、离线后的新轮请求均速、恢复后的下一轮切回 magpie，以及 `calculate_speed=False` 保留关联与计时但暂停逐日志测速。检查还拒绝跨来源、跨轮次、跨模型和未来速度，并覆盖 magpie 速度跨最近响应 15 分钟过期保留。

`composer` 使用合成页面核对无标签数值顺序（TTFT 值 → TPS 值 → 缓存比例 → 相对时间）、`0s`/`1s`/`2min` 等英文相对时间单位、本轮首次 TTFT 固定、速度悬停随来源切换、magpie 有效速度保留与新轮清空、响应过期时保留 TTFT 和 magpie 速度、本地模式请求均速、跨模式/跨轮次/跨模型拒绝、缺失不借本地算法、切聊和清除；另覆盖 DeepSeek 长名称下的优先居中、碰撞避让、双侧受限时仅显示 TTFT/TPS、隐藏字段继续更新、空间恢复及布局变化不清空绑定与统计。不连接真实 Codex。

`composer` 还检查原生斜杠菜单的 Skills / Prompt 标题、自然排序及三列排列、目录增删改在重开后生效、非适用文件过滤、去掉 frontmatter、将正文插入草稿而不发送，以及普通方向键和 Ctrl+↑/↓ 的逐行／跨组导航。新对话没有原生菜单时，单独检查 `/查询` 打开的三列 Prompt 菜单、名称过滤、鼠标与键盘插入，以及原生菜单或总开关关闭时立即移除。未识别的原生结构和总开关关闭时都必须完整还原。Prompt 文件与编辑器均为测试自建，不使用真实提示词或草稿。

`ai-rename` 使用合成历史库、rollout、固定模型响应和独立浏览器验证：会话来源与消息提取、标题格式、侧栏入口与目标绑定、不同聊天并发、同一聊天去重、快速通道与轮询不重复领取、乱序失败互不影响，以及 App Server 写入后核对标题。另用隔离子进程检查成功、超时、取消和管道错误后的 CLI 退出，以及备用 App Server 忽略 EOF 时的回收。检查不读取现用聊天正文、不发送真实模型消息，不替代真实 Luna 与桌面验收。

项目批量入口还覆盖折叠分组、临时聊天 ID、按活跃状态和中文冒号筛选、限制并发，以及保存前跳过已变动的标题。

`collector-session` 使用合成子进程覆盖采集器失败预算、旧 PID 拒收、退出恢复和停止清理；`i18n` 覆盖目录键一致性、占位符、引用键及隔离的本地化安装失败，不执行安装或打开对话框。

`multi-window` 还验证无可用统计时两个窗口保持 TTFT/TPS 缺失、缓存隔离、重复切聊不串窗，以及单个采集器退出后原 HUD 与宽度保留、只恢复该窗口的采集器；不重启生产控制器或现用 Codex。

diagnostics 覆盖隐藏/无窗口、可见窗口响应失败及进程身份变化；entry-wrappers 使用隔离包装器和模拟原生自启动登记，覆盖双入口冲突、关闭、策略状态及读取失败，不修改真实启动项。

launcher-5/7 覆盖旧管理员偏好不影响普通启动、只读检查、监测及恢复；relocation 验证旧管理员快捷方式迁回商店身份并保留其他设置。

diagnostics 还覆盖网关按所选 provider 选择目标、忽略未选 magpie、IPv6 与监听地址匹配，以及启动等待的无接入跳过、就绪即停、超时及坏配置；launcher-5/7 覆盖仅冷启动调用等待、已有实例/只读/监测/重载派发跳过，以及 helper 失败继续激活。

diagnostics 还覆盖真实 Windows 读句柄造成的报告替换冲突和持续写入拒绝的有限重试；diagnostic-worker 在不显示窗口的真实体检类中，使用自建子进程和合成报告检查提前退出、读取占用下的超时及退出时的最终结果，不调用真实探针或恢复。另覆盖增强等待内容与正常后台合并后的深浅色绿色状态，以及未知、警告、失败与原始证据的保留。

diagnostic-worker 同时验证结果刷新保留八行控件及窗口句柄、更新文字和建议、清除旧建议，以及 DPI 变化时释放并重建行；这些隔离检查不替代真实桌面的闪烁观察。

窗口空间不足时，`diagnostic-worker` 用较矮的工作区及带建议和确认按钮的合成报告验证：窗口不越界，八行可纵向滚动，底部操作不被覆盖；内容收紧后能放下则不显示滚动条。

diagnostic-worker 还通过合成结果和模拟单调时间验证通过后 30 秒关闭窗口、刷新不延后、重新检测重置、不适用项兼容、挂起保护，以及未完成、异常或恢复期间不自动关闭；不调用真实检测或恢复。

management 覆盖提示词 watcher 在首份快照后启动时重新核验、始终未确认时有限结束，以及只有通知登记未知、主动禁用或正文变化时不等待；使用合成快照、应用就绪事件和模拟时钟，不启动真实 watcher。

management 还验证 run 执行阶段异常在清理已知 result 文件后仍可读取、异常消息与绝对路径不落盘、failure 留存写入失败不替换原异常，以及成功检查不创建 failure.json。检查使用合成异常和临时目录，不启动真实体检或恢复。

真实模型脚本未登记，不能混入日常批量检查；其既有 fixture 仍在 prompts/model_instructions_file/.validation-runtime/，需按提示词说明单独清理，--report 不改变该位置。源码包包含公开域测试，便携包不含测试，本机提示词测试随本机模块维护。过程文件清理前核对 junction 目标，保留脱敏结果；隔离通过不代表真实未来升级、全部 DPI 或长期运行通过。

独立通道实验 `verify_channels_without_guidance` 与主动汇报实验 `verify_spontaneous_commentary` 使用根 .validation-runtime/ 下全新的隔离目录，均需明确的真实模型测试授权，不进入日常 runner。前者检查删除说明后两个通道仍可使用，后者用没有汇报提示的任务观察主动 commentary 频率；操作与验收边界见[基础指令维护](../prompts/model_instructions_file/README.md#验证与验收)。
