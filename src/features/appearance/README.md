# 主题与 Custom 配色修正（`appearance`）

当用户在 Codex 中选用 Custom 自定义主题色时，自动计算可读的黑白前景文字对比度，修正用户消息气泡与输入框主按钮的可读性；原生预设配色保持不变。

## 交互契约

- 仅通过注入局部 CSS 变量覆盖 `custom` 主题模式，不修改 Codex 配置文件、聊天内容或预设主题。
- 根据 WCAG 相对亮度计算气泡与主按钮前景（纯白/纯黑），并实时响应浅色/深色主题切换；关闭开关或停止增强立即移除样式表还原原生配色。

## 模块与验证

- `ui/`：`custom-accent.ts`
- `host/`：`chrome-theme.cjs`、`Set-CustomAccent.ps1`
- 校验命令：`accent`、`multi-window`
