# 共用底座（`src/platform/`）

提供上层共用的底层机制，不决定产品业务策略；依赖严格单向指向本层，本层不得导入 `app`、`runtime`、`features` 或 `lifecycle`。

## 模块职责

| 目录 | 职责 |
| --- | --- |
| `codex/` | 官方商店包发现、进程/监听端口核验、主题字段读取与 `BetterCodexNative.exe` 调用封装 |
| `settings/` | 跨进程锁内合并的扁平配置存储（`.runtime/settings.json`）、旧配置自动无损迁移与源码摘要计算 |
| `i18n/` | 单一中英文词表 `messages.json` 及 Node / PowerShell / C# 轻量适配 |
| `observability/` | 基于 Node 24 内置 `node:sqlite` 的 5 天脱敏运行历史存储与只读 JSON 查询（[契约](observability/README.md)） |
| `windows/` | 基于 `BetterCodexNative.exe` 的 Restart Manager 优雅退出封装 |
| `paths.cjs` / `paths.ps1` | 定位安装根与扁平 `.runtime/`（`settings.json`、`state/`、`launchers/`） |

## 持久状态契约

- `.runtime/settings.json` 保持扁平 JSON 结构，保留未知字段，读取失败保持最后有效值。
- 首次从 v0.5.x 升级时，自动无损迁移 `.runtime/token-hud/embedded/settings.json` 与恢复取消记录，同时原样保留旧目录作为备份。
- 校验入口：`node scripts/check.mjs structure i18n observability native-exit`。
