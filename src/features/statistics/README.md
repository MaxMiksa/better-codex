# 统计条与统一设置面板（`statistics`）

在主输入区底栏提供四项实时统计（TTFT、TPS、缓存比例、相对时间）与统一界面设置面板，并负责会话统计采集。

## 交互与口径契约

- **统计展示**：默认顺序 `TTFT → TPS → 缓存 → 相对时间`，不显示 `TTFT`/`TPS` 字样；支持设置内拖拽排序与显隐（至少保留一项）；底栏空间受限时自动避让按钮与额度圆环，必要时退回前两项而不清空聊天绑定。
- **数据来源（magpie 优先、本地兜底）**：优先按 `thread id` + canonical `response_id` 精确匹配本机 `magpie` 统计接口（`http://127.0.0.1:<port>/v1/magpie/usage/requests`），连续 3 次传输失败后新轮次切换为本地请求边界均速；同一轮次不混用两种速度来源，不凭经验上限掩盖异常。
- **统一设置面板**：点击统计条打开（宽 360px，支持撤销/重做、恢复默认、自动保存与多窗口实时同步）；问题卡片或浮动输入区出现时自动隐藏 HUD 并关闭面板。

## 模块与验证

- `ui/`：`composer-strip.ts`、`composer-strip.css`、`panel-template.ts`（产物 `src/generated/ui/statistics.js`）
- `host/`：`chat-binding.cjs`、`metrics-view.cjs` 及 `collector/{metrics,history,magpie}.cjs`；每窗独立缓存，保留 `codex-token-hud` MIT 许可与版本。
- 本地兜底最短请求边界 50 ms，样本 15 分钟过期；magpie 确认离线后 30 秒再探测。TTFT 只绑定本轮首个 canonical 响应。
- 校验命令：`metrics`、`collector-session`、`composer`、`multi-window`
