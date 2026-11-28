// Fold only the confirmed main-thread composer; never reparent or rewrite native content.
import styles from './composer-fold.css';

type FoldMode = 'off' | 'minimize' | 'hide';
type FoldState = 'open' | 'minimize' | 'hide' | 'opening' | 'closing';

interface FixedStatusInfo {
  row: HTMLElement;
  layer: Element;
  path: HTMLElement[];
}

interface ComposerFields {
  body: HTMLElement;
  editor: HTMLElement;
  attachments: Element;
}

interface ComposerBinding extends ComposerFields {
  root: HTMLElement;
  scroll: HTMLElement;
  shell: HTMLElement;
  track: HTMLElement;
  id: string;
  status: FixedStatusInfo | null;
}

interface SendAttempt {
  id: string | null;
  root: HTMLElement;
  button: HTMLButtonElement | null;
  previous: string | null;
  expires: number;
}

interface SidebarClick {
  row: Element;
  button: HTMLButtonElement;
  key: string | null;
  from: string | undefined;
  expires: number;
}

interface StandbyState {
  editor: HTMLElement;
  path: HTMLElement[];
  origin: Element | null;
  layout?: (number | Element | undefined)[];
}

const ROOT_SELECTOR = '[data-codex-composer-root][data-composer-placement="thread"]';
const INACTIVE_PAGE =
  '[data-app-shell-active-page="false"],[data-right-panel-composer-overlay-content="true"]';
const INTERACTION_BLOCKED = '[inert],[aria-hidden="true"]';
const PERSISTENT_BLOCK =
  '[inert]:not([data-inert-ed]),[aria-hidden="true"]:not([data-aria-hidden])';
const INACTIVE = `${INTERACTION_BLOCKED},${INACTIVE_PAGE}`;
const POPUPS =
  '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],' +
  '[role="combobox"][aria-expanded="true"],[data-state="open"][data-side],[popover]:popover-open';
const INTERACTIVE =
  'button,a[href],input,textarea,select,summary,[contenteditable]:not([contenteditable="false"]),' +
  '[role="button"],[role="link"],[role="menuitem"],[role="option"],[role="tab"],[role="treeitem"],' +
  '[role="checkbox"],[role="switch"],[role="radio"],[role="combobox"],[role="textbox"],[tabindex]';
const SIDEBAR_ROW =
  '[data-app-action-sidebar-thread-row][data-app-action-sidebar-thread-host-id="local"]' +
  '[data-app-action-sidebar-thread-kind="local"]';
const ROW_ACTIVE = 'data-app-action-sidebar-thread-active';
const ROW_ID = 'data-app-action-sidebar-thread-id';
const UUID_RE = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const ENTRY_ATTRIBUTES = [
  'data-above-composer-conversation-id',
  'data-composer-placement',
  'data-app-shell-active-page',
  'data-app-shell-focus-area',
  'data-right-panel-composer-overlay-content',
];

const STATE_ATTR = 'data-bc-composer-fold';
const TRACK_ATTR = 'data-bc-composer-fold-track';
const PATH_ATTR = 'data-bc-fold-status-path';
const STATUS_ATTR = 'data-bc-fold-status-row';
const INPUT_PATH = 'data-bc-fold-input-path';
const INPUT_ATTR = 'data-bc-fold-input';
const MEASURE_ATTR = 'data-bc-fold-measure-input';
const INPUT_BOX = ['left', 'bottom', 'width', 'height'].map((key) => `--bc-fold-input-${key}`);

const DOUBLE_ENTER_MS = 350;
const SEND_TIMEOUT_MS = 3500;
const SIDEBAR_TIMEOUT_MS = 3000;

function installComposerFold(): void {
  if (window.__codexComposerFold) return;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const style = document.createElement('style');
  style.id = 'codex-hud-composer-fold';
  style.textContent = styles;

  const pill = document.createElement('button');
  pill.type = 'button';
  pill.id = 'codex-hud-expand-composer';
  pill.hidden = true;
  pill.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M4 22V4a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H8zM8 7h8m-8 3.5h8M8 14h5"/>' +
    '</svg><span></span>';
  const pillLabel = pill.lastElementChild as HTMLSpanElement;

  let mode: FoldMode = 'off';
  let binding: ComposerBinding | null = null;
  let threadId: string | null = null;
  let folded: FoldState = 'open';
  let animation: Animation[] = [];
  let openingSize: { end: number; shellInset: number } | null = null;
  let listeners: AbortController | null = null;
  let frame = 0;
  let foldAfterSend = false;
  let sendAttempt: SendAttempt | null = null;
  let sidebarClick: SidebarClick | null = null;
  let standby: StandbyState | null = null;
  let transcriptPointer: number | null = null;
  let enterAt = -Infinity;
  let pressed = false;
  let swallow = false;
  let composing = false;
  let escapeHeld = false;

  const isVisible = (el: Element | null | undefined) =>
    Boolean(
      el &&
        el.getClientRects().length &&
        el.getBoundingClientRect().height > 0 &&
        getComputedStyle(el).visibility === 'visible' &&
        !el.closest(INACTIVE),
    );
  const foldedOrClosing = () => folded === 'minimize' || folded === 'hide' || folded === 'closing';
  const resetKeys = () => {
    enterAt = -Infinity;
    pressed = false;
    swallow = false;
  };
  const inputResize = new ResizeObserver(() => schedule());

  function stopAnimation(): void {
    const previous = animation;
    animation = [];
    openingSize = null;
    for (const motion of previous) motion.cancel();
  }

  function commit(next: 'open' | 'minimize' | 'hide'): void {
    if (!binding) return;
    const { shell, track } = binding;
    stopAnimation();
    shell.removeAttribute('data-bc-fold-closing');
    if (next === 'open') {
      shell.removeAttribute(STATE_ATTR);
      track.removeAttribute(TRACK_ATTR);
      clearStandby();
    } else {
      shell.setAttribute(STATE_ATTR, next);
      track.setAttribute(TRACK_ATTR, '');
    }
    pill.hidden = next !== 'minimize';
    folded = next;
  }

  function detach(): void {
    resetKeys();
    clearStandby('blur');
    if (binding) {
      commit('open');
      setStatus(binding.status, false);
      pill.remove();
      binding = null;
    }
  }

  function isMainArea(root: Element, keepFolded = false): boolean {
    const area = root.closest('[data-app-shell-focus-area]');
    return (
      (!area || area.getAttribute('data-app-shell-focus-area') === 'main') &&
      !root.closest(INACTIVE_PAGE) &&
      !root.closest(keepFolded ? PERSISTENT_BLOCK : INTERACTION_BLOCKED)
    );
  }

  function composerFields(root: Element): ComposerFields | null {
    const bodies = root.querySelectorAll<HTMLElement>('[data-composer-body]');
    const editors = root.querySelectorAll<HTMLElement>('[data-codex-composer="true"]');
    if (bodies.length !== 1 || editors.length !== 1 || !bodies[0].contains(editors[0])) return null;
    const body = bodies[0];
    const editor = editors[0];
    const attachments = body.querySelectorAll('[data-composer-attachments]');
    return attachments.length === 1 ? { body, editor, attachments: attachments[0] } : null;
  }

  function fixedStatus(root: Element, track: Element, id: string): FixedStatusInfo | null {
    const owner = `[data-above-composer-conversation-id="${id}"]`;
    const rows = [
      ...root.querySelectorAll<HTMLElement>(
        `[data-above-composer-portal]${owner}>[data-in-progress-fixed-content]`,
      ),
    ];
    if (rows.length !== 1) return null;
    const row = rows[0];
    const layer = row.firstElementChild;
    if (
      row.childElementCount !== 1 ||
      !layer?.matches('div.absolute') ||
      !layer.querySelector('button') ||
      !layer.querySelector(`[data-above-composer-fixed-content-portal]${owner}`)
    ) {
      return null;
    }
    const path: HTMLElement[] = [];
    for (let node = row.parentElement; node; node = node.parentElement) {
      path.push(node);
      if (node === track) return { row, layer, path };
    }
    return null;
  }

  function setStatus(status: FixedStatusInfo | null | undefined, enabled: boolean): void {
    if (!status) return;
    status.row.toggleAttribute(STATUS_ATTR, enabled);
    for (const node of status.path) node.toggleAttribute(PATH_ATTR, enabled);
  }

  function bind(next: ComposerBinding): void {
    const before = binding?.status;
    const after = next.status;
    const changed =
      before?.row !== after?.row ||
      before?.layer !== after?.layer ||
      before?.path.some((node, index) => node !== after?.path[index]) ||
      before?.path.length !== after?.path.length;
    if (changed) {
      setStatus(before, false);
      setStatus(after, true);
    }
    binding = next;
    if (changed && animation.length && mode !== 'off') {
      commit(folded === 'opening' ? 'open' : mode);
    }
  }

  function find(keepFolded = false): ComposerBinding | null {
    const roots = [...document.querySelectorAll<HTMLElement>(ROOT_SELECTOR)].filter(
      (root) =>
        isMainArea(root, keepFolded && root === binding?.root) &&
        (root === binding?.root || isVisible(root)),
    );
    if (roots.length !== 1) return null;
    const root = roots[0];
    const scroll = root.closest<HTMLElement>('.thread-scroll-container');
    const shell = root.closest<HTMLElement>('[data-thread-find-composer]');
    const backdrop = shell?.parentElement;
    const tracks = shell ? ([...shell.children].filter((node) => node !== pill) as HTMLElement[]) : [];
    const ids = new Set(
      [...root.querySelectorAll('[data-above-composer-conversation-id]')].map((node) =>
        node.getAttribute('data-above-composer-conversation-id'),
      ),
    );
    const id = ids.values().next().value;
    if (
      !scroll ||
      !shell ||
      !backdrop?.matches('[data-thread-composer-backdrop]') ||
      !backdrop.getBoundingClientRect().width ||
      getComputedStyle(backdrop).visibility !== 'visible' ||
      tracks.length !== 1 ||
      !tracks[0].contains(root) ||
      ids.size !== 1 ||
      !id ||
      !UUID_RE.test(id)
    ) {
      return null;
    }
    if (keepFolded && id !== binding?.id && !isMainArea(root)) return null;
    const fields = composerFields(root);
    return fields
      ? { root, scroll, shell, track: tracks[0], id, ...fields, status: fixedStatus(root, tracks[0], id) }
      : null;
  }

  function isReady({ scroll, root }: { scroll: Element; root: Element }): boolean {
    const message = scroll.querySelector(
      '[data-turn-key] :is([data-user-message-bubble][data-user-message-has-prompt],' +
        '[data-markdown-text-style="assistant-message"])' +
        ':not(:is([data-conversation-print] *,[data-codex-composer-root] *,[data-app-shell-active-page="false"] *))',
    );
    return Boolean(message && !root.contains(message));
  }

  function emptyDraft({ editor, attachments }: ComposerFields): boolean {
    if (attachments.childElementCount) return false;
    if (editor instanceof HTMLTextAreaElement) return editor.value === '';
    return (
      editor.matches('[contenteditable="true"]') &&
      Boolean(
        editor.querySelector(
          ':scope > p[data-empty-paragraph]:only-child > br.ProseMirror-trailingBreak:only-child',
        ),
      ) &&
      !editor.textContent
    );
  }

  const actionLabel = (node: Element) =>
    node.getAttribute('aria-label') || node.getAttribute('title') || '';
  const sendAction = (node: Element) =>
    /^(?:send(?:\s+(?:message|prompt|now))?|发送(?:消息|提示词|提示)?)(?:\s*[(（].*)?$/i.test(
      actionLabel(node),
    );
  const stopAction = (node: Element) => /^(stop|interrupt|停止|中断)/i.test(actionLabel(node));

  function safe(fields: ComposerBinding, keepFolded = false): boolean {
    const { root, body } = fields;
    if (
      !emptyDraft(fields) ||
      root.querySelector(
        '[data-codex-composer-request-navigation],[data-composer-expanded],' +
          '[data-codex-composer-queue],button[data-dictation-button][data-state="on"]',
      )
    ) {
      return false;
    }
    const unavailable = `[hidden],${keepFolded ? PERSISTENT_BLOCK : INTERACTION_BLOCKED}`;
    const controls = [...body.querySelectorAll('button')].filter((node) => !node.closest(unavailable));
    return (
      !controls.some((node) => /^(cancel|取消)/i.test(actionLabel(node))) &&
      controls.some(
        (node) => node.matches('[data-dictation-button]') || sendAction(node) || stopAction(node),
      )
    );
  }

  function latestUserTurn({ scroll, root }: { scroll: Element; root: Element }): string | null {
    const bubbles = scroll.querySelectorAll(
      '[data-turn-key] [data-user-message-bubble]:not(:is([data-conversation-print] *,' +
        '[data-codex-composer-root] *,[data-app-shell-active-page="false"] *))',
    );
    const bubble = bubbles[bubbles.length - 1];
    return bubble && !root.contains(bubble)
      ? (bubble.closest('[data-turn-key]')?.getAttribute('data-turn-key') ?? null)
      : null;
  }

  function armSend(event: Event): void {
    if (
      !foldAfterSend ||
      event.defaultPrevented ||
      composing ||
      (event instanceof KeyboardEvent && (event.isComposing || event.keyCode === 229 || event.repeat))
    ) {
      return;
    }
    const target = event.composedPath()[0];
    if (!(target instanceof Element)) return;
    const root = target.closest<HTMLElement>('[data-codex-composer-root]');
    const placement = root?.getAttribute('data-composer-placement') ?? '';
    if (!root || !isMainArea(root) || !['thread', 'home'].includes(placement)) return;
    const current = placement === 'thread' ? find() : null;
    if (placement === 'thread' && current?.root !== root) return;
    const fields = current || composerFields(root);
    if (!fields || emptyDraft(fields)) return;
    const button = event.type === 'click' ? target.closest<HTMLButtonElement>('button') : null;
    if (
      event.type === 'click'
        ? !button ||
          !fields.body.contains(button) ||
          !sendAction(button) ||
          button.matches(':disabled,[aria-disabled="true"]')
        : !(event instanceof KeyboardEvent) ||
          event.key !== 'Enter' ||
          !fields.editor.contains(target)
    ) {
      return;
    }
    sendAttempt = {
      id: current?.id || null,
      root,
      button,
      previous: current ? latestUserTurn(current) : null,
      expires: performance.now() + SEND_TIMEOUT_MS,
    };
  }

  function confirmSend(next: ComposerBinding): SendAttempt | null {
    const attempt = sendAttempt;
    if (!attempt) return null;
    if (performance.now() > attempt.expires || (attempt.id && next.id !== attempt.id)) {
      sendAttempt = null;
      return null;
    }
    if (!emptyDraft(next)) return null;
    const turn = latestUserTurn(next);
    if (!turn || turn === attempt.previous) return null;
    sendAttempt = null;
    return attempt;
  }

  function menuOutside(popup: Element, root: Element): boolean {
    if (!popup.matches('[role="menu"]') || root.contains(popup)) return false;
    const owner = document.getElementById(popup.getAttribute('aria-labelledby') || '');
    return (
      !root.contains(owner) &&
      (!popup.id || !root.querySelector(`[aria-controls="${CSS.escape(popup.id)}"]`))
    );
  }

  function overlayOpen(ignoreMenusOutside: Element | null = null): boolean {
    return (
      Boolean(window.__codexComposerHud?.settingsOpen?.()) ||
      [...document.querySelectorAll(POPUPS)].some(
        (popup) =>
          isVisible(popup) && (!ignoreMenusOutside || !menuOutside(popup, ignoreMenusOutside)),
      )
    );
  }

  function clearStandby(returnFocus?: 'origin' | 'blur'): void {
    if (!standby) return;
    const { editor, path, origin } = standby;
    standby = null;
    inputResize.disconnect();
    if (returnFocus && document.activeElement === editor) {
      if (returnFocus === 'origin' && origin === binding?.scroll && isVisible(origin)) {
        (origin as HTMLElement).focus({ preventScroll: true });
      }
      if (document.activeElement === editor) editor.blur();
    }
    editor.removeAttribute(INPUT_ATTR);
    for (const property of INPUT_BOX) editor.style.removeProperty(property);
    for (const node of path) node.removeAttribute(INPUT_PATH);
  }

  function positionStandby(): void {
    if (!standby || !binding || (folded !== 'minimize' && folded !== 'hide')) return;
    const { shell, editor } = binding;
    const base = shell.getBoundingClientRect();
    const layout = [base.width, base.height, innerWidth, innerHeight, devicePixelRatio, binding.status?.row];
    if (layout.every((value, index) => value === standby?.layout?.[index])) return;
    standby.layout = layout;
    shell.setAttribute(MEASURE_ATTR, '');
    const bounds = editor.getBoundingClientRect();
    shell.removeAttribute(MEASURE_ATTR);
    if (!bounds.width || !bounds.height) return;
    const css = getComputedStyle(shell);
    const values = [
      bounds.left - base.left - parseFloat(css.borderLeftWidth),
      base.bottom - bounds.bottom - parseFloat(css.borderBottomWidth),
      bounds.width,
      bounds.height,
    ];
    for (const [index, property] of INPUT_BOX.entries()) {
      editor.style.setProperty(property, `${values[index]}px`);
    }
  }

  function prepareInput(): void {
    if (!binding || !foldedOrClosing() || transcriptPointer !== null) return;
    const { editor, scroll, root, track } = binding;
    const active = document.activeElement;
    if (
      !standby &&
      (!document.hasFocus() ||
        document.getSelection()?.isCollapsed === false ||
        ![scroll, document.body, document.documentElement].includes(active as HTMLElement))
    ) {
      return;
    }
    const available =
      isMainArea(root) &&
      editor.matches('[contenteditable="true"],textarea:not([readonly]):not(:disabled)') &&
      !editor.closest(`[hidden],${INACTIVE}`) &&
      !overlayOpen();
    if (standby) {
      if (
        available &&
        active === editor &&
        standby.editor === editor &&
        standby.path.at(-1) === track &&
        standby.path.every((node, index) => node === (standby!.path[index - 1] || editor).parentElement)
      ) {
        positionStandby();
        return;
      }
      clearStandby('blur');
      return;
    }
    if (!available) return;

    const path: HTMLElement[] = [];
    for (let node = editor.parentElement; node; node = node.parentElement) {
      path.push(node);
      if (node !== track) continue;
      standby = { editor, path, origin: active };
      for (const part of path) part.setAttribute(INPUT_PATH, '');
      editor.setAttribute(INPUT_ATTR, '');
      positionStandby();
      editor.focus({ preventScroll: true });
      if (document.activeElement !== editor) clearStandby();
      else inputResize.observe(binding.shell);
      return;
    }
  }

  function armSidebarFocus(event: MouseEvent): void {
    const pointerType = (event as PointerEvent).pointerType;
    if (
      !event.isTrusted ||
      event.defaultPrevented ||
      event.detail === 0 ||
      event.button !== 0 ||
      (pointerType && pointerType !== 'mouse') ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      composing
    ) {
      return;
    }
    const target = event.composedPath()[0];
    const button = target instanceof Element ? target.closest<HTMLButtonElement>('button') : null;
    if (!button?.hasAttribute('data-interactive-row-button') || button.matches(':disabled,[aria-disabled="true"]')) {
      return;
    }
    const row = button.closest(SIDEBAR_ROW);
    if (!row) return;
    sidebarClick = {
      row,
      button,
      key: row.getAttribute(ROW_ID),
      from: threadId ?? find()?.id,
      expires: performance.now() + SIDEBAR_TIMEOUT_MS,
    };
    schedule();
  }

  function sidebarMatches(row: Element, id: string): boolean {
    const raw = row.getAttribute(ROW_ID);
    if (raw === `local:${id}`) return true;
    const prefix = 'local:client-new-thread:';
    const alias = raw?.slice(prefix.length) ?? '';
    if (!raw?.startsWith(prefix) || !UUID_RE.test(alias)) return false;
    const key = Object.getOwnPropertyNames(row).find((name) => name.startsWith('__reactFiber$'));
    const owners = new Set<string>();
    for (
      let fiber = key ? (row as unknown as Record<string, any>)[key] : null, depth = 0;
      fiber && depth < 12;
      fiber = fiber.return, depth++
    ) {
      const props = fiber.memoizedProps;
      const actual = props?.conversationId;
      if (
        props?.rowRef?.current === row &&
        props.hostId === 'local' &&
        !props.isCodexCloudTask &&
        typeof actual === 'string' &&
        UUID_RE.test(actual) &&
        actual !== alias
      ) {
        owners.add(actual);
      }
    }
    return owners.size === 1 && owners.has(id);
  }

  function matchingSidebarClick(): SidebarClick | null {
    if (!sidebarClick || !binding) return null;
    const { row, button, key, expires } = sidebarClick;
    const { id, scroll } = binding;
    if (performance.now() > expires || !row.contains(button) || row.getAttribute(ROW_ID) !== key) {
      sidebarClick = null;
      return null;
    }
    return scroll.hasAttribute('tabindex') && isVisible(scroll) && sidebarMatches(row, id)
      ? sidebarClick
      : null;
  }

  function handoffSidebarFocus(): void {
    const click = matchingSidebarClick();
    if (
      !click ||
      !binding ||
      document.activeElement !== click.button ||
      click.row.getAttribute(ROW_ACTIVE) !== 'true' ||
      !isVisible(click.button) ||
      overlayOpen()
    ) {
      return;
    }
    sidebarClick = null;
    binding.scroll.focus({ preventScroll: true });
  }

  function canFold(allowedFocus?: Element | null, keepClosing = false): boolean {
    if (!binding) return false;
    const active = document.activeElement;
    return (
      !composing &&
      (!binding.root.contains(active) || active === allowedFocus || active === standby?.editor) &&
      !active?.closest('#codex-composer-hud') &&
      !binding.root.querySelector('[aria-expanded="true"]') &&
      !overlayOpen(keepClosing ? binding.root : null)
    );
  }

  function updatePillSurface(): void {
    if (!binding?.body.parentElement) return;
    const background = getComputedStyle(binding.body.parentElement).backgroundColor;
    pill.style.setProperty('--bc-composer-surface', background === 'rgba(0, 0, 0, 0)' ? '' : background);
  }

  function relativeCenter(element: Element, shell: Element): [number, number] | null {
    const rect = element.getBoundingClientRect();
    const bounds = shell.getBoundingClientRect();
    return rect.width && rect.height
      ? [rect.left + rect.width / 2 - bounds.left, rect.top + rect.height / 2 - bounds.bottom]
      : null;
  }

  function shift(from: [number, number] | null | undefined, base: [number, number] | null | undefined): string {
    return from && base ? `translate(${from[0] - base[0]}px,${from[1] - base[1]}px)` : 'none';
  }

  function fitOpeningHeight(): void {
    if (!openingSize || !binding || !animation[0]) return;
    const { shell, track } = binding;
    const motion = animation[0];
    const end = track.getBoundingClientRect().height + openingSize.shellInset;
    if (Math.abs(end - openingSize.end) < 0.5) return;
    const effect = motion.effect as KeyframeEffect;
    const start = shell.getBoundingClientRect().height;
    const remaining = Number(effect.getComputedTiming().endTime ?? 0) - Number(motion.currentTime ?? 0);
    effect.setKeyframes([{ height: `${start}px` }, { height: `${end}px` }]);
    effect.updateTiming({ duration: Math.max(32, remaining) });
    motion.currentTime = 0;
    openingSize.end = end;
  }

  function transition(next: 'open' | 'minimize' | 'hide'): void {
    if (!binding) return;
    const { shell, track, status, body } = binding;
    if (folded === next) return;
    if (reduced.matches) {
      commit(next);
      return;
    }
    const start = shell.getBoundingClientRect().height;
    const previous = folded;
    const surface = status ? body : track;
    const current = getComputedStyle(surface);
    const currentScale = current.scale;
    const currentOpacity = current.opacity;
    const miniOpacity = getComputedStyle(pill).opacity;
    const badgeFrom = status ? relativeCenter(status.layer, shell) : null;
    const pillFrom = status ? relativeCenter(pill, shell) : null;

    if (previous === 'open') updatePillSurface();
    commit(next);
    const end = shell.getBoundingClientRect().height;
    if (next === 'open') openingSize = { end, shellInset: end - track.getBoundingClientRect().height };

    const badgeTo = status ? relativeCenter(status.layer, shell) : null;
    const pillTo = status ? relativeCenter(pill, shell) : null;
    const mini = next === 'minimize' || previous === 'minimize';
    pill.hidden = !mini;
    const scale = mini
      ? Math.min(1, pill.getBoundingClientRect().width / Math.max(1, shell.getBoundingClientRect().width))
      : 0.96;

    shell.setAttribute(STATE_ATTR, 'moving');
    track.setAttribute(TRACK_ATTR, '');
    shell.toggleAttribute('data-bc-fold-closing', next !== 'open');

    const options: KeyframeAnimationOptions = {
      duration: next === 'open' ? 220 : 150,
      easing: 'cubic-bezier(.22,.75,.25,1)',
      fill: 'both',
    };
    const startingVisible = previous === 'open' || previous === 'opening' || previous === 'closing';
    const motion = shell.animate([{ height: `${start}px` }, { height: `${end}px` }], options);
    animation = [
      motion,
      surface.animate(
        [
          { scale: startingVisible ? currentScale : `${scale} 1`, opacity: startingVisible ? currentOpacity : '0' },
          { scale: next === 'open' ? '1 1' : `${scale} 1`, opacity: next === 'open' ? '1' : '0' },
        ],
        options,
      ),
    ];

    if (status) {
      const badgeBase = relativeCenter(status.layer, shell);
      if (badgeFrom && badgeTo && badgeBase) {
        animation.push(
          status.row.animate(
            [{ transform: shift(badgeFrom, badgeBase) }, { transform: shift(badgeTo, badgeBase) }],
            options,
          ),
        );
      }
    }

    if (mini) {
      const pillBase = status ? relativeCenter(pill, shell) : null;
      animation.push(
        pill.animate(
          [
            {
              opacity:
                previous === 'minimize'
                  ? '1'
                  : previous === 'opening' || previous === 'closing'
                    ? miniOpacity
                    : '0',
              transform: shift(pillFrom || pillTo, pillBase),
            },
            {
              opacity: next === 'minimize' ? '1' : '0',
              transform: shift(pillTo || pillFrom, pillBase),
            },
          ],
          options,
        ),
      );
    }

    folded = next === 'open' ? 'opening' : 'closing';
    motion.onfinish = () => {
      if (animation[0] === motion) {
        commit(next);
        prepareInput();
      }
    };
  }

  function check(): void {
    frame = 0;
    if (mode === 'off') return;
    reconcile();
    prepareInput();
  }

  function reconcile(): void {
    if (mode === 'off') return;
    const next = find(foldedOrClosing());
    if (!next || !isReady(next)) {
      if (next?.id !== threadId) threadId = null;
      detach();
      return;
    }

    const entering = next.id !== threadId;
    if (
      entering &&
      next.scroll.querySelector('[data-turn-key] [data-response-update-thread]') &&
      !next.scroll.querySelector(`[data-turn-key] [data-response-update-thread="${next.id}"]`)
    ) {
      detach();
      return;
    }

    threadId = next.id;
    if (next.root !== binding?.root || next.id !== binding?.id || next.track !== binding?.track) {
      detach();
      bind(next);
      pill.hidden = true;
      binding!.shell.append(pill);
    } else {
      bind(next);
    }

    if (!pill.isConnected) binding!.shell.append(pill);
    const label = window.__codexHudI18n!.t('expandComposer');
    if (pillLabel.textContent !== label) {
      pillLabel.textContent = label;
      pill.title = window.__codexHudI18n!.t('composerFoldShortcut');
    }

    const sent = confirmSend(next);
    const active = document.activeElement;
    if (sent && safe(binding!) && canFold(active === sent.button ? sent.button : binding!.editor)) {
      if ((active === binding!.editor || active === sent.button) && active instanceof HTMLElement) {
        active.blur();
      }
      transition(mode);
      return;
    }

    if (folded === 'opening') fitOpeningHeight();
    if (!safe(binding!, foldedOrClosing())) {
      if (folded !== 'opening') {
        clearStandby('origin');
        commit('open');
      }
      resetKeys();
      return;
    }

    const click = active === next.editor ? matchingSidebarClick() : null;
    const restoredFocus = click && click.from !== next.id;
    if ((entering || restoredFocus) && canFold(restoredFocus ? next.editor : undefined)) {
      if (restoredFocus) {
        sidebarClick = null;
        next.scroll.focus({ preventScroll: true });
        if (next.root.contains(document.activeElement)) return;
      }
      if (mode === 'minimize') updatePillSurface();
      commit(mode);
      handoffSidebarFocus();
      return;
    }

    if (folded === 'closing') {
      if (!canFold(undefined, true)) transition('open');
      else handoffSidebarFocus();
      return;
    }
    if (folded === 'minimize' || folded === 'hide') {
      if (folded !== mode) transition(mode);
      handoffSidebarFocus();
      return;
    }
    if (canFold()) {
      transition(mode);
      handoffSidebarFocus();
    }
  }

  function schedule(): void {
    if (!frame) frame = requestAnimationFrame(check);
  }

  function wake(fromInput = false): boolean {
    const latest = find();
    if (
      !binding ||
      latest?.root !== binding.root ||
      latest?.id !== binding.id ||
      latest.track !== binding.track ||
      !isReady(latest) ||
      (fromInput && latest.editor !== standby?.editor)
    ) {
      detach();
      return false;
    }
    if (overlayOpen()) {
      clearStandby('blur');
      return false;
    }
    sendAttempt = null;
    bind(latest);
    transition('open');
    if (document.activeElement !== binding.editor) binding.editor.focus({ preventScroll: true });
    return true;
  }

  const consume = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const plainKey = (event: KeyboardEvent) =>
    !event.defaultPrevented &&
    !event.isComposing &&
    event.keyCode !== 229 &&
    !composing &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey;

  function foldOnEscape(event: KeyboardEvent): void {
    if (mode === 'off') return;
    const active = document.activeElement;
    if (
      !event.isTrusted ||
      !plainKey(event) ||
      event.repeat ||
      !binding ||
      active !== binding.editor ||
      (folded !== 'open' && folded !== 'opening')
    ) {
      return;
    }
    const next = find();
    if (
      !next ||
      next.root !== binding.root ||
      next.id !== binding.id ||
      next.track !== binding.track ||
      next.editor !== active ||
      !isReady(next) ||
      !safe(next) ||
      !canFold(active)
    ) {
      return;
    }
    bind(next);
    escapeHeld = true;
    consume(event);
    (active as HTMLElement).blur();
    transition(mode);
    prepareInput();
  }

  const isInputKey = (event: KeyboardEvent) =>
    event.isComposing ||
    event.keyCode === 229 ||
    event.key === 'Process' ||
    event.key === 'Dead' ||
    (event.key.length === 1 &&
      event.key !== ' ' &&
      ((!event.altKey && !event.ctrlKey && !event.metaKey) || event.getModifierState('AltGraph')));

  function standbyEvent(event: Event): boolean {
    return Boolean(
      standby &&
        event.isTrusted &&
        standby.editor === event.composedPath()[0] &&
        document.activeElement === standby.editor,
    );
  }

  function keydown(event: KeyboardEvent): void {
    sidebarClick = null;
    if (escapeHeld && event.key === 'Escape') {
      consume(event);
      return;
    }
    const parked = standbyEvent(event);
    if (parked && !event.defaultPrevented) {
      if (isInputKey(event)) {
        enterAt = -Infinity;
        wake(true);
        return;
      }
      if (
        event.key === 'Tab' ||
        event.key === ' ' ||
        event.key === 'Escape' ||
        /^(?:Arrow(?:Up|Down|Left|Right)|Page(?:Up|Down)|Home|End)$/.test(event.key)
      ) {
        enterAt = -Infinity;
        clearStandby('origin');
        return;
      }
    }
    if (event.key === 'Escape') {
      enterAt = -Infinity;
      foldOnEscape(event);
      return;
    }
    if (swallow && event.key === 'Enter' && event.repeat) {
      consume(event);
      return;
    }
    if (event.key === 'Enter') armSend(event);
    const target = event.composedPath()[0];
    const inside =
      parked ||
      target === document.body ||
      target === document.documentElement ||
      (target instanceof Element &&
        Boolean(binding?.scroll.contains(target)) &&
        (!target.closest(INTERACTIVE) || target === binding?.scroll));

    if (
      event.key !== 'Enter' ||
      !plainKey(event) ||
      !inside ||
      !binding ||
      !foldedOrClosing() ||
      overlayOpen()
    ) {
      if (parked && event.key === 'Enter' && !event.defaultPrevented) consume(event);
      enterAt = -Infinity;
      return;
    }
    if (parked) consume(event);
    if (event.repeat || pressed) {
      enterAt = -Infinity;
      return;
    }
    pressed = true;
    const now = performance.now();
    if (now - enterAt <= DOUBLE_ENTER_MS) {
      enterAt = -Infinity;
      if (wake()) {
        swallow = true;
        consume(event);
      }
    } else {
      enterAt = now;
    }
  }

  function keyup(event: KeyboardEvent): void {
    if (event.key === 'Escape' && escapeHeld) {
      escapeHeld = false;
      consume(event);
    }
    if (event.key === 'Enter') {
      pressed = false;
      if (swallow) {
        swallow = false;
        consume(event);
      }
    }
  }

  const observer = new MutationObserver((records) => {
    const native = records.filter((record) => record.target !== pill && !pill.contains(record.target));
    if (!native.length) return;
    if (
      sendAttempt ||
      !binding?.root.isConnected ||
      native.some(
        (record) =>
          (record.attributeName && ENTRY_ATTRIBUTES.includes(record.attributeName)) ||
          (sidebarClick && (record.attributeName === ROW_ACTIVE || record.attributeName === ROW_ID)) ||
          (record.type === 'childList' &&
            (record.target === binding?.root || record.target === binding?.shell)),
      )
    ) {
      cancelAnimationFrame(frame);
      check();
    } else {
      schedule();
    }
  });

  function start(): void {
    document.head.append(style);
    listeners = new AbortController();
    const signal = listeners.signal;
    const on = <K extends keyof WindowEventMap>(
      target: EventTarget,
      type: string,
      fn: (event: any) => void,
    ) => target.addEventListener(type, fn, { capture: true, signal });

    on(window, 'keydown', keydown);
    on(window, 'keyup', keyup);
    on(window, 'focus', schedule);
    on(document, 'focusin', (event: FocusEvent) => {
      const target = event.target;
      if (target === standby?.editor) return;
      clearStandby();
      if (
        sidebarClick &&
        target !== sidebarClick.button &&
        !(
          target instanceof Element &&
          target.matches('[data-codex-composer="true"],.thread-scroll-container') &&
          isMainArea(target)
        )
      ) {
        sidebarClick = null;
      }
      enterAt = -Infinity;
      schedule();
    });
    on(document, 'focusout', schedule);
    on(document, 'beforeinput', (event: InputEvent) => {
      if (standbyEvent(event) && event.inputType?.startsWith('insert')) wake(true);
    });
    on(document, 'paste', (event: ClipboardEvent) => {
      if (standbyEvent(event)) wake(true);
    });
    on(document, 'input', (event: InputEvent) => {
      if (event.isTrusted) {
        sidebarClick = null;
        if (event.inputType?.startsWith('insert')) sendAttempt = null;
      }
      schedule();
    });
    on(document, 'click', (event: MouseEvent) => {
      armSend(event);
      armSidebarFocus(event);
    });
    on(document, 'pointerdown', (event: PointerEvent) => {
      enterAt = -Infinity;
      sidebarClick = null;
      const path = event.composedPath();
      if (sendAttempt && !path.includes(sendAttempt.root)) sendAttempt = null;
      if (
        event.isTrusted &&
        event.isPrimary &&
        event.button === 0 &&
        binding &&
        path.includes(binding.scroll) &&
        !path.includes(binding.shell)
      ) {
        transcriptPointer = event.pointerId;
        clearStandby('blur');
      }
      schedule();
    });

    const endTranscriptPress = (event: PointerEvent) => {
      if (event.isTrusted && event.pointerId === transcriptPointer) transcriptPointer = null;
      schedule();
    };
    on(window, 'pointerup', endTranscriptPress);
    on(window, 'pointercancel', endTranscriptPress);
    on(document, 'selectionchange', () => {
      if (foldedOrClosing() && transcriptPointer === null && !standby) schedule();
    });
    on(document, 'compositionstart', (event: CompositionEvent) => {
      composing = true;
      sidebarClick = null;
      resetKeys();
      if (standbyEvent(event)) wake(true);
      schedule();
    });
    on(document, 'compositionend', () => {
      composing = false;
      schedule();
    });
    on(window, 'blur', (event: FocusEvent) => {
      if (event.target === standby?.origin) return;
      composing = false;
      if (event.target === window) {
        sidebarClick = null;
        escapeHeld = false;
        transcriptPointer = null;
      }
      resetKeys();
    });
    on(window, 'resize', schedule);
    on(window, 'languagechange', schedule);
    on(reduced, 'change', () => {
      if (binding && animation.length && mode !== 'off') {
        commit(folded === 'opening' ? 'open' : mode);
      }
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        ...ENTRY_ATTRIBUTES,
        ROW_ACTIVE,
        ROW_ID,
        'data-response-update-thread',
        'data-empty-paragraph',
        'data-composer-expanded',
        'data-state',
        'aria-label',
        'aria-expanded',
        'aria-hidden',
        'inert',
        'hidden',
        'data-aria-hidden',
        'data-inert-ed',
      ],
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    schedule();
  }

  function stop(): void {
    listeners?.abort();
    listeners = null;
    observer.disconnect();
    cancelAnimationFrame(frame);
    frame = 0;
    composing = false;
    threadId = null;
    sendAttempt = null;
    sidebarClick = null;
    escapeHeld = false;
    transcriptPointer = null;
    detach();
    style.remove();
  }

  pill.addEventListener('click', () => wake());

  window.__codexComposerFold = {
    update(value, afterSend = false) {
      const next: FoldMode = value === 'minimize' || value === 'hide' ? value : 'off';
      const afterSendChanged = foldAfterSend !== (afterSend === true);
      if (!afterSendChanged && mode === next) return;
      mode = next;
      foldAfterSend = afterSend === true;
      if (!foldAfterSend) sendAttempt = null;
      if (next === 'off') stop();
      else if (!listeners) start();
      else schedule();
    },
    hides(root) {
      return binding?.root === root && folded !== 'open';
    },
    remove() {
      stop();
      delete window.__codexComposerFold;
    },
  };
}

installComposerFold();
