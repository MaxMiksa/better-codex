# AI 重命名（`ai-rename`）

提供单条聊天的 AI 智能命名（侧栏右键/「…」菜单首项与 `/` 菜单）及项目级「批量 AI 重命名」，通过本机官方 Codex CLI 调用 Luna 生成标题并由原生接口后台保存。

## 交互与隐私契约

- **唯一外发路径**：仅在用户主动触发后，将当前本地聊天的用户消息与每条助手最终回复首句经本机官方 Codex CLI（`exec --ephemeral -m gpt-6-luna -s read-only`，最低推理档 `low`）发往模型，不读 commentary/reasoning/工具输出，不将聊天正文落盘日志或状态。
- **命名与保存**：标题统一为 `类型：描述`（全角冒号，`feat`/`bug`/`ui`/`docs`/`refactor`/`chore`，总长 ≤ 24 字符）；通过 Codex App Server `thread/name/set` 原生保存并 `thread/read` 复核，不操作重命名弹窗。
- **并发与批量**：不同聊天可并发提交，同聊天处理中去重；项目批量仅处理当前侧栏分组下未删除、未归档且标题不含「：」的本地会话（含工作树会话），每批最多 3 路并行，保存前二次核对防覆盖；结束或超时后清理短时子进程，不触碰现用 Codex。

## 模块与验证

- `ui/`：`ai-rename.ts`、`ai-rename.css`
- `host/`：`ai-rename.cjs`、`rename-child.cjs`、`session-transcript.cjs`、`thread-title-api.cjs`
- 校验命令：`ai-rename`、`multi-window`
