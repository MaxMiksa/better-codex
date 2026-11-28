# 运行管理（`src/lifecycle/`）

负责官方 Codex 激活、快捷方式维护、启动体检、更新发现与可取消的优雅恢复策略。底层系统原语均由 `src/platform/` 与 `BetterCodexNative.exe` 提供。

## 目录分工

| 目录 | 职责 |
| --- | --- |
| `startup/` | 官方商店应用普通激活、停止增强与本机 `magpie` 模型网关探测 |
| `installation/` | 项目/任务栏/登录快捷方式维护（兼容自动接管旧版包装器）与源码目录迁移 |
| `diagnostics/` | 8 行固定体检界面（`StartupCheckDialog.cs`）、10 项底层检查与脱敏报告 |
| `recovery/` | Codex 版本升级监测、基于 `node:sqlite` 的运行中会话防打断核查与 15 秒可取消恢复 |

## 常用命令（相对项目根目录）

| 操作 | 命令 |
| --- | --- |
| 联合启动 / 只读检查 | `.\src\app\Start-ComposerHud.ps1` / `.\src\app\Start-ComposerHud.ps1 -CheckOnly` |
| 停止增强 | `.\src\lifecycle\startup\Stop-ComposerHud.ps1` 或 `.\Stop.cmd` |
| 打开启动体检 | `.\src\lifecycle\diagnostics\Show-StartupCheck.ps1`（开发预览加 `-Preview`） |
| 开机自启开关 | `.\src\lifecycle\installation\Set-LoginStartup.ps1 -Mode Enable \| Disable \| Status` |
| 更新监测开关 | `.\src\lifecycle\recovery\Set-UpdateRecovery.ps1 -Mode Enable \| Disable \| Status` |
| 查询最近 5 天运行历史 | `.\src\platform\observability\Get-RuntimeHistory.ps1` |
| 源码目录迁移修复 | `.\src\lifecycle\installation\Repair-WorkspacePaths.ps1 -Mode Prepare \| Check \| Apply \| Finalize` |

## 核心保护

- 启动体检默认最小化，仅存在异常、需注意、待确认或需恢复时展开且不抢焦点；全部通过且无需恢复时 30 秒后自动关闭。
- 恢复倒计时 15 秒，随时可按 `X`/`Esc` 取消；执行前先通过 `state_5.sqlite` 保守核查活跃任务，发现任务运行中或无法确认空闲时自动阻止重开；退出只用 Restart Manager 普通关闭，绝不强制终止。
- 验证入口：`node scripts/check.mjs diagnostics diagnostic-worker management relaunch session-activity updates supervisor launcher-5 launcher-7 native-close native-exit native-countdown native-recovery-guard relocation`。
