# 源码地图

实现按界面增强、运行管理和本机提示词定制组织，app 组合功能，platform 提供共用机制。本机维护副本的当前状态以根 PROJECT.md 为入口；该文件及私人提示词不随公开包导出。

## 按改动定位

| 目录 | 负责什么 | 入口 |
| --- | --- | --- |
| app/ | 联合启动、便携入口、唯一 supervisor 装配 | [应用装配](app/README.md) |
| interface/ | 每窗统计、正文宽度、文件列表、配色与 AI 重命名 | [界面增强](interface/README.md) |
| lifecycle/ | 启动、安装、体检、更新发现与恢复 | [运行管理](lifecycle/README.md) |
| platform/ | 安装根、程序身份、Windows 原语、设置、语言及本机运行历史机制 | [共用机制](platform/README.md) |
| prompts/（仅本机） | 指令管理与监测程序；根 prompts/ 持有内容、批准和部署 | 仅在本机维护副本提供 README 和规则 |

## 依赖与进程边界

依赖方向为 app → 功能域 → platform。基础层不导入业务域；恢复通过稳定命令协议重入完整启动入口，不点源 app 内部函数。

app/supervisor.py 是唯一后台宿主。界面连接拥有 Node 控制器，每个窗口拥有自己的采集器；采集故障局部恢复。体检窗和已经开始的正常退出/恢复动作独立于后台退出，不能被通用进程清理打断。

运行历史是产品能力，不按本机私有功能裁剪。通用事件/SQLite/只读查询归 platform/observability；lifecycle/runtime_events.py 和 interface/runtime_events.py 解释业务状态，由现有 app 装配，不增加第四业务域、常驻事件总线或外部监控平台。存储、5 天保留和查询参数见[运行历史契约](platform/observability/README.md)。

## 外部命令与验证

已登记命令保留在 [tools/token-hud-local/](../tools/token-hud-local/)，作为进入本目录的单向桥；参数、退出码、导入身份及旧动态路径属于兼容契约。Python 内部模块使用 src 包导入，外部使用稳定桥，不直接按文件路径运行需要包导入的内部模块。

检查从项目根的 scripts/check.py 进入，分类见 [tests/README](../tests/README.md)。打包范围由 [发行清单](../release/public-files.json)明确列举；新增或迁移实现时同步入口、清单与对应测试。
