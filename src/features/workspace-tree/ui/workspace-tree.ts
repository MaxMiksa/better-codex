// Our dock mounts the public Pierre renderer, never Codex's file page.
import { createWorkspaceActions } from './workspace-actions';
import {
  createWorkspaceDirectories,
  createWorkspaceTransport,
  type WorkspaceDirectoriesController,
  type WorkspaceTransport,
} from './workspace-directories';
import treePanelStyles from './workspace-tree.css';
import triggerStyles from './workspace-trigger.css';

interface LayoutScope {
  page: Element;
  id: string | null;
  content: Element;
  dock: Element;
  slot: Element;
  composer: Element | null;
}

interface WorkspaceBinding {
  scope: LayoutScope;
  projectSelection: string | null;
  pending: boolean;
  intent: boolean | null;
  root: string | null;
  key: string | null;
  projectId?: string;
  name?: string;
  named?: boolean;
  native?: boolean;
  transport: WorkspaceTransport;
}

interface WorkspaceView {
  root: string;
  key: string | null;
  name?: string;
  named?: boolean;
  tree: InstanceType<typeof bcTreeRenderer.FileTree> | null;
  dirs: WorkspaceDirectoriesController | null;
  unsubscribe: (() => void) | null;
  expansionFrame: number;
  pathCount: number;
  error?: boolean;
  updating?: boolean;
  displayStatus?: () => void;
}

interface WorkspaceSurface {
  pane: HTMLElement;
  input: HTMLInputElement;
  status: HTMLDivElement;
  wrap: HTMLDivElement;
  separator: HTMLDivElement;
  notice: HTMLDivElement;
  suspended?: boolean;
  sizer: {
    mount(dock: Element): void;
    draw(): void;
    cancel(): void;
    dispose(): void;
  };
}

const ACTIVE_SELECTOR = '[data-app-shell-active-page="true"]';
const TOOLBAR_SELECTOR = '[data-app-shell-main-titlebar] [data-app-shell-header-toolbar]';
const THREAD_MARKER = '[data-above-composer-conversation-id]';
const MAIN_SELECTOR = '[data-app-shell-main-surface]';
const CONTENT_SELECTOR = '[data-app-shell-main-content-layout]';
const COMPOSER_SELECTOR = '[data-codex-composer-root]';
const RIGHT_PANEL = '[data-app-shell-focus-area="right-panel"]';
const SIDEBAR_ROW = '[data-app-action-sidebar-thread-id]';
const SIDEBAR_PROJECT_ID = 'data-app-action-sidebar-project-id';
const SIDEBAR_PROJECT_LABEL = 'data-app-action-sidebar-project-label';
const ID_PATTERN = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const EXCLUDED = '[inert],[aria-hidden="true"]';
const PERSISTENT_BLOCK =
  '[inert]:not([data-inert-ed]),[aria-hidden="true"]:not([data-aria-hidden])';

const STORAGE_PREFIX = 'better-codex:workspace-tree-open:';
const WIDTH_KEY = 'better-codex:workspace-tree-width';
const DEFAULT_WIDTH = 300;
const MIN_WIDTH = 180;
const MAX_WIDTH = 720;

const FALLBACK_STRINGS = {
  en: {
    title: 'Workspace files',
    close: 'Close workspace files',
    filter: 'Filter files…',
    resize: 'Resize workspace file tree',
    resizeHint: 'Drag to resize; double-click to reset',
    loading: 'Loading files…',
    readError: 'Workspace files unavailable',
    empty: 'No files',
    noMatches: 'No matching files',
    openFolder: 'Open project folder in File Explorer',
    locate: 'Show in File Explorer',
    previewUnavailable: 'Preview is not installed or configured.',
    locateOnly: 'Shown in File Explorer instead.',
    actionFailed: 'Could not open this item.',
    folderBackground: 'Folder opened. Switch to File Explorer in the taskbar.',
  },
  zh: {
    title: '工作区文件树',
    close: '关闭工作区文件树',
    filter: '筛选文件…',
    resize: '调整文件树宽度',
    resizeHint: '拖动调整宽度，双击恢复默认',
    loading: '正在加载…',
    readError: '当前无法读取工作区文件',
    empty: '工作区为空',
    noMatches: '没有匹配的文件',
    openFolder: '在资源管理器中打开项目目录',
    locate: '在资源管理器中定位',
    previewUnavailable: '未安装或配置 Preview。',
    locateOnly: '已改为在资源管理器中定位。',
    actionFailed: '无法打开此项。',
    folderBackground: '目录已打开，可从任务栏切换到资源管理器。',
  },
} as const;

function installWorkspaceTree(): void {
  const frameStyleId = 'bc-workspace-main-frame';
  const frameStyle = document.getElementById(frameStyleId) ?? document.createElement('style');
  frameStyle.id = frameStyleId;
  frameStyle.textContent =
    '[data-bc-workspace-files] + [data-app-shell-main-content-layout="thread-edge-scroll"] ' +
    '> :has([data-app-shell-focus-area="main"] .thread-scroll-container){max-inline-size:100%}';
  if (!frameStyle.isConnected) document.head.append(frameStyle);

  function single(node: ParentNode, selector: string, test: (el: Element) => boolean = () => true): Element | null {
    const matches = [...node.querySelectorAll(selector)].filter(test);
    return matches.length === 1 ? matches[0] : null;
  }

  function layout(blocked = EXCLUDED): LayoutScope | null {
    const visible = (node: Element) =>
      node.getClientRects().length > 0 && node.checkVisibility() && !node.closest(blocked);
    const page = single(document, ACTIVE_SELECTOR, (n) => !n.closest(blocked));
    if (!page) return null;
    const slot = single(page, TOOLBAR_SELECTOR, visible);
    const main = single(page, MAIN_SELECTOR, visible);
    if (!main || !slot?.lastElementChild?.querySelector('button,[role="button"]')) return null;
    const slotStyle = getComputedStyle(slot);
    if (!['flex', 'inline-flex'].includes(slotStyle.display) || slotStyle.flexDirection !== 'row') {
      return null;
    }
    const content = single(main, CONTENT_SELECTOR, (n) => visible(n) && !n.closest(RIGHT_PANEL));
    const dock = content?.parentElement;
    if (!content || !dock) return null;
    const dockStyle = getComputedStyle(dock);
    if (dockStyle.display !== 'flex' || dockStyle.flexDirection !== 'row') return null;

    const markers = [...content.querySelectorAll(THREAD_MARKER)].filter(
      (n) => !n.closest(`${blocked},${RIGHT_PANEL}`),
    );
    const ids = [
      ...new Set(
        markers
          .map((n) => n.getAttribute('data-above-composer-conversation-id'))
          .filter((id): id is string => ID_PATTERN.test(id ?? '')),
      ),
    ];
    if (ids.length > 1 || (!ids.length && markers.length)) return null;
    const id = ids[0] ?? null;
    const composer = id
      ? single(
          content,
          COMPOSER_SELECTOR,
          (n) =>
            !n.closest(`${blocked},${RIGHT_PANEL}`) &&
            markers.some(
              (marker) =>
                marker.getAttribute('data-above-composer-conversation-id') === id && n.contains(marker),
            ),
        )
      : single(
          content,
          `${COMPOSER_SELECTOR}[data-composer-placement="home"]`,
          (n) => visible(n) && !n.closest(RIGHT_PANEL),
        );
    if (!composer && !id) return null;

    if (
      id &&
      [
        ...document.querySelectorAll(
          `[data-app-action-sidebar-thread-id="${id}"],[data-app-action-sidebar-thread-id$=":${id}"]`,
        ),
      ].some((row) =>
        ['kind', 'host-id'].some((name) => {
          const value = row.getAttribute(`data-app-action-sidebar-thread-${name}`);
          return value !== null && value !== 'local';
        }),
      )
    ) {
      return null;
    }
    return { page, id, content, dock, slot, composer };
  }

  const sameScope = (a: LayoutScope | null | undefined, b: LayoutScope | null | undefined) =>
    Boolean(a && b && a.id === b.id && a.page === b.page && a.content === b.content && a.dock === b.dock && a.composer === b.composer);

  const localRoot = (value: unknown) => allowedRoot(value, bcTreeRoots);
  const sameWorkspace = (
    a: { root?: string | null; key?: string | null } | null | undefined,
    b: { root?: string | null; key?: string | null } | null | undefined,
  ) => Boolean(a?.root && b?.root && a.key === b.key && a.root.toLowerCase() === b.root.toLowerCase());

  function mountedComposer(node: Element | null): any {
    const key = node && Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
    const fiber = key ? (node as unknown as Record<string, any>)[key] : null;
    if (!fiber) return null;
    let root = fiber;
    for (let i = 0; root.return && i < 220; i++) root = root.return;
    if (root.stateNode?.current === root) return fiber;
    return root.alternate && root.stateNode?.current === root.alternate ? fiber.alternate : null;
  }

  function selectedLocalProject(fiber: any): string | null {
    let projectId: string | null = null;
    for (let node = fiber, depth = 0; node && depth < 10; node = node.return, depth++) {
      const project = node.memoizedProps?.selectedProject;
      if (!project) continue;
      if (project.type !== 'local' || !ID_PATTERN.test(project.projectId ?? '')) return null;
      const next = project.projectId.toLowerCase();
      if (projectId && projectId !== next) return null;
      projectId = next;
    }
    return projectId;
  }

  function nativeWorkspace(
    { id }: { id: string | null },
    fiber: any,
    projectId: string | null,
  ): { root: string; key: string; projectId: string } | null {
    if (!fiber || !projectId) return null;
    let root: string | null = null;
    let execution: string | null = null;
    const stack = [fiber.child];
    for (let i = 0; stack.length && i < 300; i++) {
      const node = stack.pop();
      if (!node) continue;
      const props = node.memoizedProps;
      if (props?.composerMode === 'local') {
        if (props.hostId === 'local' && props.conversationId === id && Array.isArray(props.roots) && props.roots.length === 1) {
          const next = localRoot(props.roots[0]);
          if (!next || (root && root.toLowerCase() !== next.toLowerCase())) return null;
          root = next;
        }
        if (props.currentLocalExecutionHostId === 'local') {
          const next = localRoot(props.currentLocalExecutionCwd);
          if (!next || (execution && execution.toLowerCase() !== next.toLowerCase())) return null;
          execution = next;
        }
      }
      if (node.sibling) stack.push(node.sibling);
      if (node.child) stack.push(node.child);
    }
    return root && execution && root.toLowerCase() === execution.toLowerCase()
      ? { root, key: `project:${projectId}`, projectId }
      : null;
  }

  function registeredProject(root: string, projects: any[]): any {
    const path = root.toLowerCase();
    let longest = 0;
    const matches = new Map<string, any>();
    for (const project of projects) {
      if (!ID_PATTERN.test(project?.id ?? '') || !Array.isArray(project.roots)) continue;
      for (const item of project.roots) {
        const base = localRoot(item?.path)?.toLowerCase();
        if (!base || base.length < longest || (path !== base && !path.startsWith(`${base}\\`))) continue;
        if (base.length > longest) {
          longest = base.length;
          matches.clear();
        }
        matches.set(project.id.toLowerCase(), project);
      }
    }
    return matches.size === 1 ? matches.values().next().value : null;
  }

  const projectName = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  function sidebarProjectName(id: string): string {
    const names = new Set(
      [...document.querySelectorAll(`[${SIDEBAR_PROJECT_ID}="${id}"][${SIDEBAR_PROJECT_LABEL}]`)]
        .map((node) => projectName(node.getAttribute(SIDEBAR_PROJECT_LABEL)))
        .filter(Boolean),
    );
    return names.size === 1 ? (names.values().next().value ?? '') : '';
  }

  function readPreferredWidth(): number {
    try {
      const value = Number(window.localStorage.getItem(WIDTH_KEY));
      if (Number.isInteger(value) && value >= MIN_WIDTH && value <= MAX_WIDTH) return value;
    } catch {
      // Local storage can be disabled.
    }
    return DEFAULT_WIDTH;
  }

  let preferredWidth = readPreferredWidth();
  const transient = new Map<string, boolean>();
  function remembered(key: string): boolean {
    if (transient.has(key)) return transient.get(key)!;
    try {
      return window.localStorage.getItem(STORAGE_PREFIX + key) === '1';
    } catch {
      return false;
    }
  }
  function remember(key: string, open: boolean): void {
    try {
      if (open) window.localStorage.setItem(STORAGE_PREFIX + key, '1');
      else window.localStorage.removeItem(STORAGE_PREFIX + key);
      transient.delete(key);
    } catch {
      transient.set(key, open);
    }
  }

  const locale = () => window.__codexHudI18n?.locale?.() ?? document.documentElement.lang;
  function t(full: string): string {
    const text = window.__codexHudI18n?.t?.(full);
    const shortKey = full.slice('workspaceTree.'.length) as keyof typeof FALLBACK_STRINGS.en;
    return text && text !== full
      ? text
      : FALLBACK_STRINGS[/^zh/i.test(locale()) ? 'zh' : 'en'][shortKey];
  }

  function treeSort() {
    const alphabet = new Intl.Collator(/^zh/i.test(locale()) ? 'zh-CN-u-co-pinyin' : 'en', {
      sensitivity: 'base',
      numeric: true,
    });
    const compare = (a: string, b: string) => alphabet.compare(a, b) || (a === b ? 0 : a < b ? -1 : 1);
    const git = new Set(['.gitattributes', '.gitignore', '.gitmodules', '.gitconfig', '.gitkeep']);
    const typeOf = (raw: string) => {
      const name = raw.toLowerCase();
      if (git.has(name)) return 'git';
      const dot = name.lastIndexOf('.');
      return dot > 0 ? name.slice(dot + 1) : '';
    };
    return (a: { segments: string[]; isDirectory: boolean }, b: { segments: string[]; isDirectory: boolean }) => {
      for (let i = 0; i < Math.min(a.segments.length, b.segments.length); i++) {
        const x = a.segments[i];
        const y = b.segments[i];
        const xDir = a.isDirectory || i < a.segments.length - 1;
        const yDir = b.isDirectory || i < b.segments.length - 1;
        if (xDir !== yDir) return xDir ? -1 : 1;
        if (!xDir) {
          const first = typeOf(x);
          const second = typeOf(y);
          if (first !== second) return !first ? 1 : !second ? -1 : compare(first, second);
        }
        if (x !== y) return compare(x, y);
      }
      return a.segments.length - b.segments.length;
    };
  }

  const triggerHost = document.createElement('span');
  triggerHost.dataset.bcWorkspaceTreeTrigger = '';
  triggerHost.style.cssText =
    'position:relative;display:inline-flex;align-items:center;gap:8px;flex:0 1 auto;' +
    'min-width:28px;max-width:32%;pointer-events:auto;-webkit-app-region:no-drag';
  const triggerShadow = triggerHost.attachShadow({ mode: 'open' });
  triggerShadow.innerHTML =
    `<style>${triggerStyles}</style>` +
    '<button type="button" aria-expanded="false" aria-controls="bc-workspace-files">' +
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 4h5l2 2h4v5H5a2 2 0 0 1-2-2Zm3 7v7h5m0-2h7l2 2v3h-9z"/></svg></button>';
  const trigger = triggerShadow.querySelector<HTMLButtonElement>('button')!;
  trigger.style.flex = 'none';

  const projectLabel = document.createElement('button');
  projectLabel.type = 'button';
  projectLabel.dataset.bcWorkspaceProjectName = '';
  projectLabel.style.cssText =
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-inline-size:200px;' +
    'font-size:var(--text-sm,13px);font-weight:600';
  projectLabel.hidden = true;

  const headerNotice = document.createElement('span');
  headerNotice.className = 'notice';
  headerNotice.setAttribute('role', 'status');
  headerNotice.hidden = true;
  triggerShadow.append(projectLabel, headerNotice);

  let enabled = false;
  let disposed = false;
  let frame = 0;
  let binding: WorkspaceBinding | null = null;
  let surface: WorkspaceSurface | null = null;
  let current: WorkspaceView | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | 0 = 0;
  let missingTimer: ReturnType<typeof setTimeout> | 0 = 0;
  const projectCache = new Map<string, { project: { id: string; name: string } | null; expires: number }>();

  function visualLayout(): LayoutScope | null {
    const active = layout();
    if (active || !binding) return active;
    const background = layout(PERSISTENT_BLOCK);
    return sameScope(binding.scope, background) ? background : null;
  }

  const fileItem = (view: WorkspaceView | null, path: string | undefined) => {
    const item = typeof path === 'string' ? view?.tree?.getItem(path) : null;
    return item && !item.isDirectory() ? item : null;
  };

  function clearNotice(): void {
    clearTimeout(noticeTimer);
    headerNotice.hidden = true;
    headerNotice.textContent = '';
    if (surface) {
      surface.notice.hidden = true;
      surface.notice.textContent = '';
    }
  }

  const actions = createWorkspaceActions<WorkspaceBinding, WorkspaceView>({
    contextIsCurrent: (context) => {
      if (!enabled || binding !== context || context.pending) return false;
      const scope = layout();
      if (!scope || !sameScope(context.scope, scope)) return false;
      const fiber = mountedComposer(scope.composer);
      const projectId = selectedLocalProject(fiber);
      return (
        context.projectSelection === projectId &&
        (!context.native || sameWorkspace(context, nativeWorkspace(scope, fiber, projectId)))
      );
    },
    fileIsCurrent: (view, path) =>
      current === view && Boolean(surface?.pane.isConnected) && Boolean(fileItem(view, path)),
    fileIsFocused: (view, path) => view.tree?.getFocusedItem()?.getPath() === path,
    notice(status) {
      clearNotice();
      const node = surface?.notice ?? headerNotice;
      const key = (
        {
          previewUnavailable: 'workspaceTree.previewUnavailable',
          locateOnly: 'workspaceTree.locateOnly',
          actionFailed: 'workspaceTree.actionFailed',
          folderBackground: 'workspaceTree.folderBackground',
        } as Record<string, string>
      )[status];
      node.hidden = false;
      node.textContent = t(key);
      noticeTimer = setTimeout(clearNotice, 4000);
    },
  });

  function updateLabels(): void {
    const title = surface ? t('workspaceTree.close') : t('workspaceTree.title');
    if (trigger.title !== title) {
      trigger.title = title;
      trigger.setAttribute('aria-label', title);
    }
    const expanded = String(Boolean(surface));
    if (trigger.getAttribute('aria-expanded') !== expanded) {
      trigger.setAttribute('aria-expanded', expanded);
    }
    const name = binding?.name ?? '';
    if (projectLabel.textContent !== name) {
      projectLabel.textContent = name;
      projectLabel.hidden = !name;
    }
    const folderTitle = name ? `${t('workspaceTree.openFolder')}: ${name}` : '';
    if (projectLabel.title !== folderTitle) projectLabel.title = folderTitle;
    if (surface) {
      const resize = t('workspaceTree.resize');
      const hint = t('workspaceTree.resizeHint');
      if (surface.separator.getAttribute('aria-label') !== resize) {
        surface.separator.setAttribute('aria-label', resize);
      }
      if (surface.separator.title !== hint) surface.separator.title = hint;
    }
  }

  function disposeView(): void {
    if (!current) return;
    const view = current;
    current = null;
    actions.reset();
    cancelAnimationFrame(view.expansionFrame);
    view.dirs?.close();
    view.unsubscribe?.();
    view.tree?.cleanUp();
  }

  function hide(focus = false): void {
    actions.reset();
    disposeView();
    clearNotice();
    surface?.sizer.dispose();
    surface?.pane.remove();
    surface = null;
    updateLabels();
    if (focus && triggerHost.isConnected) trigger.focus({ preventScroll: true });
  }

  function makeSizer(pane: HTMLElement, separator: HTMLDivElement) {
    let dock: Element | null = null;
    let drag: { id: number; x: number; start: number; width: number; direction: 1 | -1 } | null = null;
    let actual = DEFAULT_WIDTH;
    let low = MIN_WIDTH;
    let high = MAX_WIDTH;
    const clamp = (value: number) => Math.round(Math.min(high, Math.max(low, value)));

    function draw(): void {
      actual = clamp(drag?.width ?? preferredWidth);
      pane.style.setProperty('--bc-workspace-width', `${actual}px`);
      separator.setAttribute('aria-valuenow', String(actual));
    }

    function measure(): void {
      if (!dock) return;
      const available = dock.clientWidth;
      high =
        available > 0
          ? Math.max(1, Math.min(MAX_WIDTH, Math.floor(available / 2), Math.max(96, available - 320)))
          : MAX_WIDTH;
      low = Math.min(MIN_WIDTH, high);
      separator.setAttribute('aria-valuemin', String(low));
      separator.setAttribute('aria-valuemax', String(high));
      separator.setAttribute('aria-disabled', String(low === high));
      draw();
    }

    const resizer = new ResizeObserver(measure);

    function commit(width: number): void {
      preferredWidth = width;
      try {
        window.localStorage.setItem(WIDTH_KEY, String(width));
      } catch {
        // Keep this window's width.
      }
      draw();
    }

    function end(commitChange = false): void {
      if (!drag) return;
      const last = drag;
      drag = null;
      delete separator.dataset.dragging;
      if (separator.hasPointerCapture(last.id)) separator.releasePointerCapture(last.id);
      const finalWidth = clamp(last.width);
      if (commitChange && finalWidth !== clamp(last.start)) commit(finalWidth);
      else draw();
    }

    const direction = (): 1 | -1 => (getComputedStyle(pane).direction === 'rtl' ? -1 : 1);
    function preview(e: PointerEvent): void {
      if (drag?.id !== e.pointerId) return;
      const width = clamp(drag.start + (e.clientX - drag.x) * drag.direction);
      if (width !== drag.width) {
        drag.width = width;
        draw();
      }
    }

    separator.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !e.isPrimary || drag) return;
      measure();
      if (low === high) return;
      e.preventDefault();
      separator.focus({ preventScroll: true });
      separator.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, x: e.clientX, start: actual, width: actual, direction: direction() };
      separator.dataset.dragging = '';
    });
    separator.addEventListener('pointermove', preview);
    separator.addEventListener('pointerup', (e) => {
      if (drag?.id === e.pointerId) {
        preview(e);
        end(true);
      }
    });
    for (const type of ['pointercancel', 'lostpointercapture'] as const) {
      separator.addEventListener(type, (e) => {
        if (drag?.id === (e as PointerEvent).pointerId) end();
      });
    }
    separator.addEventListener('dblclick', () => {
      end();
      commit(DEFAULT_WIDTH);
    });
    separator.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drag) {
        e.preventDefault();
        e.stopPropagation();
        end();
        return;
      }
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) || drag) return;
      e.preventDefault();
      e.stopPropagation();
      measure();
      const step = (e.shiftKey ? 48 : 16) * direction();
      const target =
        e.key === 'Home'
          ? low
          : e.key === 'End'
            ? high
            : clamp(actual + (e.key === 'ArrowRight' ? step : -step));
      if (target !== actual) commit(target);
    });

    return {
      mount(next: Element) {
        if (dock !== next) {
          resizer.disconnect();
          dock = next;
          resizer.observe(dock);
        }
        measure();
      },
      draw,
      cancel: () => end(),
      dispose() {
        resizer.disconnect();
        dock = null;
        end();
      },
    };
  }

  function makeSurface(): WorkspaceSurface {
    const pane = document.createElement('aside');
    pane.id = 'bc-workspace-files';
    pane.dataset.bcWorkspaceFiles = '';
    pane.style.cssText =
      'display:flex;position:relative;flex:0 0 var(--bc-workspace-width,min(300px,45%));' +
      'min-width:0;min-height:0;align-self:stretch';
    const shadow = pane.attachShadow({ mode: 'open' });
    shadow.innerHTML =
      `<style>${treePanelStyles}</style>` +
      '<div class="dock">' +
      '<label><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round" aria-hidden="true">' +
      '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>' +
      '<input type="search" autocomplete="off" spellcheck="false" disabled></label>' +
      '<div class="notice" role="status" hidden></div>' +
      '<div class="status" role="status"></div>' +
      '<div class="tree"></div></div>' +
      '<div class="splitter" role="separator" aria-orientation="vertical" tabindex="0"></div>';

    const input = shadow.querySelector<HTMLInputElement>('input')!;
    const status = shadow.querySelector<HTMLDivElement>('.status')!;
    const wrap = shadow.querySelector<HTMLDivElement>('.tree')!;
    const separator = shadow.querySelector<HTMLDivElement>('.splitter')!;
    const notice = shadow.querySelector<HTMLDivElement>('.notice')!;

    function filePath(event: Event): string | undefined {
      const row = event
        .composedPath()
        .find((node): node is HTMLElement => node instanceof HTMLElement && node.matches('[role="treeitem"][data-item-path]'));
      return fileItem(current, row?.dataset.itemPath)?.getPath();
    }

    wrap.addEventListener('dblclick', (event) => {
      const path = filePath(event);
      if (path && event.button === 0) void actions.start(event, 'open', binding, current, path);
    });

    wrap.addEventListener(
      'keydown',
      (event) => {
        if (
          !event.isTrusted ||
          ![' ', 'Escape'].includes(event.key) ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey
        ) {
          return;
        }
        if (
          event
            .composedPath()
            .some(
              (node) =>
                node instanceof HTMLElement &&
                (node.isContentEditable || node.matches('input,textarea,select')),
            )
        ) {
          return;
        }
        const path = filePath(event);
        if (!path || current?.tree?.getFocusedItem()?.getPath() !== path) return;
        const escape = event.key === 'Escape';
        if (escape && !actions.canDismiss(binding, current, path)) return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) {
          void actions.start(event, escape ? 'dismissPreview' : 'preview', binding, current, path);
        }
      },
      true,
    );

    return { pane, input, status, wrap, separator, notice, sizer: makeSizer(pane, separator) };
  }

  function mount(scope: LayoutScope): void {
    if (!surface) return;
    const { pane, sizer } = surface;
    if (scope.content.previousElementSibling !== pane) {
      scope.content.before(pane);
      sizer.mount(scope.dock);
    }
    if (pane.style.visibility) pane.style.visibility = '';
  }

  function suspend(scope: LayoutScope): void {
    if (!surface) return;
    mount(scope);
    if (surface.suspended) return;
    const { input, status, wrap, sizer } = surface;
    surface.suspended = true;
    sizer.cancel();
    input.disabled = true;
    input.style.visibility = wrap.style.visibility = 'hidden';
    wrap.inert = true;
    status.textContent = t('workspaceTree.loading');
    status.hidden = false;
  }

  function resume(): void {
    if (!surface?.suspended) return;
    const { input, wrap } = surface;
    surface.suspended = false;
    input.disabled = !current?.tree;
    input.style.visibility = wrap.style.visibility = '';
    wrap.inert = false;
    current?.displayStatus?.();
  }

  function present(scope: LayoutScope, message: string): WorkspaceSurface {
    disposeView();
    clearNotice();
    const s = (surface ??= makeSurface());
    s.sizer.cancel();
    resume();
    s.wrap.replaceChildren();
    s.input.oninput = null;
    s.input.value = '';
    s.input.disabled = true;
    s.pane.setAttribute('aria-label', t('workspaceTree.title'));
    s.input.placeholder = t('workspaceTree.filter');
    s.input.setAttribute('aria-label', s.input.placeholder);
    s.status.textContent = t(message);
    s.status.hidden = false;
    mount(scope);
    updateLabels();
    return s;
  }

  function open(context: WorkspaceBinding): void {
    if (current && sameWorkspace(current, context)) {
      current.name = context.name;
      current.named = context.named;
      mount(context.scope);
      resume();
      return;
    }
    const { scope, root } = context;
    const { input, status, wrap } = present(
      scope,
      root ? 'workspaceTree.loading' : 'workspaceTree.readError',
    );
    if (!root) return;

    const view: WorkspaceView = {
      root,
      key: context.key,
      name: context.name,
      named: context.named,
      tree: null,
      dirs: null,
      unsubscribe: null,
      expansionFrame: 0,
      pathCount: 0,
    };
    current = view;
    const isCurrent = () => current === view;

    const displayStatus = (view.displayStatus = () => {
      if (surface?.suspended) return;
      if (!view.tree) {
        status.textContent = t(view.error ? 'workspaceTree.readError' : 'workspaceTree.loading');
        status.hidden = false;
        return;
      }
      const filter = input.value.trim();
      const noMatches = filter && view.tree.getSearchMatchingPaths().length === 0;
      status.textContent = noMatches
        ? t('workspaceTree.noMatches')
        : !view.pathCount
          ? t('workspaceTree.empty')
          : '';
      status.hidden = !status.textContent;
    });

    function onUpdate(removed: string[], added: string[], count: number): void {
      if (!isCurrent()) return;
      view.pathCount = count;
      view.error = false;
      if (!view.tree) {
        view.tree = new bcTreeRenderer.FileTree({
          paths: added,
          initialExpansion: 'closed',
          sort: treeSort(),
          flattenEmptyDirectories: false,
          icons: { set: 'complete', colored: true },
          itemHeight: 26,
          fileTreeSearchMode: 'hide-non-matches',
          composition: {
            contextMenu: {
              render(item: { path: string }, controls: { close(): void }) {
                if (!fileItem(view, item.path) || !isCurrent()) return null;
                const button = document.createElement('button');
                button.type = 'button';
                button.setAttribute('role', 'menuitem');
                button.style.cssText =
                  'border:0;border-radius:5px;padding:5px 8px;background:transparent;' +
                  'color:inherit;font:inherit;cursor:pointer;white-space:nowrap';
                button.textContent = t('workspaceTree.locate');
                button.addEventListener('click', (event) => {
                  controls.close();
                  void actions.start(event, 'locate', binding, view, item.path);
                });
                return button;
              },
            },
          },
        });
        view.tree.render({ containerWrapper: wrap });
        view.unsubscribe = view.tree.subscribe(() => {
          if (view.updating || input.value.trim() || !isCurrent() || view.expansionFrame) return;
          view.expansionFrame = requestAnimationFrame(() => {
            view.expansionFrame = 0;
            if (!view.tree || input.value.trim() || !isCurrent()) return;
            const expanded = view.tree
              .getVisibleRows(0, view.tree.getVisibleCount())
              .filter((row) => row.kind === 'directory' && row.isExpanded)
              .map((row) => row.path.replace(/\/$/, ''));
            view.dirs?.expand(expanded);
          });
        });
      } else if (removed.length || added.length) {
        view.updating = true;
        try {
          view.tree.batch((store) => {
            for (const path of removed) store.remove(path, { recursive: path.endsWith('/') });
            for (const path of added) store.add(path);
          });
        } finally {
          view.updating = false;
        }
      }
      if (!surface?.suspended) input.disabled = false;
      displayStatus();
    }

    function onError(): void {
      if (!isCurrent()) return;
      view.unsubscribe?.();
      view.unsubscribe = null;
      view.tree?.cleanUp();
      view.tree = null;
      wrap.replaceChildren();
      input.value = '';
      input.disabled = true;
      view.error = true;
      displayStatus();
    }

    input.oninput = () => {
      if (!view.tree || !isCurrent()) return;
      view.updating = true;
      try {
        view.tree.setSearch(input.value.trim() || null);
      } finally {
        view.updating = false;
      }
      displayStatus();
    };

    view.dirs = createWorkspaceDirectories({ root, isCurrent, onUpdate, onError });
    view.dirs.start();
  }

  function setOpen(context: WorkspaceBinding | null, openIt: boolean, focus = false): void {
    if (!context || context !== binding) return;
    if (context.pending) context.intent = openIt;
    else if (context.key) remember(context.key, openIt);
    if (!openIt) hide(focus);
    else if (context.pending) {
      if (!surface) surface = makeSurface();
      suspend(context.scope);
      updateLabels();
    } else open(context);
  }

  function applyRemembered(context: WorkspaceBinding): void {
    if (context.key && remembered(context.key)) open(context);
    else hide();
  }

  async function loadProjectName(context: WorkspaceBinding, projectId: string): Promise<void> {
    try {
      const { project } = await context.transport.send('project/read', { projectId }, 1400);
      if (binding !== context || !sameScope(context.scope, visualLayout()) || project?.id?.toLowerCase() !== projectId) {
        return;
      }
      const name = projectName(project.name);
      if (name) {
        context.name = name;
        context.named = true;
        if (current && sameWorkspace(current, context)) Object.assign(current, { name, named: true });
        updateLabels();
      }
    } catch {
      // The workspace folder name remains visible.
    } finally {
      context.transport.close();
    }
  }

  function finishBinding(context: WorkspaceBinding, projectId: string | null): void {
    const name = projectId ? sidebarProjectName(projectId) : '';
    if (name) Object.assign(context, { name, named: true });
    context.pending = false;
    if (context.intent !== null) setOpen(context, context.intent);
    else applyRemembered(context);
    updateLabels();
    if (projectId && !context.named) void loadProjectName(context, projectId);
    else context.transport.close();
  }

  async function findProject(
    root: string,
    transport: WorkspaceTransport,
    valid: () => boolean,
  ): Promise<{ id: string; name: string } | null> {
    const key = root.toLowerCase();
    const cached = projectCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.project;
    const projects: any[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 3; page++) {
      const result = await transport.send('project/list', { cursor, limit: 100 }, 1400);
      if (!valid() || !Array.isArray(result?.data)) return null;
      projects.push(...result.data.slice(0, 100));
      cursor = result.nextCursor;
      if (typeof cursor !== 'string' || !cursor) break;
    }
    const match = registeredProject(root, projects);
    const project = match ? { id: match.id, name: projectName(match.name) } : null;
    projectCache.delete(key);
    if (projectCache.size >= 16) projectCache.delete(projectCache.keys().next().value!);
    projectCache.set(key, { project, expires: Date.now() + 30000 });
    return project;
  }

  async function resolve(context: WorkspaceBinding): Promise<void> {
    const { scope, transport } = context;
    const valid = () => binding === context && sameScope(scope, visualLayout());
    let explicitId: string | null = null;
    try {
      const result = await transport.send('thread/read', { threadId: scope.id, includeTurns: false }, 2400);
      if (!valid()) {
        transport.close();
        return;
      }
      const thread = result?.thread;
      const root = thread?.id === scope.id ? localRoot(thread.cwd) : null;
      if (root) {
        const fiber = mountedComposer(scope.composer);
        context.projectSelection = selectedLocalProject(fiber);
        explicitId =
          context.projectSelection ??
          (ID_PATTERN.test(thread.projectId ?? '') ? thread.projectId.toLowerCase() : null);
        let registered: { id: string; name: string } | null = null;
        if (!explicitId) {
          try {
            registered = await findProject(root, transport, valid);
          } catch {
            // Older App Servers can still use the workspace path.
          }
          if (!valid()) {
            transport.close();
            return;
          }
        }
        const projectId = explicitId ?? registered?.id.toLowerCase();
        context.root = root;
        context.key = projectId ? `project:${projectId}` : `root:${root.toLowerCase()}`;
        context.named = Boolean(projectName(registered?.name));
        context.name = projectName(registered?.name) || root.split('\\').at(-1);
        context.native = sameWorkspace(context, nativeWorkspace(scope, fiber, context.projectSelection));
      }
    } catch {
      // A failed lookup never reuses another chat's files or project.
    }
    if (valid()) finishBinding(context, explicitId);
    else transport.close();
  }

  function clearBinding(): void {
    clearTimeout(missingTimer);
    missingTimer = 0;
    binding?.transport.cancel();
    binding = null;
    hide();
    triggerHost.remove();
    triggerHost.style.visibility = '';
  }

  function waitForScope(): void {
    if (!enabled || !current || !surface) {
      clearBinding();
      return;
    }
    if (surface.pane.style.visibility !== 'hidden') surface.pane.style.visibility = 'hidden';
    if (triggerHost.style.visibility !== 'hidden') triggerHost.style.visibility = 'hidden';
    actions.reset();
    if (!missingTimer) missingTimer = setTimeout(clearBinding, 180);
  }

  function reconcile(): WorkspaceBinding | null {
    if (disposed) return null;
    const scope = enabled ? visualLayout() : null;
    if (!scope) {
      waitForScope();
      return null;
    }
    const unchanged = sameScope(binding?.scope, scope);
    const fiber = mountedComposer(scope.composer);
    const projectSelection = selectedLocalProject(fiber);
    const projectChanged = unchanged && projectSelection !== binding!.projectSelection;
    const hint =
      !unchanged || projectChanged || binding!.native || !scope.id
        ? nativeWorkspace(scope, fiber, projectSelection)
        : null;
    if (!scope.id && !hint) {
      waitForScope();
      return null;
    }
    const returning = Boolean(missingTimer);
    clearTimeout(missingTimer);
    missingTimer = 0;
    triggerHost.style.visibility = '';
    if (scope.slot.firstElementChild !== triggerHost) scope.slot.prepend(triggerHost);

    if (
      !unchanged ||
      projectChanged ||
      (binding!.native && !sameWorkspace(binding, hint)) ||
      (returning && binding!.pending)
    ) {
      const previous = binding;
      previous?.transport.cancel();
      actions.reset();
      clearNotice();
      const context: WorkspaceBinding = (binding = {
        scope,
        projectSelection,
        pending: true,
        intent: null,
        root: null,
        key: null,
        transport: createWorkspaceTransport(),
      });
      const match = sameWorkspace(hint, previous)
        ? previous
        : sameWorkspace(hint, current)
          ? current
          : null;
      if (hint && (!scope.id || match)) {
        const named = previous?.key === hint.key && previous.named ? previous : match;
        Object.assign(context, hint, {
          native: true,
          named: Boolean(named?.named),
          name: named?.name || hint.root.split('\\').at(-1),
        });
        finishBinding(context, hint.projectId);
      } else {
        if (surface) suspend(scope);
        void resolve(context);
      }
    } else if (surface) {
      mount(scope);
    }
    updateLabels();
    return binding;
  }

  function schedule(): void {
    if (enabled && !disposed && !frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        reconcile();
      });
    }
  }

  trigger.addEventListener('click', () => {
    const context = reconcile();
    setOpen(context, !surface, true);
  });
  projectLabel.addEventListener('click', (event) => void actions.start(event, 'folder', reconcile()));

  function storageChanged(event: StorageEvent): void {
    if (event.key === null || event.key === WIDTH_KEY) {
      preferredWidth = readPreferredWidth();
      surface?.sizer.draw();
    }
    if (!binding?.pending && binding?.key && (event.key === null || event.key === STORAGE_PREFIX + binding.key)) {
      const context = reconcile();
      if (context && !context.pending && context.key && (event.key === null || event.key === STORAGE_PREFIX + context.key)) {
        transient.delete(context.key);
        applyRemembered(context);
      }
    }
  }

  const observed = [
    ACTIVE_SELECTOR,
    TOOLBAR_SELECTOR,
    THREAD_MARKER,
    MAIN_SELECTOR,
    CONTENT_SELECTOR,
    COMPOSER_SELECTOR,
    SIDEBAR_ROW,
    `[${SIDEBAR_PROJECT_ID}]`,
  ].join(',');

  const observer = new MutationObserver((records) => {
    if (
      enabled &&
      records.some((record) => {
        const node = record.target;
        if (record.type === 'attributes') {
          return (
            Boolean(record.attributeName?.startsWith('data-app-')) ||
            record.attributeName === 'data-above-composer-conversation-id' ||
            record.attributeName === 'data-composer-placement' ||
            node === document.documentElement ||
            (node instanceof Element && (node.matches(observed) || Boolean(node.querySelector(observed))))
          );
        }
        if (binding?.native && !binding.scope.id && binding.scope.composer?.contains(node)) return true;
        return [...record.addedNodes, ...record.removedNodes].some(
          (added) =>
            added instanceof Element &&
            (added.matches(observed) || Boolean(added.childElementCount && added.querySelector(observed))),
        );
      })
    ) {
      schedule();
    }
  });

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      'data-app-shell-active-page',
      'data-above-composer-conversation-id',
      'data-app-action-sidebar-thread-id',
      'data-app-action-sidebar-thread-kind',
      'data-app-action-sidebar-thread-host-id',
      'inert',
      'aria-hidden',
      'hidden',
      'data-aria-hidden',
      'data-inert-ed',
      'data-composer-placement',
      SIDEBAR_PROJECT_ID,
      SIDEBAR_PROJECT_LABEL,
    ],
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  window.addEventListener('resize', schedule);
  window.addEventListener('storage', storageChanged);

  window.__codexWorkspaceTree = {
    pullAction: actions.pull,
    confirmAction: actions.confirm,
    confirmPreview: actions.confirmPreview,
    actionResult: actions.result,
    setEnabled(value) {
      if (enabled === (value === true)) return;
      enabled = value === true;
      if (!enabled) projectCache.clear();
      reconcile();
    },
    remove() {
      clearBinding();
      projectCache.clear();
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('storage', storageChanged);
      triggerHost.remove();
      frameStyle.remove();
      delete window.__codexWorkspaceTree;
    },
  };
}

installWorkspaceTree();
