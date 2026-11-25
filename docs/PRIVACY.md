# Local data and privacy / 本地数据与隐私

Better-Codex processes data on your computer. It does not add a model proxy, send analytics, read login credentials, or change Codex's model connection settings. The portable launcher does not download dependencies. Building a portable package and installing from the optional source ZIP use official runtime/package download sources. Codex model traffic still uses its existing network connection.

The collector reads Codex's local session index, session records and read-only state database. Those source files may contain conversation content; parsing local event records does not mean the process never encounters that content. Better-Codex does not export conversation bodies or copy full logs into its own status files. Statistics and discovery metadata can include conversation identifiers, titles, paths, timestamps, model labels from local records and token counts. Model labels are not proof of the model that served a request.

If magpie is installed, the collector may read `$XDG_CONFIG_HOME/magpie/settings.json` (or `~/.config/magpie/settings.json`) for its local port and query `http://127.0.0.1:<port>/v1/magpie/usage/requests` with the selected Codex chat identifier. It does not use a proxy, follow redirects, read credentials, send model messages, or change model connection settings. The API may return account or request metadata; the collector keeps only an allowlist of measurement and identity fields needed to join a completed response and does not save account metadata or request bodies in its status files.

**AI rename is an explicit conversation-content model request.** When you choose it, Better-Codex reads the selected local chat's user messages and assistant final answers, then passes that transcript to the local official Codex CLI (`codex exec --ephemeral`, model `gpt-6-luna`, read-only sandbox) using the same Codex Home. The transcript is sent through Codex's existing model service to generate a title. Better-Codex does not add an API key or proxy, does not write the transcript or prompt to its status files, logs or runtime history, and does not send a chat message. Injected AGENTS/environment context, commentary, reasoning and tool output are excluded. If you do not want conversation-derived text sent for naming, keep using the native Rename command.

The display connection inspects local interface structure and selected-chat metadata. If a client-side temporary ID needs matching, the title is compared in memory against the local index. It is not sent to a remote service. The display interface binds to `127.0.0.1`; another local process with access could inspect or control the app. Do not expose or forward that port.

The workspace tree lists directories through the local Codex App Server. When you explicitly preview, open, or locate an item, Better-Codex passes the selected path to local PowerToys Peek or the Windows shell. It does not upload files or record opened paths in its logs. PowerToys and your default apps handle those files according to their own settings.

When the enhanced slash menu opens, Better-Codex reads eligible Markdown templates from the first level of Codex Home's `prompts` folder. It holds template text in local memory only; it doesn't include it in Better-Codex logs, status files or reports. Choosing a template inserts it into the current Codex draft without sending it.

Settings, diagnostic metadata, statistics and shortcut backups stay under `.runtime/`. These files are excluded from releases. Please report the app version, visible symptom and error category rather than uploading this folder, authentication files, raw logs or screenshots containing private text.

The source implementation also keeps a local SQLite runtime history for five days under `.runtime/token-hud/embedded/runtime/observability.sqlite3`. It stores version/launch/recovery observations, backend and enhancement state changes, and every completed or interrupted diagnostic's allowlisted states and reason codes. Technical identifiers such as process PIDs, event IDs and correlation IDs are retained; chat, session and account identifiers are excluded, along with chat bodies, titles, paths, credentials, account metadata, raw URLs, exceptions and logs. `observability-status.json` describes recorder health and the latest known recording gap. `tools/token-hud-local/Get-RuntimeHistory.ps1` queries it locally without probes or writes; no events are uploaded. Retention filters apply to reads and physical pruning happens on writes; SQLite free pages and WAL are not secure erasure. Only local databases, WAL/SHM and status files are excluded from release packages; feature code and its supporting files are included through runtime/sourceExtras. Source availability does not claim this feature has shipped in the current release.

源码中的运行历史把最近 5 天版本、启动、恢复、后台/增强状态变化及每次完整或中断体检的白名单状态/原因代码保存在上述本机 SQLite；保留进程 PID、事件编号和关联编号等技术标识，不保存聊天、会话或账户标识，也不保存聊天正文、标题、路径、凭据、账户元数据、原始 URL、异常或日志。轻量状态文件标明记录器健康与最近缺口，查询命令只读、不增加网络探测、不上传事件。查询过滤过期数据，物理清理由写入触发；空闲页和 WAL 不保证安全擦除。仅本机数据库、WAL/SHM 和状态文件不打包，功能代码与配套文件按 runtime/sourceExtras 进入产品发行范围；当前源码能力不代表已随公开版本发行。

停止增强功能使用 `Stop.cmd`，不会退出 Codex。工具的设置、统计、聊天标识及标题等运行信息留在 `.runtime/`。原始会话记录可能含正文，本地解析不等于从未接触内容；工具不把完整聊天正文或完整原始日志导出到状态文件。请勿在公开 Issue 中上传运行目录、认证文件、原始日志或含私人内容的截图。

工作区文件树通过本地 Codex App Server 列出文件。主动预览、打开或定位时，Better-Codex 将所选路径交给本机 PowerToys Peek 或 Windows 外壳，不上传文件，也不把打开的路径写入日志。PowerToys 和默认应用按各自的设置处理这些文件。

打开增强斜杠菜单时，Better-Codex 读取 Codex Home 中 `prompts` 一级目录下的可用 Markdown 模板。模板正文只留在本机内存，不写入 Better-Codex 的日志、状态文件或报告。选择模板只会插入当前 Codex 草稿，不会发送。

如果本机安装了 magpie，采集器会读取 `$XDG_CONFIG_HOME/magpie/settings.json`（未设置时为 `~/.config/magpie/settings.json`）中的本机端口，并用所选 Codex 聊天标识查询 `http://127.0.0.1:<port>/v1/magpie/usage/requests`。该请求不使用代理、不跟随重定向、不读取凭据、不发送模型消息，也不修改模型连接配置。接口响应可能带有账户或请求元数据；采集器只保留完成响应关联所需的统计与标识字段，不把账户元数据或请求正文保存到状态文件。

**AI 重命名会在你点击后发起含会话内容的模型请求。** Better-Codex 读取所选本地聊天的用户消息与助手最终回复；模型输入只包含用户消息和每条最终回复的第一句话。标题由同一 Codex Home 下的官方 Codex CLI（`codex exec --ephemeral`，模型 `gpt-6-luna`，只读沙箱）生成。该内容经 Codex 现有模型服务发送；本项目不增加 API 密钥或代理，不把会话正文和提示词写入状态文件、日志或运行历史，也不发送聊天消息。注入的 AGENTS/environment 上下文、commentary、推理和工具输出不纳入。若不愿发送由聊天内容派生的文本，请继续使用原生“重命名”。

Startup diagnostics inspect local app, session, permission and network conditions. A bounded HTTPS HEAD request checks transport through the detected proxy path without model credentials or a model message; HTTP reachability does not establish model authentication. Reports omit chat identifiers, titles, credentials and proxy authentication. Recovery stores necessary package/process identity and cancellation metadata locally, and requests only normal app exit after rechecking the target.

启动体检读取本机启动、会话、权限和网络条件，并沿检测到的代理路径发送有限的 HTTPS HEAD 探针，不带模型凭据、不发送模型消息；网络可达不等于模型鉴权成功。复制报告不包含聊天标识、标题、凭据和代理认证信息。恢复所需的包、进程身份及取消元数据只保存在本机，执行前重新核对目标，仅请求正常退出。
