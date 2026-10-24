# 运行管理

本目录负责启动、安装、体检与恢复策略。程序身份和 Windows 正常退出原语来自 platform，完整依赖预检及恢复决策留在本域。

## 按任务定位

| 目录 | 职责 |
| --- | --- |
| startup/ | 官方激活、管理员任务与兼容停止 |
| installation/ | 本机入口、登录启动和源码目录迁移 |
| diagnostics/ | 启动体检、报告、原生窗口和共用控件 |
| recovery/ | 更新发现、预检、取消/防重放和实际恢复执行 |

外部命令保留在 tools/token-hud-local/，参数、返回码、任务身份及状态路径继续兼容。恢复请求完整启动命令，设置入口通过 `-TaskMode Monitor` 消费 app 回执，不导入其内部函数。

## 常用命令

所有路径相对项目根目录；下表是用户操作参考，开发验证不执行真实启停。

| 稳定命令（tools/token-hud-local/ 下） | 模式与作用 |
| --- | --- |
| Start-ComposerHud.ps1 | 默认完整启动；`-CheckOnly` 只读检查 |
| Stop-ComposerHud.ps1 | 请求停止增强并移除界面，保留 Codex、偏好和已部署提示词 |
| Show-StartupCheck.ps1 | 打开真实体检；开发预览显式使用 `-Preview` |
| Set-ReadingWidth.ps1 | `-Mode Wide / Default`，设置界面正文宽度模式 |
| Set-CustomAccent.ps1 | `-Mode Enable / Disable / Status` |
| Set-LoginStartup.ps1 | `-Mode Enable / Disable / Status` |
| Set-AdministratorLaunch.ps1 | `-Mode Enable / Disable / Status / Verify` |
| Set-UpdateRecovery.ps1 | `-Mode Enable / Disable / Status` |
| Repair-WorkspacePaths.ps1 | `-Mode Prepare / Check / Apply / Finalize`，源码目录迁移，详见安装模块实现 |

新安装默认关闭登录启动、管理员启动及更新监测。登录启动由用户单独启用，应同时关闭 Codex 自身入口，避免无接口实例抢先启动；Windows 启动批准状态由系统管理，不覆盖用户禁用。

管理员入口首次申请 UAC，后续复用核实的当前用户 Highest 任务，每次全新启动动态定位包。它不能给已有实例补接口或提权；移动前取消旧管理员入口，移动后按需启用。

## 体检与恢复契约

联合启动异步打开统一体检，内部派发、只读检查和后台准备不重复弹窗。检查启动、本地历史、沙箱、VPN/代理及 HTTPS 传输、权限和增强状态，可重查与复制脱敏报告。它不发模型消息、不验证模型鉴权、不控制 VPN；legacy 沙箱不自动初始化账户或 ACL，未知条件保留待确认。

确认增强未加载或刚更新后，全部检测结束才开始按钮内 15 秒倒计时。点击立即执行，X/Esc 取消，Enter 不默认重开；挂起不暗中耗尽倒计时。同次更新/连续故障失败不循环。

执行前复核包、摘要、PID/创建时间、监听与依赖，仅用 Windows Restart Manager 请求已登记实例正常退出，拒绝退出则保留应用。体检窗与恢复执行独立于增强后台：已开始正常退出的执行器完成一次完整增强启动，不因窗口或后台关闭停在 Codex 已退出的中间状态。

## 更新、停止与入口状态

更新监测约每 15 秒读取注册版本，首次只建基线；升级且新版唯一主进程稳定运行至少 15 秒后转交同一体检。启用时先建立当前基线，不以启用动作授权重开已工作的旧实例。关闭监测不会取消已打开的倒计时，须在窗口 X 取消。

Stop 请求停止自有后台和子进程，不等于永久禁用。结合 supervisor 状态 stopped 与进程退出判断完成；下次联合入口可恢复。launch-receipt、后台状态与实际页面分别核对，不用旧回执推断当前正常。

快捷方式文件存在不代表系统已固定。完整入口和源码改名的维护流程在本机 launchers/README.md；安装身份、未知字段及持久取消记录均须保留。

## 验证

从项目根运行 scripts/check.py 的 `diagnostics`、`relaunch`、`updates`、`supervisor`、`launcher-5`、`launcher-7`、`native-close`、`native-countdown` 或 `relocation`。使用假进程、假网络、隔离入口或显式 Preview，不重启/停止现用 Codex 或 HUD；真实升级恢复与全部桌面条件仍需独立验收。
