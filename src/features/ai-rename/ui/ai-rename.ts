// Transient status and request bridge for AI naming; no draft or chat content is retained.
import styles from './ai-rename.css';

interface RenameJobRequest {
  requestId: string;
  createdAt: number;
  kind?: 'project';
  threadId?: string;
  generation?: number;
  projectId?: string;
  threadIds?: string[];
  unresolved?: number;
  [key: string]: unknown;
}

interface RenameJob {
  sent: boolean;
  request: RenameJobRequest;
  timeout?: ReturnType<typeof setTimeout>;
}

interface ProjectScope {
  id: string;
  keys: string[];
}

interface MenuEntryRecord {
  row: HTMLElement | null;
  id: string;
  item: HTMLButtonElement;
}

interface ReactFiber {
  return?: ReactFiber | null;
  child?: ReactFiber | null;
  sibling?: ReactFiber | null;
  tag?: number;
  stateNode?: unknown;
  memoizedProps?: Record<string, any>;
}

const FALLBACK_MESSAGES: Record<string, string> = {
  running: 'AI 正在整理会话…',
  success: '已重命名为 {title}',
  failed: 'AI 重命名失败，已保留原名',
  noChat: '请先打开已保存的聊天',
  busy: 'AI 重命名正在处理',
  unavailable: '无法读取聊天记录，已保留原名',
  changing: '聊天记录仍在更新，请稍后重试',
  noMessages: '没有可用于命名的用户消息',
  unconfirmed: '未能确认新标题是否已保存',
  batchAction: '批量 AI 重命名',
  batchChecking: '正在检查项目聊天…',
  batchProgress: '批量 AI 重命名：{finished}/{total}',
  batchNone: '当前项目没有需要重命名的聊天',
  batchDone: '已重命名 {renamed} 个，跳过 {skipped} 个，失败 {failed} 个',
  batchUnavailable: '无法核实项目聊天，已停止批量重命名',
};

const SPARKLE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="m12 3-1.9 5.1L5 10l5.1 1.9L12 17l1.9-5.1L19 10l-5.1-1.9Z"/>' +
  '<path d="M5 3v4M3 5h4M19 17v4M17 19h4"/></svg>';

const SPINNER_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.2-8.56"/></svg>';

const ROW_SELECTOR = '[data-app-action-sidebar-thread-id]';
const PROJECT_SELECTOR = '[data-app-action-sidebar-project-row][data-app-action-sidebar-project-id]';
const TARGET_SELECTOR = `${ROW_SELECTOR},${PROJECT_SELECTOR}`;
const UUID_RE = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const MENU_SELECTOR = '[role="menu"][data-state="open"]';
const MENU_ENTRIES_SELECTOR = '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]';

function t(key: string, values: Record<string, string | number> = {}): string {
  const translated = window.__codexHudI18n?.t?.(key, values);
  if (translated !== undefined) return translated;
  const fallback = FALLBACK_MESSAGES[key.replace(/^aiRename\./, '')] ?? key;
  return fallback.replace(/\{(\w+)\}/g, (match, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}

function fiberOf(element: Element): ReactFiber | null {
  const key = Object.getOwnPropertyNames(element).find((k) => k.startsWith('__reactFiber$'));
  return key ? ((element as unknown as Record<string, ReactFiber>)[key] ?? null) : null;
}

function installAiRename(): void {
  if (window.__codexAiRename) return;

  const style = document.createElement('style');
  style.id = 'better-codex-ai-rename-style';
  style.textContent = styles;
  document.head.append(style);

  const host = document.createElement('div');
  host.dataset.bcAiRenameRoot = '';
  host.hidden = true;
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');

  const mark = document.createElement('span');
  mark.dataset.bcAiRenameMark = '';
  const text = document.createElement('span');
  text.dataset.bcAiRenameText = '';
  host.append(mark, text);
  document.body.append(host);

  const jobs = new Map<string, RenameJob>();
  const menuItems = new WeakMap<Element, MenuEntryRecord>();
  let timer: ReturnType<typeof setTimeout> | 0 = 0;
  let projectResolving = false;
  let disposed = false;

  function position(): void {
    const composers = [...document.querySelectorAll('[data-codex-composer-root]')]
      .filter((el) => el.checkVisibility() && el.getBoundingClientRect().width > 0)
      .sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
    const rect = composers[0]?.getBoundingClientRect();
    if (rect) {
      host.style.left = `${Math.max(12, Math.min(innerWidth - 12, rect.left + rect.width / 2))}px`;
      host.style.top = `${Math.max(56, rect.top - 10)}px`;
    } else {
      host.style.left = '50%';
      host.style.top = 'calc(100vh - 112px)';
    }
  }

  function show(kind: 'running' | 'success' | 'failed', message: string): void {
    if (timer) clearTimeout(timer);
    timer = 0;
    host.hidden = false;
    host.dataset.state = kind;
    mark.innerHTML = kind === 'running' ? SPINNER_SVG : SPARKLE_SVG;
    mark.toggleAttribute('data-spin', kind === 'running');
    text.textContent = message;
    position();
    if (kind !== 'running') {
      timer = setTimeout(
        () => {
          timer = 0;
          if (jobs.size) show('running', t('aiRename.running'));
          else host.hidden = true;
        },
        kind === 'success' ? 4200 : 5200,
      );
    }
  }

  function available(): boolean {
    return Boolean(window.__codexComposerHud?.snapshot?.().id);
  }

  function arm(job: RenameJob): void {
    clearTimeout(job.timeout);
    job.timeout = setTimeout(
      () =>
        state({
          requestId: job.request.requestId,
          phase: 'failed',
          reason:
            job.request.kind === 'project'
              ? 'project-catalog'
              : job.sent
                ? 'title-not-confirmed'
                : 'failed',
        }),
      180000,
    );
  }

  function enqueue(data: Omit<RenameJobRequest, 'requestId' | 'createdAt'>, message: string): boolean {
    const id = `ai-rename:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const job: RenameJob = { sent: false, request: { ...data, requestId: id, createdAt: Date.now() } };
    jobs.set(id, job);
    arm(job);
    show('running', message);
    try {
      window.__betterCodexRequestAiRename?.(id);
    } catch {
      // The worker also polls as a fallback.
    }
    return true;
  }

  function requestFor(snapshot?: { id?: string | null; generation?: number } | null): boolean {
    if (typeof snapshot?.id !== 'string' || !snapshot.id) {
      show('failed', t('aiRename.noChat'));
      return false;
    }
    const threadKey = snapshot.id.toLowerCase();
    if ([...jobs.values()].some((job) => job.request.threadId?.toLowerCase() === threadKey)) {
      show('failed', t('aiRename.busy'));
      return false;
    }
    return enqueue(
      { threadId: snapshot.id, generation: snapshot.generation },
      t('aiRename.running'),
    );
  }

  function request(): boolean {
    return requestFor(window.__codexComposerHud?.snapshot?.());
  }

  function pull(id?: string): Record<string, unknown> | null {
    const job =
      id === undefined ? [...jobs.values()].find((item) => !item.sent) : jobs.get(id);
    if (!job || job.sent) return null;
    job.sent = true;
    return job.request;
  }

  function state(value?: Record<string, any>): void {
    const job = jobs.get(value?.requestId);
    if (!job) return;
    if (job.request.kind === 'project' && value?.phase === 'running') {
      arm(job);
      show('running', value.total ? t('aiRename.batchProgress', value) : t('aiRename.batchChecking'));
      return;
    }
    if (!['success', 'failed'].includes(value?.phase)) return;

    clearTimeout(job.timeout);
    jobs.delete(value!.requestId);

    if (job.request.kind === 'project') {
      if (value!.phase === 'success') {
        show(
          'success',
          value!.total || value!.skipped ? t('aiRename.batchDone', value) : t('aiRename.batchNone'),
        );
      } else if (value!.reason === 'busy') {
        show('failed', t('aiRename.busy'));
      } else {
        show(
          'failed',
          t('aiRename.batchUnavailable') +
            (value!.finished ? ` · ${t('aiRename.batchDone', value)}` : ''),
        );
      }
      return;
    }

    if (value!.phase === 'success') {
      show('success', t('aiRename.success', { title: value!.title || '' }));
    } else {
      const reasonMap: Record<string, string> = {
        'transcript-unavailable': 'aiRename.unavailable',
        'transcript-changed': 'aiRename.changing',
        empty: 'aiRename.noMessages',
        busy: 'aiRename.busy',
        'title-not-confirmed': 'aiRename.unconfirmed',
      };
      show('failed', t(reasonMap[value!.reason] ?? 'aiRename.failed'));
    }
  }

  const menuEntriesFor = (menu: Element): HTMLElement[] =>
    [...menu.querySelectorAll<HTMLElement>(MENU_ENTRIES_SELECTOR)].filter(
      (item) => item.closest('[role="menu"]') === menu && !item.hasAttribute('data-bc-sidebar-ai-rename'),
    );

  function projectScope(row: HTMLElement): ProjectScope | null {
    if (
      row.closest('[data-sidebar-project-kind]')?.getAttribute('data-sidebar-project-kind') !==
      'local'
    ) {
      return null;
    }
    const id = row.dataset.appActionSidebarProjectId;
    for (let fiber = fiberOf(row); fiber; fiber = fiber.return ?? null) {
      const p = fiber.memoizedProps;
      if (!p) continue;
      // Use the native group's complete list, never the mounted rows or cwd.
      if (UUID_RE.test(id ?? '') && p?.group?.projectId === id && Array.isArray(p.group.threadKeys)) {
        return { id: id!, keys: p.group.threadKeys };
      }
      if (
        /^g-p-[\da-f]{32}$/i.test(id ?? '') &&
        p?.project?.gizmo?.id === id &&
        UUID_RE.test(p.linkedLocalProjectId ?? '') &&
        Array.isArray(p.localThreadKeys)
      ) {
        return { id: id!, keys: p.localThreadKeys };
      }
    }
    return null;
  }

  async function readClientBindings(): Promise<Record<string, unknown> | null> {
    const readers = new Set<(key: string, fallback: null) => Record<string, unknown> | null>();
    for (const script of document.scripts) {
      if (script.type !== 'module' || !script.src) continue;
      const url = new URL(script.src);
      if (url.origin !== location.origin || !/^\/assets\/[^/]+\.js$/.test(url.pathname)) continue;
      try {
        const loader = (await import(url.href)).__webpack_require__;
        for (const mod of Object.values<any>(loader?.c ?? {})) {
          const api = mod?.exports;
          if (api && ['TB', 'A2', 'Nj', 'Uz', 'Iy'].every((k) => typeof api[k] === 'function')) {
            readers.add(api.TB);
          }
        }
      } catch {
        // Ignore non-matching scripts.
      }
    }
    if (readers.size === 1) {
      try {
        return [...readers][0]('client-thread-bindings-v1', null);
      } catch {
        return null;
      }
    }
    return null;
  }

  function sidebarThreadId(row: Element): string | null {
    if (
      row.getAttribute('data-app-action-sidebar-thread-host-id') !== 'local' ||
      row.getAttribute('data-app-action-sidebar-thread-kind') !== 'local'
    ) {
      return null;
    }
    const raw = row.getAttribute('data-app-action-sidebar-thread-id') || '';
    if (!raw.startsWith('local:')) return null;
    const local = raw.slice('local:'.length);
    if (UUID_RE.test(local)) return local;
    if (!local.startsWith('client-new-thread:')) return null;
    const alias = local.slice('client-new-thread:'.length);
    if (!UUID_RE.test(alias)) return null;

    const ids = new Set<string>();
    for (
      let fiber = fiberOf(row), depth = 0;
      fiber && depth < 12;
      fiber = fiber.return ?? null, depth += 1
    ) {
      const props = fiber.memoizedProps;
      if (
        props?.rowRef?.current !== row ||
        props.hostId !== 'local' ||
        props.isCodexCloudTask ||
        typeof props.conversationId !== 'string' ||
        !UUID_RE.test(props.conversationId)
      ) {
        continue;
      }
      const id = props.conversationId.toLowerCase();
      if (id !== alias.toLowerCase()) ids.add(id);
    }
    return ids.size === 1 ? (ids.values().next().value ?? null) : null;
  }

  async function requestProject(scope: ProjectScope): Promise<void> {
    if (projectResolving || [...jobs.values()].some((job) => job.request.kind === 'project')) {
      show('failed', t('aiRename.busy'));
      return;
    }
    projectResolving = true;
    show('running', t('aiRename.batchChecking'));
    try {
      const keys = [
        ...new Set(scope.keys.filter((k) => typeof k === 'string' && k.startsWith('local:'))),
      ];
      const aliases = new Set(keys.filter((k) => k.startsWith('local:client-new-thread:')));
      const bindings = aliases.size ? await readClientBindings() : null;
      if (disposed) return;

      const mounted = new Map<string, Set<string>>();
      for (const row of aliases.size ? document.querySelectorAll(ROW_SELECTOR) : []) {
        const key = row.getAttribute('data-app-action-sidebar-thread-id') ?? '';
        if (!aliases.has(key)) continue;
        const id = sidebarThreadId(row);
        if (id) {
          if (!mounted.has(key)) mounted.set(key, new Set());
          mounted.get(key)!.add(id);
        }
      }

      const ids = new Set<string>();
      let unresolved = 0;
      for (const key of keys) {
        const raw = key.slice(6);
        if (UUID_RE.test(raw)) {
          ids.add(raw.toLowerCase());
          continue;
        }
        const alias = raw.slice('client-new-thread:'.length);
        if (!raw.startsWith('client-new-thread:') || !UUID_RE.test(alias)) {
          unresolved++;
          continue;
        }
        const mapped = bindings && Object.hasOwn(bindings, raw) ? bindings[raw] : null;
        const candidates = new Set(mounted.get(key));
        if (
          typeof mapped === 'string' &&
          UUID_RE.test(mapped) &&
          mapped.toLowerCase() !== alias.toLowerCase()
        ) {
          candidates.add(mapped.toLowerCase());
        }
        if (candidates.size === 1) ids.add([...candidates][0]);
        else unresolved++;
      }

      enqueue(
        { kind: 'project', projectId: scope.id, threadIds: [...ids], unresolved },
        t('aiRename.batchChecking'),
      );
    } finally {
      projectResolving = false;
    }
  }

  function uniqueTriggerRow(branch: ReactFiber | null | undefined): HTMLElement | null {
    const stack: ReactFiber[] = branch ? [branch] : [];
    let row: HTMLElement | null = null;
    let visited = 0;
    while (stack.length) {
      if (++visited > 256) return null;
      const fiber = stack.pop()!;
      const element = fiber.stateNode;
      if (fiber.sibling) stack.push(fiber.sibling);
      if (fiber.tag === 4 || (element instanceof Element && element.matches('[role="menu"]'))) {
        continue;
      }
      if (element instanceof HTMLElement && element.isConnected && element.matches(TARGET_SELECTOR)) {
        if (row && row !== element) return null;
        row = element;
      } else if (fiber.child) {
        stack.push(fiber.child);
      }
    }
    return row;
  }

  function menuOwner(menu: Element): HTMLElement | null {
    if (menu.parentElement?.closest('[role="menu"]')) return null;
    const labelledBy = menu.getAttribute('aria-labelledby');
    const triggerElement = labelledBy ? document.getElementById(labelledBy) : null;
    if (
      menu.id &&
      triggerElement?.getAttribute('aria-haspopup') === 'menu' &&
      triggerElement.getAttribute('aria-controls') === menu.id
    ) {
      return triggerElement.closest<HTMLElement>(TARGET_SELECTOR);
    }

    let clickMenu = false;
    for (let fiber = fiberOf(menu); fiber; fiber = fiber.return ?? null) {
      const element = fiber.stateNode;
      const props = fiber.memoizedProps;
      if (element instanceof Element && element !== menu) {
        if (element.matches('[role="menu"]')) return null;
        if (clickMenu) {
          const row = element.closest<HTMLElement>(TARGET_SELECTOR);
          if (row) return row;
        }
      }
      const trigger = props?.triggerRef?.current;
      if (
        trigger instanceof Element &&
        trigger.isConnected &&
        ((menu.id && props?.contentId === menu.id) ||
          (trigger.id && menu.getAttribute('aria-labelledby') === trigger.id))
      ) {
        return trigger.closest<HTMLElement>(TARGET_SELECTOR);
      }
      if (
        typeof props?.getItems === 'function' &&
        (props.menuShortcuts === true || typeof props.preserveBrowserContextMenu === 'boolean')
      ) {
        if (clickMenu) return null;
        if (props.trigger === 'click') clickMenu = true;
        else return uniqueTriggerRow(fiber.child);
      }
    }
    return null;
  }

  function extendMenu(menu: Element): void {
    const previous = menuItems.get(menu);
    const items = menu.matches(MENU_SELECTOR) ? menuEntriesFor(menu) : [];
    const rename = items.find(
      (item) =>
        item.getAttribute('aria-keyshortcuts')?.toLowerCase() === 'r' ||
        /^(?:rename(?: chat)?|重命名(?:聊天)?)(?:\s*r)?$/iu.test((item.textContent ?? '').trim()),
    );
    const row = items.length ? menuOwner(menu) : null;
    const project = row?.matches(PROJECT_SELECTOR) ? projectScope(row) : null;
    const id =
      project?.id ??
      (row?.matches(ROW_SELECTOR) &&
      rename &&
      rename.getAttribute('aria-disabled') !== 'true' &&
      !rename.hasAttribute('data-disabled')
        ? sidebarThreadId(row)
        : null);
    const first = items[0];

    if (previous?.row === row && previous?.id === id && menu.contains(previous.item)) {
      if (previous.item.nextElementSibling !== first) first.before(previous.item);
      return;
    }
    if (previous) {
      previous.item.remove();
      menuItems.delete(menu);
    }
    if (!id || !first) return;

    const item = document.createElement('button');
    const icon = document.createElement('span');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.tabIndex = -1;
    item.dataset.bcSidebarAiRename = '';
    item.className = (project ? first : rename!).className;
    item.style.cssText =
      'display:flex;justify-content:flex-start;align-items:center;gap:8px;width:100%;text-align:start';
    icon.style.cssText = 'display:grid;place-items:center;width:16px;height:16px;flex:none';
    icon.innerHTML = SPARKLE_SVG;
    icon.firstElementChild?.setAttribute('width', '16');
    icon.firstElementChild?.setAttribute('height', '16');

    const label = project
      ? t('aiRename.batchAction')
      : window.__codexHudI18n?.t?.('command.ai-rename') || 'AI 重命名';
    item.append(icon, document.createTextNode(label));

    item.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'mouse') item.focus({ preventScroll: true });
    });

    item.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!menu.matches(MENU_SELECTOR) || menuOwner(menu) !== row || !menu.contains(item)) return;
      if (project && row) {
        const scope = projectScope(row);
        if (scope?.id !== id) return;
        requestProject(scope).catch(() => {
          if (!disposed) show('failed', t('aiRename.batchUnavailable'));
        });
      } else if (row) {
        if (sidebarThreadId(row) !== id) return;
        requestFor({ id });
      }
      item.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }),
      );
    });

    menuItems.set(menu, { row, id, item });
    first.before(item);
  }

  function menuKey(event: KeyboardEvent): void {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key) || !(event.target instanceof Element)) return;
    const menu = event.target.closest(MENU_SELECTOR);
    const item = menu?.querySelector<HTMLElement>('[data-bc-sidebar-ai-rename]');
    if (!menu || !item) return;
    const first = menuEntriesFor(menu).find(
      (entry) => entry.getAttribute('aria-disabled') !== 'true',
    );
    const destination =
      event.key === 'ArrowDown' && event.target === item
        ? first
        : event.key === 'ArrowUp' && event.target === first
          ? item
          : null;
    if (destination) {
      event.preventDefault();
      event.stopPropagation();
      destination.focus({ preventScroll: true });
    }
  }

  const menuObserver = new MutationObserver((changes) => {
    const menus = new Set<Element>();
    for (const change of changes) {
      const target =
        change.target instanceof Element ? change.target : change.target.parentElement;
      const menu = target?.closest('[role="menu"]');
      if (menu) menus.add(menu);
      if (change.type === 'attributes' && target?.matches(TARGET_SELECTOR)) {
        for (const open of document.querySelectorAll(MENU_SELECTOR)) menus.add(open);
      }
      for (const node of change.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(MENU_SELECTOR)) menus.add(node);
        for (const child of node.querySelectorAll(MENU_SELECTOR)) menus.add(child);
      }
    }
    for (const menu of menus) {
      if (menu.isConnected) extendMenu(menu);
    }
  });

  menuObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      'data-state',
      'aria-disabled',
      'data-disabled',
      'data-app-action-sidebar-thread-id',
      'data-app-action-sidebar-project-id',
    ],
  });

  for (const menu of document.querySelectorAll(MENU_SELECTOR)) extendMenu(menu);
  window.addEventListener('keydown', menuKey, true);
  window.addEventListener('resize', position);

  function remove(): void {
    disposed = true;
    if (timer) clearTimeout(timer);
    for (const job of jobs.values()) clearTimeout(job.timeout);
    jobs.clear();
    menuObserver.disconnect();
    window.removeEventListener('keydown', menuKey, true);
    for (const item of document.querySelectorAll('[data-bc-sidebar-ai-rename]')) item.remove();
    window.removeEventListener('resize', position);
    style.remove();
    host.remove();
    delete window.__codexAiRename;
  }

  window.__codexAiRename = {
    request,
    pull,
    state,
    available,
    remove,
    snapshot: () => ({
      busy: projectResolving || jobs.size > 0,
      visible: !host.hidden,
      text: text.textContent,
    }),
  };
}

installAiRename();
