# 源码地图

实现采用 **底座 + 自治特性插件（Feature-First）** 分层，所有依赖严格单向流动：`app → runtime / features / lifecycle → platform`。

| 目录 | 职责 | 入口说明 |
| --- | --- | --- |
| `app/` | 联合启动入口、便携启动器与后台装配 | [应用装配](app/README.md) |
| `runtime/` | CDP WebSocket 连接宿主、每窗调度与特性插件注册表 | [运行宿主](runtime/README.md) |
| `features/` | 8 个自治界面增强特性（每个含 `ui/` TS+CSS 源码与可选 `host/`） | 见下表 |
| `generated/` | 随包直用的浏览器注入产物与 Windows 助手 | 自动生成，勿手改 |
| `native/` | Windows 进程、Shell 与设置锁原语 | [原生助手](native/README.md) |
| `lifecycle/` | 官方普通激活、启动体检、更新监测与优雅恢复 | [运行管理](lifecycle/README.md) |
| `platform/` | 安装根、进程身份、Windows 原语、配置锁、多语言与运行历史 | [共用机制](platform/README.md) |

## 自治特性清单（`src/features/`）

| 特性目录 | 职责 | 说明 |
| --- | --- | --- |
| `statistics/` | 输入区统计条（TTFT/TPS/缓存/时效）、统一设置面板与会话采集 | [statistics](features/statistics/README.md) |
| `reading/` | 正文宽度、AI 回复字号、聊天标题居中、路径栏防抖、表格排版与排序 | [reading](features/reading/README.md) |
| `command-menu/` | `/` 横排命令分组、Skills 显隐与三列菜单、Prompt 快捷插入 | [command-menu](features/command-menu/README.md) |
| `composer-fold/` | 输入框最小化/完全隐藏、首键中文组字与展开动画 | [composer-fold](features/composer-fold/README.md) |
| `ai-rename/` | 侧栏与 `/` 入口的单条及项目批量 AI 重命名 | [ai-rename](features/ai-rename/README.md) |
| `workspace-tree/` | 当前工作区只读文件树、按需监听与 Preview/QuickLook/Peek 桥接 | [workspace-tree](features/workspace-tree/README.md) |
| `file-changes/` | 多文件更改卡片默认收起与手动展开状态保持 | [file-changes](features/file-changes/README.md) |
| `appearance/` | Custom 配色可读前景修正与主题读取 | [appearance](features/appearance/README.md) |

## 构建与校验

- 前端源码修改后运行 `pnpm run typecheck && pnpm run build:ui`，再通过 `pnpm run check` 运行对应隔离检查。
- 各特性之间禁止交叉导入；单特性初始化失败仅隔离自身，不影响其余特性或原生 Codex。
