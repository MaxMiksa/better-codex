# 斜杠命令菜单与 Prompt 插入（`command-menu`）

增强 Codex 原生顶层 `/` 斜杠菜单：命令横排分组、本地 Skills 显隐与三列网格、Codex Home `prompts/` 目录 Markdown 快捷插入，以及新对话独立三列菜单。

## 交互与口径契约

- **范围隔离**：仅接管已确认顶层 `/` 菜单或对应输入框的键盘导航，不干扰 `@`/`$` 提及、子菜单、其他输入框或侧栏菜单；总开关关闭即时还原原生菜单。
- **命令、Skills 与 Prompt**：
  - 命令区保留固定 16px 图标占位，防延迟挂载引起横跳；支持设置中拖拽组序/项序与逐项显隐。
  - Skills 按需复用当前输入框的本地技能查询缓存，支持设置页逐项显隐（不影响原生 `$` 选择器），选择后仅插入真实技能引用，不发送。
  - Prompt 打开 `/` 时按需读取 Codex Home 一级 `prompts/*.md`（跳过隐藏/链接/非 UTF-8/>256 KiB），去掉开头的 YAML frontmatter 后插入当前光标位置，不覆盖草稿、不发送。
- **键盘导航**：方向键同行/逐行移动并记住期望列，`Ctrl+↑/↓` 在命令组、Skills、Prompt 之间快速跨组跳转。

## 模块与验证

- `shared/`：`command-catalog.ts`（UI 与宿主共用的唯一命令目录定义）
- `ui/`：`command-menu.ts`、`command-menu.css`
- `host/`：`prompt-directory.cjs`
- 校验命令：`composer`、`multi-window`
