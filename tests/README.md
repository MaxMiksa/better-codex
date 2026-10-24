# 隔离验证

验证按功能域归属。日常入口为项目根的 scripts/check.py，实际 case 以 [cases.json](cases.json) 和 `--list` 为准。

## 选择检查

| 改动 | case |
| --- | --- |
| 数据与页面 | metrics、collector-session、composer、width、files、accent |
| 启动与恢复 | diagnostics、relaunch、updates、supervisor、launcher-5、launcher-7 |
| 原生交互 | native-close、native-countdown |
| 跨模块 | i18n、relocation、multi-window、structure |
| 本机提示词 | prompt-manager、prompt-updates；公开源码副本不提供 |

`interface/`、`lifecycle/`、`prompts/` 存域内检查，`integration/` 覆盖跨域，`helpers/` 仅含测试自建窗口的捕获工具。

## 运行

从项目根执行，例如：

```powershell
python -B -X utf8 scripts/check.py --list
python -B -X utf8 scripts/check.py metrics --work .validation-runtime/metrics
python -B -X utf8 scripts/check.py composer --work .validation-runtime/composer --dependencies .runtime/token-hud/embedded/settings.json
```

需要 Node/Playwright 时可指定依赖 JSON；runner 只读取 python/node/playwright，不修改该文件。按实际改动选择 case，工作目录须在本副本 .validation-runtime/ 内。源码版本与 runner/测试必须配套。

## 副作用与验收边界

登记 case 只使用合成数据、mock 或显式原生预览。多窗口使用独立 Edge 和假日志；迁移操作隔离 APPDATA 下的快捷方式及内部 junction；原生测试只操作自己创建的窗口。不得把现用 Codex、HUD 或其他任务作为可重启的测试对象。

真实模型脚本未登记，不能混入日常批量检查；其既有 fixture 仍在 prompts/model_instructions_file/.validation-runtime/，需按提示词说明单独清理，--report 不改变该位置。源码包包含公开域测试，便携包不含测试，本机提示词测试随本机模块维护。过程文件清理前核对 junction 目标，保留脱敏结果；隔离通过不代表真实未来升级、全部 DPI 或长期运行通过。
