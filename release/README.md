# 发行内容边界

打包使用 [public-files.json](public-files.json) 的显式集合，不按代码后缀递归扩大范围。

## 内容归属

| 集合 | 用途 |
| --- | --- |
| runtime | 两种公开包共享的产品运行文件与必要说明 |
| sourceExtras | 仅源码包增加的公开测试、runner 与模块说明 |
| localOnly | 本机保留范围声明，不是产品开关或自动导出集合 |

scripts/package.py 导出 runtime + sourceExtras；scripts/build-portable.py 只导出 runtime，再加入 scripts/portable-lock.json 锁定的运行环境和许可。src/prompts/、根 prompts/、内部状态和私人研究材料不公开；成品图逐文件列出，不导出整个素材目录。

可选预览器由 [Preview](https://github.com/MaxMiksa/preview) 单独发行。Better-Codex 只发布文件树适配器和[接入说明](../src/interface/workspace_tree/preview/README.md)，不再构建预览器或为后续发行附加它的 ZIP；历史附件保留。

产品内运行历史的 Python/PowerShell 实现、稳定查询入口和必要契约进入 runtime，隔离测试进入 sourceExtras。`.runtime/` 中的 SQLite、WAL、SHM、记录器健康状态及查询导出均不打包；源码实现完成不代表已经随版本发行。

## 文件变更与候选验证

新增运行文件时同步清单；迁移文件时同时调整稳定桥、调用方和清单，许可随实现保留必要兼容位置。文档链接也须能在对应源码包或便携包内解析，不能让公开入口依赖本机 PROJECT 或私人提示词文件。

构建在隔离源码副本执行，避免覆盖主工作区保留的正式发行 ZIP。scripts/verify-package.py 校验实际双包的精确集合、字节、依赖摘要及 --check / --prepare-only 和隔离目录移动；工作目录须是本副本 .validation-runtime/ 下尚不存在的目录。它不执行 launch、stop 或 Codex 恢复。

构建、源码合入、实际加载与公开发行分别记录。用户未要求发布时只保留本地候选和证据，不推送或替换现有发行附件。命令见[开发说明](../docs/DEVELOPMENT.md)。
