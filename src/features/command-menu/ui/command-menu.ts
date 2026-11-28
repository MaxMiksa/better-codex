// Native slash-menu presentation, with draft-only skill and Prompt insertion.
import {
  COMMANDS,
  PRESET_SKILLS,
  commandCatalog,
  isSkill,
  normalize,
  normalizeGroupOrder,
  normalizeItemOrder,
  normalizeSkillVisible,
  orderedGroups,
  skillKey,
} from '../shared/command-catalog';
import styles from './command-menu.css';

type RowSource = HTMLElement | string;

interface MenuItemMeta {
  id: string;
  title: string;
}

interface MenuEntry {
  row: RowSource;
  item: MenuItemMeta;
}

interface NameGroup {
  id: 'skills' | 'prompts';
  heading: string | null;
  entries: MenuEntry[];
}

interface PromptEntry {
  name: string;
  body: string;
}

interface OpeningState {
  request: string;
  loaded: boolean;
  promptTimer: ReturnType<typeof setTimeout> | 0;
  promptFrozen?: boolean;
  prompts: Map<string, string>;
  promptGroups: NameGroup[];
  composer?: Element;
  skillQueries?: WeakSet<object>;
}

interface StandaloneState {
  element: HTMLDivElement | null;
  editor: HTMLElement | null;
  composer: Element | null;
  query: string;
  request: string | null;
  loaded: boolean;
  promptFrozen: boolean;
  entries: PromptEntry[];
  open: boolean;
  timer: ReturnType<typeof setTimeout> | 0;
  promptTimer: ReturnType<typeof setTimeout> | 0;
  skillQueries?: WeakSet<object> | null;
}

interface ViewRecord {
  surface: HTMLDivElement;
  buttons: Map<RowSource, HTMLButtonElement>;
  sources: RowSource[];
  signature: string;
  icons: Map<RowSource, { slot: HTMLSpanElement; markup?: string }>;
}

const HEADINGS: Record<string, string> = { skills: 'Skills', prompts: 'Prompt' };
const EDITOR_SELECTOR = '[contenteditable="true"],[contenteditable="plaintext-only"],textarea';
const COMPOSER_SELECTOR = '[data-codex-composer-root]';
const PAGE_SELECTOR = '[data-app-shell-active-page]';
const AREA_SELECTOR = '[data-app-shell-focus-area]';
const NATIVE_SELECTOR = '[data-mention-list-scroll-area]';

const AI_RENAME_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="m12 3-1.9 5.1L5 10l5.1 1.9L12 17l1.9-5.1L19 10l-5.1-1.9Z"/>' +
  '<path d="M5 3v4M3 5h4M19 17v4M17 19h4"/></svg>';

function installCommandMenu(): void {
  if (window.__codexCommandMenu) return;

  let preferences = normalize();
  let groupOrder = normalizeGroupOrder();
  let itemOrder = normalizeItemOrder();
  let enabled = true;
  let disposed = false;
  let queued = false;
  let skillVisible = normalizeSkillVisible();

  const knownNativeSkills = new Map<string, string>();
  const showSkill = (id: string) => !Object.hasOwn(skillVisible, id) || skillVisible[id] !== false;

  const standalone: StandaloneState = {
    element: null,
    editor: null,
    composer: null,
    query: '',
    request: null,
    loaded: false,
    promptFrozen: false,
    entries: [],
    open: false,
    timer: 0,
    promptTimer: 0,
  };

  const discovered = new Map<string, string>();
  const managed = new Set<HTMLElement>();
  const selections = new WeakMap<Element, RowSource>();
  const views = new Map<Element, ViewRecord>();
  const openings = new Map<Element, OpeningState>();
  const proxySources = new WeakMap<Element, RowSource>();
  const columns = new WeakMap<Element, number>();
  const skillLoads = new WeakMap<object, Promise<unknown>>();

  const instance = String(Math.random());
  const namesOrder = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  let nextOpening = 0;
  let lastPrompts: PromptEntry[] | null = null;

  const style = document.createElement('style');
  style.id = 'better-codex-command-menu-style';
  style.textContent = styles;
  document.head.append(style);

  const fiberOf = (node: Element | null | undefined): any => {
    if (!node) return null;
    const key = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
    return key ? (node as unknown as Record<string, any>)[key] : null;
  };

  function autocomplete(root: Element): any {
    for (let current = fiberOf(root), depth = 0; current && depth < 24; current = current.return, depth++) {
      const value = current.memoizedProps?.autocomplete;
      if (value) return value;
    }
    return null;
  }

  function metadata(row: Element): MenuItemMeta | null {
    for (let current = fiberOf(row), depth = 0; current && depth < 5; current = current.return, depth++) {
      const item = current.memoizedProps?.children?.props?.item;
      if (item && typeof item.id === 'string' && typeof item.title === 'string') {
        return { id: item.id, title: item.title };
      }
    }
    return null;
  }

  function setAttribute(node: HTMLElement, key: string, value: string | null): void {
    managed.add(node);
    if (value === null) {
      if (node.hasAttribute(key)) node.removeAttribute(key);
    } else if (node.getAttribute(key) !== value) {
      node.setAttribute(key, value);
    }
  }

  function clearNode(node: HTMLElement): void {
    for (const name of [
      'data-bc-command-root',
      'data-bc-command-empty',
      'data-bc-prompt-pending',
      'data-bc-command-section',
      'data-bc-command',
      'data-bc-command-hidden',
      'data-bc-command-source',
      'data-bc-section-hidden',
      'data-bc-active',
    ]) {
      node.removeAttribute(name);
    }
    node.style?.removeProperty('--bc-command-order');
  }

  function restore(root: Element): void {
    clearTimeout(openings.get(root)?.promptTimer);
    views.get(root)?.surface.remove();
    views.delete(root);
    openings.delete(root);
    selections.delete(root);
    columns.delete(root);
    for (const node of [...managed]) {
      if (root.contains(node)) {
        clearNode(node);
        managed.delete(node);
      }
    }
  }

  function requestPrompts(opening: { request: string | null; promptTimer: ReturnType<typeof setTimeout> | 0; promptFrozen?: boolean }): void {
    if (typeof window.__betterCodexRequestPrompts !== 'function' || !opening.request) return;
    const request = opening.request;
    opening.promptTimer = setTimeout(() => {
      opening.promptFrozen = lastPrompts !== null;
      applyPrompts([request], lastPrompts ?? [], false);
    }, 180);
    try {
      window.__betterCodexRequestPrompts(request);
    } catch {
      // Fallback timer resolves bounded first frame.
    }
  }

  function eligible(root: Element, value = autocomplete(root)): boolean {
    return Boolean(enabled && value?.ui?.active === true && value.ui.trigger === '/' && !value.submenuCommand);
  }

  function nativeAvailable(row: HTMLElement): boolean {
    return (
      row.isConnected &&
      !row.hasAttribute('data-bc-command-hidden') &&
      row.getAttribute('aria-disabled') !== 'true' &&
      !(row as HTMLButtonElement).disabled
    );
  }

  function visibleRows(root: Element): RowSource[] {
    return [...(views.get(root)?.buttons || [])]
      .filter(([row, button]) => !button.disabled && (typeof row === 'string' || nativeAvailable(row)))
      .map(([row]) => row);
  }

  function visualOf(root: Element, row: RowSource): Element {
    return views.get(root)?.buttons.get(row) || (row as HTMLElement);
  }

  function selectRow(root: Element, row: RowSource): void {
    selections.set(root, row);
    for (const node of root.querySelectorAll<HTMLElement>('[data-bc-command]')) {
      setAttribute(node, 'data-bc-active', node === row ? '' : null);
    }
    for (const [source, button] of views.get(root)?.buttons || []) {
      button.toggleAttribute('data-bc-active', source === row);
      button.setAttribute('aria-selected', String(source === row));
    }
  }

  const isInteractive = (node: Element | null | undefined): node is HTMLElement =>
    Boolean(
      node instanceof HTMLElement &&
        node.isConnected &&
        !node.closest('[hidden],[inert],[aria-hidden="true"],[data-app-shell-active-page="false"]') &&
        node.getBoundingClientRect().width > 0 &&
        getComputedStyle(node).visibility === 'visible',
    );

  function focusedEditor(
    editor: Element | null = document.activeElement,
  ): { editor: HTMLElement; composer: Element } | null {
    if (!editor?.matches?.(EDITOR_SELECTOR) || !isInteractive(editor)) return null;
    const composer = editor.closest(COMPOSER_SELECTOR);
    if (
      !composer ||
      editor.closest('dialog,[role="dialog"],[role="alertdialog"],[role="menu"]') !==
        composer.closest('dialog,[role="dialog"],[role="alertdialog"],[role="menu"]')
    ) {
      return null;
    }
    const primary = composer.querySelector('[data-codex-composer="true"]');
    return !primary || primary.contains(editor) ? { editor, composer } : null;
  }

  function ownsMenu(root: Element, focused: { editor: HTMLElement; composer: Element } | null): boolean {
    if (!focused || !isInteractive(root)) return false;
    const { editor, composer } = focused;
    const owner = root.closest(COMPOSER_SELECTOR);
    if (owner) return owner === composer;
    for (let node = fiberOf(root), depth = 0; node && depth < 120; node = node.return, depth++) {
      if (node.stateNode?.matches?.(COMPOSER_SELECTOR)) return node.stateNode === composer;
    }
    const page = root.closest(PAGE_SELECTOR);
    const area = root.closest(AREA_SELECTOR);
    if ((page && page !== composer.closest(PAGE_SELECTOR)) || (area && area !== composer.closest(AREA_SELECTOR))) {
      return false;
    }
    const ids = [editor.getAttribute('aria-controls'), editor.getAttribute('aria-owns')]
      .filter(Boolean)
      .join(' ')
      .split(/\s+/);
    if (
      ids.some((id) => {
        const target = id && document.getElementById(id);
        return Boolean(target && (target === root || root.contains(target)));
      })
    ) {
      return true;
    }
    const opening = openings.get(root);
    if (opening?.composer) return opening.composer === composer;
    return [...(area || page || document).querySelectorAll(COMPOSER_SELECTOR)].every(
      (candidate) =>
        candidate === composer || ![...candidate.querySelectorAll(EDITOR_SELECTOR)].some(isInteractive),
    );
  }

  function nativeMenuOpen(focused = focusedEditor()): boolean {
    return Boolean(
      focused && [...document.querySelectorAll(NATIVE_SELECTOR)].some((root) => eligible(root) && ownsMenu(root, focused)),
    );
  }

  function nativeSkillContext(focused: { editor: HTMLElement; composer: Element } | null): {
    controller: any;
    pending: any;
    skills: any[];
  } | null {
    if (!focused) return null;
    const { editor, composer } = focused;
    let viewController: any;
    let client: any;
    let scope: any;

    const capture = (current: any) => {
      const props = current.memoizedProps;
      const controller = props?.composerController ?? props?.value;
      if (controller?.view?.dom === editor && typeof controller.insertMention === 'function') {
        viewController ??= controller;
      }
      const skills = props?.skillSuggestions;
      if (
        skills?.hostId === 'local' &&
        Array.isArray(skills.roots) &&
        skills.roots.every((r: unknown) => typeof r === 'string') &&
        typeof skills.autocomplete?.addMention === 'function'
      ) {
        scope ??= skills;
      }
    };

    for (let current = fiberOf(composer), depth = 0; current && depth < 220; current = current.return, depth++) {
      const candidate = current.memoizedProps?.value?.queryClient;
      if (typeof candidate?.getQueryData === 'function') {
        client = candidate;
        break;
      }
    }
    if (!client) return null;

    const stack = [fiberOf(composer)?.child];
    for (let count = 0; stack.length && count < 600 && !(viewController && scope); count++) {
      const current = stack.pop();
      if (!current) continue;
      capture(current);
      if (current.sibling) stack.push(current.sibling);
      if (current.child) stack.push(current.child);
    }
    if (!scope || !viewController?.view?.editable || viewController.view.isDestroyed) return null;

    const key = ['skills', scope.hostId, scope.roots];
    try {
      const data = client.getQueryData(key)?.data;
      const pending = Array.isArray(data)
        ? null
        : client.getQueryCache?.().find({ queryKey: key, exact: true });
      return {
        controller: viewController,
        pending,
        skills: Array.isArray(data)
          ? data.flatMap((entry: any) => (Array.isArray(entry?.skills) ? entry.skills : []))
          : [],
      };
    } catch {
      return null;
    }
  }

  function loadSkills(opening: { skillQueries?: WeakSet<object> | null }, query: any): void {
    if (
      !query?.getObserversCount?.() ||
      typeof query.options?.queryFn !== 'function' ||
      typeof query.fetch !== 'function'
    ) {
      return;
    }
    if (!opening.skillQueries) opening.skillQueries = new WeakSet();
    if (opening.skillQueries.has(query)) return;
    opening.skillQueries.add(query);
    if (skillLoads.has(query)) return;
    const load = Promise.resolve().then(() => query.fetch(undefined, { cancelRefetch: false }));
    skillLoads.set(query, load);
    load
      .then(
        () => {
          if (!disposed && enabled) window.dispatchEvent(new Event('better-codex-command-catalog'));
        },
        () => {},
      )
      .finally(() => {
        skillLoads.delete(query);
        schedule();
      });
  }

  const usableSkill = (skill: any) =>
    skill?.enabled === true &&
    skill.isPublic !== false &&
    typeof skill.name === 'string' &&
    Boolean(skill.name.trim()) &&
    typeof skill.path === 'string' &&
    Boolean(skill.path);

  function skillTitle(skill: any): string {
    const display = skill.interface?.displayName;
    return (
      (typeof display === 'string' && display.trim()) ||
      skill.name
        .replace(/[_-]+/g, ' ')
        .replace(/:\s*/g, ': ')
        .replace(/(^|\s)\p{L}/gu, (letter: string) => letter.toLocaleUpperCase())
    );
  }

  function skillEntries(composer?: Element | null): { id: string; title: string }[] {
    const entries = new Map(Object.entries(PRESET_SKILLS));
    for (const [id, title] of knownNativeSkills) entries.set(id, title);
    for (const editor of composer?.querySelectorAll(EDITOR_SELECTOR) ?? []) {
      for (const skill of nativeSkillContext(focusedEditor(editor))?.skills ?? []) {
        if (!usableSkill(skill)) continue;
        const title = skillTitle(skill);
        entries.set(skillKey(title, skill.name), title);
      }
    }
    return [...entries]
      .sort((a, b) => namesOrder.compare(a[1], b[1]))
      .map(([id, title]) => ({ id, title }));
  }

  function cachedSkills(
    focused: { editor: HTMLElement; composer: Element } | null,
    query: unknown,
    opening?: { skillQueries?: WeakSet<object> | null },
  ): MenuEntry[] {
    if (typeof query !== 'string') return [];
    const context = nativeSkillContext(focused);
    const seen = new Set<string>();
    const needle = query.toLocaleLowerCase();
    if (opening && context?.pending) loadSkills(opening, context.pending);
    return (context?.skills ?? []).flatMap((skill) => {
      if (!usableSkill(skill) || seen.has(skill.path)) return [];
      seen.add(skill.path);
      const id = `skill:${skill.path}`;
      const title = skillTitle(skill);
      return showSkill(skillKey(title, skill.name)) &&
        (!needle || [title, skill.name].some((name) => name.toLocaleLowerCase().includes(needle)))
        ? [{ row: id, item: { id, title } }]
        : [];
    });
  }

  function insertSkill(root: Element, id: string, query: unknown): boolean {
    const focused = focusedEditor();
    const owner = root.closest(COMPOSER_SELECTOR);
    if (!focused || (owner && owner !== focused.composer) || typeof query !== 'string' || /[\s/]/u.test(query)) {
      return false;
    }
    const context = nativeSkillContext(focused);
    const view = context?.controller.view;
    const skill = context?.skills.find((s) => usableSkill(s) && `skill:${s.path}` === id);
    if (
      !skill ||
      !showSkill(skillKey(skillTitle(skill), skill.name)) ||
      view.composing ||
      !view.state?.selection?.empty
    ) {
      return false;
    }
    const { doc, selection } = view.state;
    const to = selection.to;
    const trigger = `/${query}`;
    const from = to - trigger.length;
    if (!Number.isInteger(to) || from < 1 || typeof doc?.textBetween !== 'function') return false;
    try {
      if (doc.textBetween(from, to) !== trigger) return false;
      const before = doc.resolve(from).parentOffset > 0 ? doc.textBetween(from - 1, from) : '';
      if (before && !/\s/u.test(before)) return false;
      context!.controller.insertMention(
        {
          kind: 'skill',
          name: skill.name,
          displayName: skillTitle(skill),
          path: skill.path,
          description:
            skill.interface?.shortDescription ||
            skill.short_description ||
            skill.shortDescription ||
            skill.description ||
            '',
          iconSmall: skill.interface?.iconSmall ?? '',
        },
        { range: { from, to } },
      );
      return true;
    } catch {
      return false;
    }
  }

  function linePrefix(editor: HTMLElement): string | null {
    if (editor instanceof HTMLTextAreaElement) {
      if (editor.selectionStart !== editor.selectionEnd) return null;
      const offset = editor.selectionStart;
      const start = editor.value.lastIndexOf('\n', offset - 1) + 1;
      return editor.value.slice(start, offset);
    }
    const selection = getSelection();
    if (!selection?.isCollapsed || !selection.focusNode || !editor.contains(selection.focusNode)) {
      return null;
    }
    const focusNode = selection.focusNode;
    const element = focusNode.nodeType === Node.TEXT_NODE ? focusNode.parentElement : (focusNode as Element);
    const block = element?.closest?.('p,div,li,pre,blockquote,h1,h2,h3,h4,h5,h6');
    const line = block && editor.contains(block) ? block : editor;
    const range = document.createRange();
    range.selectNodeContents(line);
    range.setEnd(focusNode, selection.focusOffset);
    return range.toString();
  }

  function slashQuery(editor: HTMLElement): string | null {
    const prefix = linePrefix(editor);
    const match = typeof prefix === 'string' ? prefix.match(/(?:^|\s)\/([^\s/]*)$/u) : null;
    return match ? match[1] : null;
  }

  function ensureStandalone(): HTMLDivElement {
    if (!standalone.element) {
      const element = document.createElement('div');
      element.dataset.bcStandaloneRoot = '';
      element.dataset.bcCommandRoot = '';
      element.setAttribute('role', 'listbox');
      element.hidden = true;
      document.body.append(element);
      standalone.element = element;
    }
    return standalone.element;
  }

  function standaloneGroups() {
    const query = standalone.query.toLocaleLowerCase();
    const entries: MenuEntry[] = standalone.entries
      .filter((entry) => !query || entry.name.toLocaleLowerCase().includes(query))
      .map(({ name }) => ({ row: `prompt:${name}`, item: { id: `prompt:${name}`, title: name } }));
    const skills =
      standalone.editor && standalone.composer
        ? cachedSkills(
            { editor: standalone.editor, composer: standalone.composer },
            standalone.query,
            standalone,
          )
        : [];
    return {
      entries,
      skillGroups: nameLayout('skills', skills),
      promptGroups: nameLayout('prompts', entries),
    };
  }

  function positionStandalone(): void {
    const { element, composer } = standalone;
    if (!element || element.hidden || !composer?.isConnected) return;
    const margin = 12;
    const rect = composer.getBoundingClientRect();
    const width = Math.max(280, Math.min(720, rect.width));
    element.style.width = `${width}px`;
    element.style.left = `${Math.max(margin, Math.min(innerWidth - margin - width, rect.left))}px`;
    const anchor = Math.min(rect.top - 8, innerHeight - margin);
    element.style.maxHeight = `${Math.max(0, anchor - margin)}px`;
    element.style.bottom = `${innerHeight - anchor}px`;
  }

  function renderStandalone(): boolean {
    if (!standalone.open) return false;
    if (focusedEditor()?.editor !== standalone.editor) {
      closeStandalone();
      return false;
    }
    const { entries, skillGroups, promptGroups } = standaloneGroups();
    if (standalone.promptTimer) return false;
    if (!skillGroups.length && !promptGroups.length) {
      if (standalone.element) standalone.element.hidden = true;
      return false;
    }
    const element = ensureStandalone();
    element.hidden = false;
    build(element, entries, [], skillGroups, promptGroups);
    const visible = visibleRows(element);
    const selected = selections.get(element);
    selectRow(element, selected && visible.includes(selected) ? selected : visible[0]);
    positionStandalone();
    return true;
  }

  function closeStandalone(): void {
    if (standalone.timer) {
      clearTimeout(standalone.timer);
      standalone.timer = 0;
    }
    clearTimeout(standalone.promptTimer);
    standalone.promptTimer = 0;
    standalone.open = false;
    standalone.loaded = false;
    standalone.promptFrozen = false;
    standalone.skillQueries = null;
    standalone.request = null;
    standalone.query = '';
    standalone.entries = [];
    standalone.editor = null;
    standalone.composer = null;
    if (standalone.element) {
      standalone.element.hidden = true;
      restore(standalone.element);
    }
  }

  function inspectStandalone(): void {
    standalone.timer = 0;
    if (disposed || !enabled || nativeMenuOpen()) {
      closeStandalone();
      return;
    }
    const focused = focusedEditor();
    const query = focused ? slashQuery(focused.editor) : null;
    if (query === null || !focused) {
      closeStandalone();
      return;
    }
    if (!standalone.open || standalone.editor !== focused.editor) {
      closeStandalone();
      standalone.open = true;
      standalone.editor = focused.editor;
      standalone.composer = focused.composer;
      standalone.request = `${instance}:standalone:${++nextOpening}`;
      requestPrompts(standalone);
    }
    standalone.query = query;
    renderStandalone();
  }

  function scheduleStandalone(delay = 80): void {
    if (disposed) return;
    if (standalone.timer) clearTimeout(standalone.timer);
    standalone.timer = setTimeout(inspectStandalone, delay);
  }

  function labelFor(item: { id: string; title?: string }): string {
    const known = COMMANDS.find((command) => command.id === item.id);
    return known && window.__codexHudI18n
      ? window.__codexHudI18n.t(known.shortLabel!)
      : (item.title ?? item.id);
  }

  function syntheticAvailable(id: string): boolean {
    if (id !== 'ai-rename') return true;
    if (window.__codexComposerHud?.snapshot?.().id) return true;
    return [...document.querySelectorAll('[data-app-action-sidebar-thread-active="true"]')].some((row) =>
      row.checkVisibility(),
    );
  }

  function nameLayout(id: 'skills' | 'prompts', entries: MenuEntry[]): NameGroup[] {
    const names = [...entries].sort((a, b) => namesOrder.compare(a.item.title, b.item.title));
    const size = Math.ceil(names.length / 3);
    const cols: MenuEntry[][] = [];
    for (let column = 0; column < 3; column++) cols.push(names.slice(column * size, (column + 1) * size));
    return Array.from({ length: size }, (_, index) => ({
      id,
      heading: index === 0 ? HEADINGS[id] : null,
      entries: cols.map((column) => column[index]).filter(Boolean),
    }));
  }

  function run(root: Element, row: RowSource): void {
    const standaloneRun = root === standalone.element;
    if (!isInteractive(root) || (!standaloneRun && !eligible(root))) return;
    if (typeof row !== 'string') {
      if (nativeAvailable(row)) row.click();
      return;
    }
    if (isSkill(row)) {
      if (insertSkill(root, row, standaloneRun ? standalone.query : autocomplete(root)?.ui?.query) && standaloneRun) {
        closeStandalone();
      }
      return;
    }
    if (row === 'ai-rename') {
      window.__codexAiRename?.request?.();
      insertPrompt(root, '', standaloneRun ? standalone.query : undefined);
      if (standaloneRun) closeStandalone();
      else {
        queueMicrotask(() => {
          if (root.isConnected) {
            try {
              autocomplete(root)?.closeAutocomplete?.();
            } catch {
              // Ignore close errors.
            }
          }
        });
      }
      return;
    }
    const opening = openings.get(root);
    const body = standaloneRun
      ? standalone.entries.find((entry) => `prompt:${entry.name}` === row)?.body
      : opening?.prompts.get(row);
    const editor = document.activeElement;
    if (body && insertPrompt(root, body, standaloneRun ? standalone.query : undefined)) {
      if (standaloneRun) {
        closeStandalone();
        return;
      }
      queueMicrotask(() => {
        if (root.isConnected && openings.get(root) === opening && document.activeElement === editor && eligible(root)) {
          try {
            autocomplete(root)?.closeAutocomplete?.();
          } catch {
            // Ignore close errors.
          }
        }
      });
    }
  }

  function withNewlines(body: string, before: string | undefined, after: string | undefined): string {
    if (!body) return '';
    return (
      (before && !/^[\r\n]/.test(before) && !/^[\r\n]/.test(body) ? '\n' : '') +
      body +
      (after && !/^[\r\n]/.test(after) && !/[\r\n]$/.test(body) ? '\n' : '')
    );
  }

  function edgeChar(range: Range, backward: boolean): string {
    const contents = range.cloneContents();
    const walk = document.createTreeWalker(contents, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        return node.nodeName === 'BR' || (node.nodeType === Node.TEXT_NODE && (node as Text).length)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      },
    });
    if (backward) {
      while (walk.nextNode()) {
        // Seek last accepted node.
      }
    } else {
      walk.nextNode();
    }
    const node = walk.currentNode;
    return node.nodeName === 'BR'
      ? '\n'
      : node.nodeType === Node.TEXT_NODE
        ? ((node as Text).data.at(backward ? -1 : 0) ?? '')
        : '';
  }

  function insertPrompt(root: Element, body: string, queryOverride?: string): boolean {
    const editor = document.activeElement;
    const composer = editor?.closest(COMPOSER_SELECTOR);
    const owner = root.closest(COMPOSER_SELECTOR);
    if (!editor || !composer || (owner && owner !== composer) || !editor.matches(EDITOR_SELECTOR)) {
      return false;
    }
    const query = queryOverride !== undefined ? queryOverride : autocomplete(root)?.ui?.query;
    const trigger = '/' + (typeof query === 'string' && !/\s/.test(query) ? query : '');

    function triggerLength(prefix: string, previous?: () => string): number {
      if (!prefix.endsWith(trigger)) return 0;
      const before = prefix.at(-trigger.length - 1) ?? previous?.();
      return !before || /\s/.test(before) ? trigger.length : 0;
    }

    let before: string | undefined;
    let after: string | undefined;
    let restoreSelection: () => void;

    if (editor instanceof HTMLTextAreaElement) {
      if (editor.readOnly || editor.disabled) return false;
      const { selectionStart: start, selectionEnd: end, selectionDirection: direction, value } = editor;
      const caret = direction === 'backward' ? start : end;
      const left = caret - (start === end ? triggerLength(value.slice(0, caret)) : 0);
      before = value[left - 1];
      after = value[caret];
      editor.setSelectionRange(left, caret);
      restoreSelection = () => editor.setSelectionRange(start, end, direction ?? undefined);
    } else {
      const selection = getSelection();
      if (!selection || !selection.focusNode || !selection.anchorNode) return false;
      const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
      if (!editor.contains(focusNode) || !editor.contains(anchorNode)) return false;
      const point = document.createRange();
      point.setStart(focusNode, focusOffset);
      point.collapse(true);
      const focusEl = focusNode.nodeType === Node.TEXT_NODE ? focusNode.parentElement : (focusNode as Element);
      const block = focusEl?.closest?.('p,div,li,pre,blockquote,h1,h2,h3,h4,h5,h6');
      const line = block && editor.contains(block) ? block : editor;
      const left = document.createRange();
      const right = document.createRange();
      left.selectNodeContents(line);
      left.setEnd(focusNode, focusOffset);
      right.selectNodeContents(line);
      right.setStart(focusNode, focusOffset);
      const removed =
        selection.isCollapsed && focusNode.nodeType === Node.TEXT_NODE
          ? triggerLength((focusNode as Text).data.slice(0, focusOffset), () => {
              const beforeNode = left.cloneRange();
              beforeNode.setEnd(focusNode, 0);
              return edgeChar(beforeNode, true);
            })
          : 0;
      if (removed) {
        point.setStart(focusNode, focusOffset - removed);
        left.setEnd(focusNode, focusOffset - removed);
      }
      before = edgeChar(left, true);
      after = edgeChar(right, false);
      selection.removeAllRanges();
      selection.addRange(point);
      restoreSelection = () => selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
    }

    try {
      if (document.execCommand('insertText', false, withNewlines(body, before, after))) return true;
    } catch {
      // Fallback to restoring selection.
    }
    restoreSelection();
    return false;
  }

  function syncIcons(icons: Map<RowSource, { slot: HTMLSpanElement; markup?: string }>): void {
    for (const [row, state] of icons) {
      if (typeof row === 'string') continue;
      const icon = row.querySelector('svg');
      const markup = icon?.outerHTML;
      if (state.markup === markup) continue;
      state.slot.replaceChildren(...(icon ? [icon.cloneNode(true)] : []));
      state.markup = markup;
    }
  }

  function build(
    root: Element,
    entries: MenuEntry[],
    ordered: ReturnType<typeof orderedGroups>,
    skillGroups: NameGroup[],
    promptGroups: NameGroup[],
  ): void {
    const available = new Map(
      entries
        .filter(({ item }) => !isSkill(item.id) && preferences[item.id] === true)
        .map((entry) => [entry.item.id, entry] as const),
    );
    const layout: { id: string; heading?: string | null; entries: MenuEntry[] }[] = ordered
      .map((group) => ({
        id: group.id,
        entries: group.items.map((item) => available.get(item.id)).filter((e): e is MenuEntry => Boolean(e)),
      }))
      .filter((group) => group.entries.length);
    layout.push(...skillGroups, ...promptGroups);

    const signature = JSON.stringify(
      layout.map((group) => [
        group.id,
        group.entries.map(({ row, item }) => [
          item.id,
          labelFor(item),
          item.title,
          typeof row === 'string' ? undefined : row.getAttribute('aria-disabled'),
          typeof row === 'string' ? undefined : (row as HTMLButtonElement).disabled,
        ]),
      ]),
    );
    const old = views.get(root);
    const sources = layout.flatMap((group) => group.entries.map((entry) => entry.row));
    if (
      old?.surface.isConnected &&
      old.signature === signature &&
      sources.length === old.sources.length &&
      sources.every((row, index) => old.sources[index] === row)
    ) {
      syncIcons(old.icons);
      return;
    }

    old?.surface.remove();
    const surface = document.createElement('div');
    surface.dataset.bcCommandGrid = '';
    const buttons = new Map<RowSource, HTMLButtonElement>();
    const icons = new Map<RowSource, { slot: HTMLSpanElement; markup?: string }>();

    for (const group of layout) {
      if (group.heading) {
        const title = document.createElement('div');
        title.dataset.bcMenuHeading = group.id;
        title.textContent = group.heading;
        surface.append(title);
      }
      const line = document.createElement('div');
      line.dataset.bcCommandGroup = group.id;
      line.setAttribute('role', 'group');
      if (group.id === 'skills') line.dataset.bcSkillRow = '';
      if (group.id === 'prompts') line.dataset.bcPromptRow = '';
      line.setAttribute(
        'aria-label',
        HEADINGS[group.id] || window.__codexHudI18n?.t(`commandGroup.${group.id}`) || group.id,
      );

      for (const { row, item } of group.entries) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.bcMenuButton = item.id;
        button.setAttribute('role', 'option');
        button.title = item.title;
        button.disabled = Boolean(
          (typeof row !== 'string' &&
            ((row as HTMLButtonElement).disabled || row.getAttribute('aria-disabled') === 'true')) ||
            !syntheticAvailable(item.id),
        );

        if (!HEADINGS[group.id]) {
          const slot = document.createElement('span');
          slot.dataset.bcMenuIcon = '';
          slot.setAttribute('aria-hidden', 'true');
          button.append(slot);
          if (item.id === 'ai-rename') slot.innerHTML = AI_RENAME_ICON;
          else icons.set(row, { slot });
        }

        const text = document.createElement('span');
        text.textContent = labelFor(item);
        button.append(text);
        button.tabIndex = -1;
        button.addEventListener('pointerdown', (event) => event.preventDefault());
        button.addEventListener('click', (event) => {
          if (typeof row === 'string') event.stopPropagation();
          if (!button.disabled) run(root, row);
        });
        proxySources.set(button, row);
        buttons.set(row, button);
        line.append(button);
      }
      surface.append(line);
    }

    syncIcons(icons);
    surface.hidden = !layout.length;
    root.prepend(surface);
    views.set(root, { surface, buttons, sources, signature, icons });
  }

  function refresh(): void {
    queued = false;
    if (disposed) return;
    if (!enabled) {
      closeStandalone();
      for (const root of [...openings.keys()]) restore(root);
      for (const node of managed) clearNode(node);
      managed.clear();
      return;
    }

    const focused = focusedEditor();
    if (nativeMenuOpen(focused)) closeStandalone();
    else if (standalone.open) renderStandalone();

    for (const root of openings.keys()) {
      if (!root.isConnected) restore(root);
    }
    for (const node of [...managed]) {
      if (!node.isConnected) {
        clearNode(node);
        managed.delete(node);
      }
    }

    let changed = false;
    for (const root of document.querySelectorAll<HTMLElement>(NATIVE_SELECTOR)) {
      const value = autocomplete(root);
      if (!eligible(root, value)) {
        restore(root);
        continue;
      }
      const rawEntries = [...root.querySelectorAll<HTMLElement>('[data-list-navigation-item="true"]')].map(
        (row) => ({ row, item: metadata(row) }),
      );
      const hasNativeRows = rawEntries.length > 0;
      if (rawEntries.some((entry) => !entry.item)) {
        restore(root);
        continue;
      }
      const entries = rawEntries as MenuEntry[];

      const nativeSkills = entries.filter(({ item }) => isSkill(item.id));
      for (const { item } of nativeSkills) {
        const id = skillKey(item.title, item.id.slice(6));
        if (knownNativeSkills.get(id) !== item.title) {
          knownNativeSkills.set(id, item.title);
          changed = true;
        }
      }

      const scoped = ownsMenu(root, focused) ? focused : null;
      if (!hasNativeRows && (!scoped || typeof value.ui.query !== 'string')) {
        restore(root);
        continue;
      }

      if (!openings.has(root)) {
        const opening: OpeningState = {
          request: `${instance}:${++nextOpening}`,
          loaded: false,
          promptTimer: 0,
          prompts: new Map(),
          promptGroups: [],
        };
        openings.set(root, opening);
        requestPrompts(opening);
      }
      const opening = openings.get(root)!;
      if (scoped) opening.composer = scoped.composer;

      const skillGroups = nameLayout(
        'skills',
        nativeSkills.length
          ? nativeSkills.filter(({ item }) => showSkill(skillKey(item.title, item.id.slice(6))))
          : cachedSkills(scoped, value.ui.query, opening),
      );
      const needle = String(value.ui.query ?? '').toLocaleLowerCase();
      const promptGroups =
        hasNativeRows || !needle
          ? opening.promptGroups
          : nameLayout(
              'prompts',
              opening.promptGroups
                .flatMap((group) => group.entries)
                .filter(({ item }) => item.title.toLocaleLowerCase().includes(needle)),
            );

      if (!hasNativeRows && !skillGroups.length && !promptGroups.length) {
        views.get(root)?.surface.remove();
        views.delete(root);
        selections.delete(root);
        columns.delete(root);
        for (const node of [...managed]) {
          if (root.contains(node)) {
            clearNode(node);
            managed.delete(node);
          }
        }
        continue;
      }

      setAttribute(root, 'data-bc-command-root', '');
      setAttribute(root, 'data-bc-command-empty', hasNativeRows ? null : '');
      setAttribute(root, 'data-bc-prompt-pending', opening.promptTimer ? '' : null);
      if (opening.promptTimer) continue;

      if (hasNativeRows) {
        entries.unshift({
          row: 'ai-rename',
          item: { id: 'ai-rename', title: labelFor({ id: 'ai-rename' }) },
        });
      }

      const extra = entries
        .filter(({ item }) => !isSkill(item.id) && !COMMANDS.some((cmd) => cmd.id === item.id))
        .map(({ item }) => ({ ...item, group: 'other' }));
      const ordered = orderedGroups(groupOrder, itemOrder, extra);
      const flat = ordered.flatMap((group) => group.items);
      const skillRanks = new Map(
        skillGroups.flatMap((group) => group.entries).map(({ item }, index) => [item.id, flat.length + index]),
      );
      const ranks = new Map(flat.map((item, index) => [item.id, index]));

      for (const { row, item } of entries) {
        if (typeof row === 'string') continue;
        if (!isSkill(item.id) && discovered.get(item.id) !== item.title) {
          discovered.set(item.id, item.title);
          changed = true;
        }
        const visible = isSkill(item.id) ? skillRanks.has(item.id) : preferences[item.id] === true;
        setAttribute(row, 'data-bc-command', item.id);
        setAttribute(row, 'data-bc-command-hidden', visible ? null : '');
        setAttribute(row, 'data-bc-command-source', '');
        const order = isSkill(item.id) ? skillRanks.get(item.id) : ranks.get(item.id);
        if (row.style.getPropertyValue('--bc-command-order') !== String(order)) {
          row.style.setProperty('--bc-command-order', String(order));
        }
      }

      for (const section of root.querySelectorAll<HTMLElement>('[data-mention-section-id]')) {
        setAttribute(section, 'data-bc-command-section', '');
        setAttribute(
          section,
          'data-bc-section-hidden',
          hasNativeRows &&
            !section.querySelector('[data-bc-command]:not([data-bc-command-hidden]):not([data-bc-command-source])')
            ? ''
            : null,
        );
      }

      build(root, entries, ordered, skillGroups, promptGroups);
      const visible = visibleRows(root);
      const native = visible.find(
        (row) =>
          typeof row !== 'string' &&
          (row.getAttribute('aria-current') === 'true' || row.getAttribute('aria-selected') === 'true'),
      );
      const selected = selections.get(root);
      selectRow(root, selected && visible.includes(selected) ? selected : native || visible[0]);
      if (root.scrollLeft) root.scrollLeft = 0;
    }

    if (changed) window.dispatchEvent(new Event('better-codex-command-catalog'));
  }

  function schedule(): void {
    if (!queued && !disposed) {
      queued = true;
      queueMicrotask(refresh);
    }
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['aria-current', 'aria-disabled', 'disabled'],
  });

  function keydown(event: KeyboardEvent): void {
    const groupJump = event.ctrlKey && ['ArrowUp', 'ArrowDown'].includes(event.key);
    const origin = event.composedPath()[0];
    const originEl = origin instanceof Element ? origin : null;
    const focused = focusedEditor(originEl === document.activeElement ? originEl : null);
    const standaloneFocused = standalone.open && focused?.editor === standalone.editor;
    const standaloneRoot = standaloneFocused && isInteractive(standalone.element) ? standalone.element : null;
    const standaloneWaiting = Boolean(standaloneFocused && standalone.promptTimer);

    if (event.key === 'Escape' && (standaloneRoot || standaloneWaiting) && !event.defaultPrevented && !event.isComposing) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeStandalone();
      return;
    }

    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.altKey ||
      (event.ctrlKey && !groupJump) ||
      event.metaKey ||
      event.shiftKey ||
      !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', 'Tab'].includes(event.key)
    ) {
      return;
    }

    const menu = originEl?.closest?.(NATIVE_SELECTOR) ?? null;
    const roots = (menu ? [menu] : [...document.querySelectorAll(NATIVE_SELECTOR)]).filter(
      (root) =>
        eligible(root) &&
        (menu ? isInteractive(root) && views.get(root)?.surface.contains(originEl) : ownsMenu(root, focused)) &&
        (views.has(root) || root.hasAttribute('data-bc-prompt-pending')),
    );
    if (roots.length > 1 || (!roots.length && !standaloneRoot && !standaloneWaiting)) return;

    const root = roots[0] || standaloneRoot;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!root || root.hasAttribute('data-bc-prompt-pending')) return;

    const visible = visibleRows(root);
    const selected = selections.get(root);
    if (event.key === 'Enter' || event.key === 'Tab') {
      if (visible.length) run(root, selected && visible.includes(selected) ? selected : visible[0]);
      return;
    }
    if (!visible.length) return;

    const available = new Set(visible);
    const lines = [...root.querySelectorAll<HTMLElement>('[data-bc-command-group]')]
      .map((line) => ({
        id: line.dataset.bcCommandGroup ?? '',
        items: [...line.children]
          .map((button) => proxySources.get(button))
          .filter((row): row is RowSource => Boolean(row && available.has(row))),
      }))
      .filter((line) => line.items.length);

    let y = selected ? lines.findIndex((line) => line.items.includes(selected)) : -1;
    if (y < 0) y = 0;
    let x = selected ? Math.max(0, lines[y].items.indexOf(selected)) : 0;
    let next: RowSource;

    if (event.key === 'Home' || event.key === 'End') {
      next = event.key === 'Home' ? visible[0] : visible.at(-1)!;
      columns.delete(root);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const line = lines[y].items;
      x = (x + (event.key === 'ArrowLeft' ? -1 : 1) + line.length) % line.length;
      next = line[x];
      columns.set(root, x);
    } else {
      const desired = columns.get(root) ?? x;
      const direction = event.key === 'ArrowUp' ? -1 : 1;
      let line: RowSource[];
      if (groupJump) {
        const groupIds = [...new Set(lines.map((l) => l.id))];
        const index = groupIds.indexOf(lines[y].id);
        const target = groupIds[(index + direction + groupIds.length) % groupIds.length];
        const candidates = lines.filter((l) => l.id === target).map((l) => l.items);
        if (direction < 0) candidates.reverse();
        line =
          candidates.find((items) => items.length > desired) ||
          candidates.reduce((best, items) => (items.length > best.length ? items : best));
      } else {
        line = lines[(y + direction + lines.length) % lines.length].items;
      }
      next = line[Math.min(desired, line.length - 1)];
      columns.set(root, desired);
    }

    selectRow(root, next);
    const target = visualOf(root, next);
    const bounds = root.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    if (rect.top < bounds.top) root.scrollTop -= bounds.top - rect.top;
    else if (rect.bottom > bounds.bottom) root.scrollTop += rect.bottom - bounds.bottom;
    const line = target.closest('[data-bc-command-group]');
    if (line) {
      const box = line.getBoundingClientRect();
      if (rect.left < box.left) line.scrollLeft -= box.left - rect.left;
      else if (rect.right > box.right) line.scrollLeft += rect.right - box.right;
    }
  }

  function pointermove(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('[data-bc-menu-button]');
    const row = button
      ? proxySources.get(button)
      : target?.closest<HTMLElement>('[data-bc-command]:not([data-bc-command-hidden])');
    const root = (button || (row instanceof Element ? row : null))?.closest(
      `${NATIVE_SELECTOR},[data-bc-standalone-root]`,
    );
    if (row && root && (root === standalone.element || eligible(root))) {
      columns.delete(root);
      selectRow(root, row);
    }
  }

  function onInput(event: Event): void {
    const target = event.target;
    if (target instanceof Element && target.matches(EDITOR_SELECTOR) && target.closest(COMPOSER_SELECTOR)) {
      scheduleStandalone();
    }
  }

  function onOutside(event: PointerEvent): void {
    const target = event.target;
    if (
      standalone.open &&
      target instanceof Node &&
      !standalone.element?.contains(target) &&
      !(target instanceof Element && target.closest(COMPOSER_SELECTOR))
    ) {
      closeStandalone();
    }
  }

  function applyPrompts(requests: string[], entries: PromptEntry[], keep: boolean): void {
    const targets = [...openings].filter(
      ([root, opening]) => root.isConnected && eligible(root) && !opening.loaded && requests.includes(opening.request),
    );
    const standaloneTarget =
      standalone.open && !standalone.loaded && standalone.request !== null && requests.includes(standalone.request);
    if (!targets.length && !standaloneTarget) return;
    if (keep) lastPrompts = entries;

    const prompts = new Map(entries.map(({ name, body }) => [`prompt:${name}`, body]));
    const promptGroups = nameLayout(
      'prompts',
      entries.map(({ name }) => {
        const id = `prompt:${name}`;
        return { row: id, item: { id, title: name } };
      }),
    );

    for (const [, opening] of targets) {
      clearTimeout(opening.promptTimer);
      opening.promptTimer = 0;
      opening.loaded = keep;
      if (!keep || !opening.promptFrozen) {
        opening.prompts = prompts;
        opening.promptGroups = promptGroups;
      }
    }
    if (standaloneTarget) {
      clearTimeout(standalone.promptTimer);
      standalone.promptTimer = 0;
      standalone.loaded = keep;
      if (!keep || !standalone.promptFrozen) standalone.entries = entries;
    }
    refresh();
  }

  window.addEventListener('keydown', keydown, true);
  window.addEventListener('mousemove', pointermove, true);
  document.addEventListener('input', onInput, true);
  document.addEventListener('focusin', schedule, true);
  document.addEventListener('pointerdown', onOutside, true);
  window.addEventListener('resize', positionStandalone);

  window.__codexCommandMenu = {
    catalog: commandCatalog,
    skillEntries,
    update(value, order) {
      if (typeof order?.enabled === 'boolean') enabled = order.enabled;
      preferences = normalize(value);
      skillVisible = normalizeSkillVisible(order?.skillVisible ?? skillVisible);
      groupOrder = normalizeGroupOrder(order?.groupOrder ?? groupOrder);
      itemOrder = normalizeItemOrder(order?.itemOrder ?? itemOrder);
      refresh();
    },
    entries() {
      return [...discovered]
        .filter(([id]) => !COMMANDS.some((item) => item.id === id))
        .map(([id, title]) => ({ id, title, group: 'other' }));
    },
    promptRequests() {
      const requests = [...openings]
        .filter(([root, opening]) => root.isConnected && eligible(root) && !opening.loaded)
        .map(([, opening]) => opening.request);
      if (standalone.open && !standalone.loaded && standalone.request) requests.push(standalone.request);
      return requests;
    },
    promptState({ requests, entries }) {
      applyPrompts(requests, entries, true);
    },
    remove() {
      disposed = true;
      closeStandalone();
      observer.disconnect();
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('mousemove', pointermove, true);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('focusin', schedule, true);
      document.removeEventListener('pointerdown', onOutside, true);
      window.removeEventListener('resize', positionStandalone);
      for (const view of views.values()) view.surface.remove();
      views.clear();
      for (const root of openings.keys()) restore(root);
      for (const node of managed) clearNode(node);
      managed.clear();
      standalone.element?.remove();
      style.remove();
      delete window.__codexCommandMenu;
    },
  };

  refresh();
}

installCommandMenu();
