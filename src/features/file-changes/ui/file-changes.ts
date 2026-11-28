// Local presentation only; leave file actions and React state ownership to Codex.
import styles from './file-changes.css';

interface FileListInfo {
  body: Element;
  footer: HTMLButtonElement | null;
  count: number;
}

interface CardRecord {
  header: Element;
  body: Element;
  button: HTMLButtonElement;
  label: HTMLSpanElement;
  expanded: boolean;
  manual: boolean;
  openedNative: boolean;
  pendingFooter: HTMLButtonElement | null;
}

const HEADER_SELECTOR = '.thread-scroll-container [class~="group/turn-diff-header"]';
const LIST_MARKER = 'data-codex-hud-file-list';
const TOGGLE_MARKER = 'data-codex-hud-file-toggle';
const TOGGLE_CLASS =
  'flex h-9 w-full cursor-interaction items-center gap-2 rounded-b-lg ' +
  'px-[var(--resource-card-row-padding-x)] py-[var(--turn-diff-row-padding-y)] ' +
  'text-start text-size-chat text-default hover:bg-background-primary-ghost-hover/30 ' +
  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset';

function installFileChanges(): boolean {
  if (window.__codexFileChanges) return false;
  const i18n = window.__codexHudI18n!;
  const records = new Map<Element, CardRecord>();
  const suspended = new Map<Element, boolean>();
  let defaultCollapsed = true;

  const style = document.createElement('style');
  style.id = 'codex-hud-file-changes';
  style.textContent = styles;
  document.head.append(style);

  function inspect(header: Element): FileListInfo | null {
    const body = header.nextElementSibling;
    if (
      !body?.matches('div.flex.flex-col.border-t') ||
      !body.classList.contains('[--codex-diffs-header-padding-x:var(--resource-card-row-padding-x)]')
    ) {
      return null;
    }

    const children = [...body.children];
    const last = children.at(-1);
    const footer = last?.matches('button[aria-expanded]')
      ? (children.pop() as HTMLButtonElement)
      : null;

    if (children.length < 2 || children.some((el) => el.tagName !== 'DIV')) return null;

    let count = children.length;
    if (footer?.getAttribute('aria-expanded') === 'false') {
      // Only the native aggregate count is read, never filenames or chat text.
      const numbers = (footer.textContent ?? '').match(/\d[\d,\u00a0\u202f]*/g);
      const remaining =
        numbers?.length === 1 ? Number(numbers[0].replace(/[,\u00a0\u202f]/g, '')) : NaN;
      if (!Number.isSafeInteger(remaining) || remaining <= 0) return null;
      count += remaining;
    }

    return { body, footer, count };
  }

  function release(record: CardRecord): void {
    record.body.removeAttribute(LIST_MARKER);
    record.button.remove();
    if (record.openedNative && record.body.isConnected) {
      const footer = record.body.lastElementChild;
      if (footer instanceof HTMLButtonElement && footer.matches('button[aria-expanded="true"]')) {
        footer.click();
      }
    }
  }

  function sync(record: CardRecord, info: FileListInfo): void {
    const { body, footer, count } = info;
    const expandedAttr = String(record.expanded);
    const mode = record.expanded ? 'open' : 'closed';

    if (body.getAttribute(LIST_MARKER) !== mode) body.setAttribute(LIST_MARKER, mode);
    if (record.button.getAttribute('aria-expanded') !== expandedAttr) {
      record.button.setAttribute('aria-expanded', expandedAttr);
    }

    const label = i18n.t(record.expanded ? 'collapseFiles' : 'expandFiles', { count });
    if (record.button.lang !== i18n.locale()) record.button.lang = i18n.locale();
    if (record.label.textContent !== label) record.label.textContent = label;
    if (!record.button.isConnected) record.header.parentElement?.append(record.button);

    // Use the native reveal action once so all files, including those not yet
    // mounted by React, become available. Do not reach into private React state.
    if (
      record.expanded &&
      footer?.getAttribute('aria-expanded') === 'false' &&
      record.pendingFooter !== footer
    ) {
      record.pendingFooter = footer;
      record.openedNative = true;
      footer.click();
    }
    if (footer?.getAttribute('aria-expanded') === 'true') {
      record.pendingFooter = null;
    }
  }

  function createRecord(
    header: Element,
    info: FileListInfo,
    expanded = !defaultCollapsed,
    manual = false,
  ): CardRecord {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute(TOGGLE_MARKER, '');
    button.className = TOGGLE_CLASS;

    const label = document.createElement('span');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('class', 'icon-2xs');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('aria-hidden', 'true');

    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', 'm4 6 4 4 4-4');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.5');
    svg.append(path);
    button.append(label, svg);

    const record: CardRecord = {
      header,
      body: info.body,
      button,
      label,
      expanded,
      manual,
      openedNative: false,
      pendingFooter: null,
    };

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const current = inspect(header);
      if (!current || current.body !== record.body) {
        scan();
        return;
      }
      record.manual = true;
      record.expanded = !record.expanded;
      record.pendingFooter = null;
      sync(record, current);
    });

    return record;
  }

  function scan() {
    const isMounted = (header: Element) => header.isConnected && header.matches(HEADER_SELECTOR);
    for (const header of suspended.keys()) {
      if (!isMounted(header)) suspended.delete(header);
    }

    for (const [header, record] of records) {
      const stillMounted = isMounted(header);
      if (!stillMounted || !inspect(header)) {
        if (stillMounted && record.manual) suspended.set(header, record.expanded);
        release(record);
        records.delete(header);
      }
    }

    for (const header of document.querySelectorAll(HEADER_SELECTOR)) {
      const info = inspect(header);
      if (!info) continue;
      let record = records.get(header);
      if (record && record.body !== info.body) {
        const { expanded, manual, openedNative } = record;
        release(record);
        record = createRecord(header, info, expanded, manual);
        record.openedNative = openedNative;
        records.set(header, record);
      }
      // A temporarily single-file card is native, but its mounted header still owns the user's choice.
      if (!record) {
        record = createRecord(header, info, suspended.get(header), suspended.has(header));
        suspended.delete(header);
        records.set(header, record);
      }
      sync(record, info);
    }

    return {
      cards: records.size,
      expanded: [...records.values()].filter((r) => r.expanded).length,
      defaultCollapsed,
    };
  }

  function setDefaultCollapsed(value: boolean) {
    if (typeof value !== 'boolean' || value === defaultCollapsed) return scan();
    defaultCollapsed = value;
    for (const record of records.values()) {
      if (record.manual) continue;
      record.expanded = !value;
      record.pendingFooter = null;
      const current = inspect(record.header);
      if (current && current.body === record.body) sync(record, current);
    }
    return scan();
  }

  const isOwnNode = (node: Node) =>
    (node instanceof Element ? node : node.parentElement)?.closest(
      `[${TOGGLE_MARKER}],#codex-composer-hud`,
    );

  const observer = new MutationObserver((changes) => {
    const hasExternal = changes.some(
      (change) =>
        !isOwnNode(change.target) &&
        (change.type !== 'childList' ||
          [...change.addedNodes, ...change.removedNodes].some((node) => !isOwnNode(node))),
    );
    if (hasExternal) scan();
  });

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'aria-expanded'],
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  window.addEventListener('languagechange', scan);

  window.__codexFileChanges = {
    snapshot: scan,
    setDefaultCollapsed,
    remove() {
      observer.disconnect();
      window.removeEventListener('languagechange', scan);
      records.forEach(release);
      records.clear();
      suspended.clear();
      style.remove();
      delete window.__codexFileChanges;
    },
  };

  scan();
  return true;
}

installFileChanges();
