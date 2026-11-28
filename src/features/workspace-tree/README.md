# 工作区文件树（`workspace-tree`）

在本地聊天主面板左侧提供只读工作区文件树，支持按需目录监听、按扩展名分组排序、筛选、拖拽调宽以及文件打开/定位/快速预览。

## 交互与安全契约

- **目录与归属**：独立挂载开源 Pierre Trees 渲染器；面板开关状态按项目记住，实际列出的目录始终严格绑定当前聊天的执行工作区（含 worktree），不混淆项目根与执行目录；收起目录即时释放监听，无后台轮询。
- **操作与预览链**：
  - 单击选中，空格预览，双击系统默认打开（脚本与可执行文件仅定位不直接执行），右键资源管理器定位，点击顶部项目名优先复用 Codex 原生“在资源管理器中打开”。
  - 预览使用配置的独立原生预览器 [Preview](https://github.com/MaxMiksa/preview)（支持大图、多格式图片、原生 PDF 与受控文本安全编辑）。Windows 助手提供显式 QuickLook / PowerToys Peek 动作；不会因失败自动重复派发已请求的原生预览。
- **布局保护**：与原生右侧面板同开时限制主聊天框不超过中间剩余列宽，防止左侧裁切；打开侧栏右键菜单时不卸载或重置当前文件树状态。

## 模块与验证

- `ui/`：`workspace-tree.ts`、`workspace-directories.ts`、`workspace-actions.ts`、`workspace-tree.css`、`workspace-trigger.css`、`tree-renderer.js`
- `host/`：`native-actions.cjs`、`preview-bridge.cjs`、`page-source.cjs`、`windows-paths.cjs`、`windows-shell.py`、`preview/`
- 校验命令：`workspace-tree`、`multi-window`
