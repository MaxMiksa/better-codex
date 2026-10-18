# Local data and privacy / 本地数据与隐私

Better Codex processes data on your computer. It does not add a model proxy, send analytics, read login credentials, or change Codex's model connection settings. Dependency installation uses Python/npm registries.

The collector reads Codex's local session index, session records and read-only state database. Those source files may contain conversation content; parsing local event records does not mean the process never encounters that content. Better Codex does not export conversation bodies or copy full logs into its own status files. Statistics and discovery metadata can include conversation identifiers, titles, paths, timestamps, model labels from local records and token counts. Model labels are not proof of the model that served a request.

The display connection inspects local interface structure and selected-chat metadata. If a client-side temporary ID needs matching, the title is compared in memory against the local index. It is not sent to a remote service. The display interface binds to `127.0.0.1`; another local process with access could inspect or control the app. Do not expose or forward that port.

Settings, diagnostic metadata, statistics and shortcut backups stay under `.runtime/`. These files are excluded from releases. Please report the app version, visible symptom and error category rather than uploading this folder, authentication files, raw logs or screenshots containing private text.

停止增强功能使用 `Stop.cmd`，不会退出 Codex。工具的设置、统计、聊天标识及标题等运行信息留在 `.runtime/`。原始会话记录可能含正文，本地解析不等于从未接触内容；工具不把完整聊天正文或完整原始日志导出到状态文件。请勿在公开 Issue 中上传运行目录、认证文件、原始日志或含私人内容的截图。
