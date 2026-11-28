# Windows 原生壳层（`src/native/`）

极薄 Windows 系统原语层，使用 Windows 11 内置的 `.NET Framework 4.8` 编译器（`csc.exe`）直接编译为单文件 `src/generated/native/BetterCodexNative.exe`（约 53 KB），零外部 SDK、零 Python 依赖。

## 提供的子命令（统一 UTF-8 JSON 输出）

| 子命令 | 职责 |
| --- | --- |
| `codex-package` | 核验官方 Codex 商店应用安装与版本 |
| `codex-processes` | 枚举官方 Codex 进程（PID、内核创建时间、命令行、窗口可见与响应状态） |
| `process-alive` | 按 PID + 精确创建时间防复用核验存活 |
| `port-listeners` | 枚举回环端口监听进程与身份 |
| `graceful-close` | 通过 Windows Restart Manager 请求非强制优雅关闭（拒绝退出时保留应用） |
| `shell-action` | 工作区文件打开、资源管理器定位、QuickLook 命名管道核验与 PowerToys Peek 调用 |
| `shortcut-install` / `shortcut-inspect` | 读写 `.lnk` 快捷方式与 `AppUserModelID`，触发系统外壳刷新 |
| `system-theme` | 读取当前 Windows 浅色/深色系统主题 |
| `settings-lock` | 跨进程配置文件锁原语 |

## 构建与校验

- 构建：`pnpm run build:native`
- 校验：`node scripts/check.mjs native-exit --work .validation-runtime/native-exit`
