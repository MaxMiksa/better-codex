# 发行内容边界

打包脚本基于 [scripts/package.mjs](../scripts/package.mjs) 的目录发现与显式排除规则自动确定发行范围，不再维护手工文件白名单。

## 打包规则

- **源码包（`scripts/package.mjs`）**：收录全部运行源码、入口文件、说明文档、测试与构建工具；自动排除 `.runtime/`、`.validation-runtime/`、`dist/`、`node_modules/`、`__pycache__/`、临时验证数据及任何私有标记目录。
- **便携包（`scripts/build-portable.mjs`）**：仅收录运行所需文件，并附加 [scripts/portable-lock.json](../scripts/portable-lock.json) 锁定哈希的离线运行环境与原生启动器 `BetterCodex.exe`。
- **外部生态**：可选原生预览器由独立项目 [Preview](https://github.com/MaxMiksa/preview) 发布，Better-Codex 仅内置其轻量桥接适配。

## 版本与验收

- 根目录 `package.json` 的 `version` 是唯一版本号来源；发版前运行 `pnpm run sync:version` 自动同步中英文 README 徽章与下载链接。
- 候选构建在 `.validation-runtime/` 隔离暂存目录完成，通过 `scripts/verify-package.mjs` 核对双包内容、哈希、离线预检与含空格/中文路径迁移。
- 源码验证通过与本地热加载不等于自动发版；仅在用户明确要求发版后发布，且不覆盖旧标签或旧发行附件。
