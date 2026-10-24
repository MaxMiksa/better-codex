# Local data and privacy / 本地数据与隐私

Better-Codex processes data on your computer. It does not add a model proxy, send analytics, read login credentials, or change Codex's model connection settings. The portable launcher does not download dependencies. Building a portable package and installing from the optional source ZIP use official runtime/package download sources. Codex model traffic still uses its existing network connection.

The collector reads Codex's local session index, session records and read-only state database. Those source files may contain conversation content; parsing local event records does not mean the process never encounters that content. Better-Codex does not export conversation bodies or copy full logs into its own status files. Statistics and discovery metadata can include conversation identifiers, titles, paths, timestamps, model labels from local records and token counts. Model labels are not proof of the model that served a request.

The display connection inspects local interface structure and selected-chat metadata. If a client-side temporary ID needs matching, the title is compared in memory against the local index. It is not sent to a remote service. The display interface binds to `127.0.0.1`; another local process with access could inspect or control the app. Do not expose or forward that port.

Settings, diagnostic metadata, statistics and shortcut backups stay under `.runtime/`. These files are excluded from releases. Please report the app version, visible symptom and error category rather than uploading this folder, authentication files, raw logs or screenshots containing private text.

停止增强功能使用 `Stop.cmd`，不会退出 Codex。工具的设置、统计、聊天标识及标题等运行信息留在 `.runtime/`。原始会话记录可能含正文，本地解析不等于从未接触内容；工具不把完整聊天正文或完整原始日志导出到状态文件。请勿在公开 Issue 中上传运行目录、认证文件、原始日志或含私人内容的截图。

Startup diagnostics inspect local app, session, permission and network conditions. A bounded HTTPS HEAD request checks transport through the detected proxy path without model credentials or a model message; HTTP reachability does not establish model authentication. Reports omit chat identifiers, titles, credentials and proxy authentication. Recovery stores necessary package/process identity and cancellation metadata locally, and requests only normal app exit after rechecking the target.

启动体检读取本机启动、会话、权限和网络条件，并沿检测到的代理路径发送有限的 HTTPS HEAD 探针，不带模型凭据、不发送模型消息；网络可达不等于模型鉴权成功。复制报告不包含聊天标识、标题、凭据和代理认证信息。恢复所需的包、进程身份及取消元数据只保存在本机，执行前重新核对目标，仅请求正常退出。
