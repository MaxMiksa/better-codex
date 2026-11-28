# 验证体系（`tests/`）

全部验证由纯 Node.js 24 与 PowerShell 驱动（零 Python 依赖），统一从项目根目录通过 `scripts/check.mjs` 执行，所有临时目录隔离在 `.validation-runtime/` 内，绝不发送真实模型消息、绝不重启现用 Codex。

## 常用命令

```powershell
# 查看全部注册的检查套
node scripts/check.mjs --list

# L1：单特性秒级自测
node scripts/check.mjs composer-fold --work .validation-runtime/fold --dependencies .runtime/settings.json
node scripts/check.mjs workspace-tree --work .validation-runtime/tree --dependencies .runtime/settings.json

# L2：全量隔离回归（28 套检查）
node scripts/check.mjs --all --work .validation-runtime/all --dependencies .runtime/settings.json

# L3：源码包 + 便携包双包验包（30 项检查）
pnpm run release:prepare
```

## 测试分层

| 目录 | 覆盖范围 |
| --- | --- |
| `tests/interface/` | 8 个前端特性与统计采集器（`metrics`、`collector-session`、`composer`、`composer-fold`、`width`、`table-sort`、`files`、`workspace-tree`、`accent`、`ai-rename`） |
| `tests/lifecycle/` | 启动器（PowerShell 5.1 & 7）、体检、更新监测、会话活跃守卫、优雅恢复与原生窗交互 |
| `tests/integration/` | 单向依赖与自动打包结构检查（`structure`）、多窗口同步（`multi-window`）、多语言一致性（`i18n`）、运行历史（`observability`）、目录迁移与旧配置/快捷方式迁移（`relocation`）、Restart Manager 原生退出（`native-exit`） |
