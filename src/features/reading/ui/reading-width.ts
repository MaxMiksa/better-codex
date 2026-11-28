// Layout only: inspect container geometry, never read conversation text.
import filePathCss from './reading-width.css';

interface ColumnSpec {
  min: number;
  max: number;
  gap: number;
}

interface ColumnCacheEntry {
  key: string;
  widths: ColumnSpec[];
}

const WIDTH_MARKER = 'data-codex-hud-reading-width';
const TITLE_MARKER = 'data-codex-hud-centered-title';
const TITLE_BAR = '[data-app-shell-main-titlebar] [data-app-shell-header-toolbar]';
const ASSISTANT_REPLY =
  '.thread-scroll-container [data-markdown-text-style="assistant-message"]' +
  ':not(:is([data-conversation-print], [data-conversation-print] *, ' +
  '[data-user-message-bubble] *, [data-codex-composer-root] *, [data-composer-body] *))';
const TABLE_MARKER = 'data-codex-hud-reading-table';
const TABLE_SELECTOR = `[${TABLE_MARKER}]>[class*="TableScroller"]>[class*="TableWrapper"]>table`;
const CELL_SELECTOR = `${TABLE_SELECTOR}>:is(thead,tbody,tfoot)>tr>:is(th,td)`;
const MEASURING_ATTR = 'data-codex-hud-table-measuring';
const OBSERVED_SCOPE =
  '.thread-scroll-container,[class~="max-w-(--thread-body-max-width)"],' +
  '[data-markdown-table],[data-app-shell-header-toolbar],.text-conversation-title';

function contentWidth(cell: Element): number {
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let node: Node | null;
  let left = Infinity;
  let right = -Infinity;

  while ((node = walker.nextNode())) {
    range.selectNodeContents(node);
    for (const box of range.getClientRects()) {
      if (box.width > 0 && box.height > 0) {
        left = Math.min(left, box.left);
        right = Math.max(right, box.right);
      }
    }
  }
  return Math.max(0, right - left);
}

function readableCaps(samples: number[][], fontSize: number): number[] {
  const caps = samples.map(() => 28);
  const rows = Array.from({ length: samples[0]?.length || 0 }, (_, rowIndex) =>
    samples.map((column) => column[rowIndex]),
  );

  // Spend extra width where it reduces row heights, including tied long columns.
  // Capped line costs keep unusually long outliers from dominating the table.
  const lineCount = (row: number[], widths: number[]): number =>
    Math.max(0, ...row.map((width, idx) => Math.min(4, Math.ceil(width / (widths[idx] * fontSize)))));

  let budget = 12;
  while (budget > 0) {
    let best: { next: number[]; extra: number; score: number } | null = null;
    const heights = rows.map((row) => lineCount(row, caps));
    const current = heights.reduce((sum, height) => sum + height, 0);
    const seen = new Set<string>();

    for (const [index, row] of rows.entries()) {
      const target = heights[index] - 1;
      if (target < 1) continue;
      const next = row.map((width, col) => Math.max(caps[col], Math.ceil(width / (target * fontSize))));
      const extra = next.reduce((sum, width, col) => sum + width - caps[col], 0);
      const key = next.join(',');
      if (extra <= 0 || extra > budget || next.some((width) => width > 40) || seen.has(key)) continue;
      seen.add(key);

      const gain = current - rows.reduce((sum, r) => sum + lineCount(r, next), 0);
      const score = gain / extra;
      if (gain <= 0 || gain < rows.length * 0.2) continue;
      if (!best || score > best.score || (score === best.score && extra < best.extra)) {
        best = { next, extra, score };
      }
    }
    if (!best) break;
    caps.splice(0, caps.length, ...best.next);
    budget -= best.extra;
  }

  return caps;
}

function installReadingWidth(): boolean {
  if (window.__codexReadingWidth) return false;

  const style = document.createElement('style');
  style.id = 'codex-hud-reading-width';

  const filePathStyle = document.createElement('style');
  filePathStyle.id = 'codex-hud-file-path-width';
  filePathStyle.textContent = filePathCss;
  document.head.append(filePathStyle);

  const titleStyle = document.createElement('style');
  titleStyle.id = 'codex-hud-centered-title';

  const fontStyle = document.createElement('style');
  fontStyle.id = 'codex-hud-assistant-font-size';

  const tableStyle = document.createElement('style');
  tableStyle.id = 'codex-hud-reading-tables';

  const measureStyle = document.createElement('style');
  measureStyle.id = 'codex-hud-reading-table-measure';
  measureStyle.textContent =
    `${TABLE_SELECTOR}[${MEASURING_ATTR}]{width:max-content!important;min-width:0!important;}\n` +
    `${TABLE_SELECTOR}[${MEASURING_ATTR}]>:is(thead,tbody,tfoot)>tr>:is(th,td)` +
    `{min-width:0!important;max-width:none!important;white-space:nowrap!important;}`;

  const columnCache = new WeakMap<HTMLTableElement, ColumnCacheEntry>();
  let titleGroup: Element | undefined;
  let titleObservers: Element[] = [];
  let chatTitleCentered = true;
  let tables = new Set<Element>();
  let observed = new Set<Element>();
  let targets = new Set<Element>();
  let pending: number | null = null;
  let preference: number | string | undefined;
  let tableEnabled = true;
  let tableCentered = true;

  function clearTitle(): void {
    titleGroup?.removeAttribute(TITLE_MARKER);
    titleGroup = undefined;
    titleStyle.remove();
    titleResizer.disconnect();
    titleObservers = [];
  }

  function alignTitle(): void {
    if (!chatTitleCentered) return;
    const active = document.querySelector('[data-app-shell-active-page="true"]');
    const isVisible = (el: Element) =>
      el.getBoundingClientRect().width > 0 &&
      el.getBoundingClientRect().height > 0 &&
      getComputedStyle(el).visibility === 'visible';
    const groups = [
      ...(active?.querySelectorAll(`${TITLE_BAR} > div > .w-fit:has(> .text-conversation-title)`) ?? []),
    ].filter(isVisible);
    const panes = [
      ...(active?.querySelectorAll('[data-app-shell-main-surface] .thread-scroll-container') ?? []),
    ].filter(isVisible);

    if (groups.length !== 1 || panes.length !== 1) {
      clearTitle();
      return;
    }

    const [group] = groups;
    const [pane] = panes;
    const lane = group.parentElement;
    if (!lane) {
      clearTitle();
      return;
    }

    if (group !== titleGroup) {
      titleGroup?.removeAttribute(TITLE_MARKER);
      titleGroup = group;
      group.setAttribute(TITLE_MARKER, '');
    }

    const watching = [group, lane, pane];
    if (watching.some((el, idx) => el !== titleObservers[idx])) {
      titleResizer.disconnect();
      watching.forEach((el) => titleResizer.observe(el));
      titleObservers = watching;
    }

    const region = pane.getBoundingClientRect();
    const slot = lane.getBoundingClientRect();
    const width = group.getBoundingClientRect().width;
    const room = Math.max(0, slot.width - width);
    const fromLeft = region.left + (region.width - width) / 2 - slot.left;
    const offset = getComputedStyle(lane).direction === 'rtl' ? room - fromLeft : fromLeft;
    const css = `[${TITLE_MARKER}]{position:relative;inset-inline-start:${Math.min(room, Math.max(0, offset))}px;}`;
    if (titleStyle.textContent !== css) titleStyle.textContent = css;
    if (!titleStyle.isConnected) document.head.append(titleStyle);
  }

  const titleResizer = new ResizeObserver(alignTitle);

  function setAssistantFontSize(value: number | null): void {
    if (value === null || !Number.isInteger(value) || value < 10 || value > 40) {
      fontStyle.remove();
      return;
    }
    const css = `${ASSISTANT_REPLY}{--codex-chat-font-size:${value}px;}`;
    if (fontStyle.textContent !== css) fontStyle.textContent = css;
    if (!fontStyle.isConnected) document.head.append(fontStyle);
  }

  function clearWidth(): void {
    for (const target of targets) target.removeAttribute(WIDTH_MARKER);
    document.querySelectorAll(`[${WIDTH_MARKER}]`).forEach((el) => el.removeAttribute(WIDTH_MARKER));
    targets.clear();
    style.remove();
  }

  function clearTables(): void {
    for (const table of tables) table.removeAttribute(TABLE_MARKER);
    document.querySelectorAll(`[${TABLE_MARKER}]`).forEach((el) => el.removeAttribute(TABLE_MARKER));
    tables.clear();
    tableStyle.remove();
    measureStyle.remove();
    resizer.disconnect();
    observed.clear();
  }

  function measureColumnWidths(table: HTMLTableElement): ColumnSpec[] {
    const css = getComputedStyle(table);
    const key = [
      css.fontFamily,
      css.fontSize,
      css.fontWeight,
      css.fontStyle,
      css.fontStretch,
      css.letterSpacing,
      css.wordSpacing,
    ].join('|');

    const cached = columnCache.get(table);
    if (cached?.key === key) return cached.widths;

    const rows = [...table.rows];
    const cells = rows.flatMap((row) => [...row.cells]);
    if (cells.some((cell) => cell.colSpan !== 1 || cell.rowSpan !== 1)) return [];

    if (!measureStyle.isConnected) document.head.append(measureStyle);
    table.setAttribute(MEASURING_ATTR, '');
    let widths: ColumnSpec[];
    try {
      const natural: number[] = [];
      const padding: number[] = [];
      const samples: number[][] = [];
      for (const row of rows) {
        for (const [index, cell] of [...row.cells].entries()) {
          const cellCss = getComputedStyle(cell);
          natural[index] = Math.max(natural[index] || 0, cell.getBoundingClientRect().width);
          padding[index] = Math.max(
            padding[index] || 0,
            parseFloat(cellCss.paddingLeft) +
              parseFloat(cellCss.paddingRight) +
              parseFloat(cellCss.borderLeftWidth) +
              parseFloat(cellCss.borderRightWidth),
          );
          samples[index] ||= [];
          if (row.parentElement?.tagName !== 'THEAD') {
            samples[index].push(contentWidth(cell));
          }
        }
      }
      const size = parseFloat(css.fontSize);
      const caps = readableCaps(samples, size);
      widths = natural.map((width, index) => ({
        min: Math.ceil(Math.min(6 * size, Math.max(0, width - padding[index]))),
        max: caps[index],
        gap: samples[index]?.length && Math.max(...samples[index]) <= 6 * size ? 20 : 32,
      }));
    } finally {
      table.removeAttribute(MEASURING_ATTR);
    }

    columnCache.set(table, { key, widths });
    return widths;
  }

  function applyTables(scrolls: Element[]): void {
    if (!tableEnabled) {
      clearTables();
      return;
    }

    const next = new Set<Element>();
    const watching = new Set<Element>(scrolls);
    const rules: string[] = [];

    for (const target of targets) {
      if (!target.parentElement) continue;
      watching.add(target);
      watching.add(target.parentElement);

      const inherited = getComputedStyle(target.parentElement);
      const base =
        inherited.getPropertyValue('--thread-content-responsive-max-width').trim() ||
        inherited.getPropertyValue('--thread-content-max-width').trim();
      if (!CSS.supports('width', base) || /^(inherit|initial|unset|revert)$/.test(base)) continue;

      const scroll = target.closest('.thread-scroll-container');
      for (const container of target.querySelectorAll('[data-markdown-table]')) {
        if (
          container.closest('.thread-scroll-container') !== scroll ||
          !container.closest('[data-markdown-text-style="assistant-message"]') ||
          container.closest('[data-conversation-print]')
        ) {
          continue;
        }
        const table = container.querySelector<HTMLTableElement>(
          ':scope > [class*="TableScroller"] > [class*="TableWrapper"] > table',
        );
        if (!table || container.getBoundingClientRect().width <= 0 || !container.parentElement) {
          continue;
        }

        const parent = container.parentElement;
        const rect = parent.getBoundingClientRect();
        const center = rect.x + rect.width / 2;
        let left = 0;
        let right = document.documentElement.clientWidth;

        for (let element: Element | null = parent; element; element = element.parentElement) {
          const css = getComputedStyle(element);
          if (element === scroll || /^(auto|scroll|hidden|clip)$/.test(css.overflowX)) {
            const box = element.getBoundingClientRect();
            left = Math.max(left, box.left + element.clientLeft + parseFloat(css.paddingLeft));
            right = Math.min(
              right,
              box.left + element.clientLeft + element.clientWidth - parseFloat(css.paddingRight),
            );
          }
          if (element === scroll) break;
        }

        const available = Math.floor(2 * Math.min(center - left, right - center));
        if (tableCentered && available <= 0) continue;

        const comfortable = Math.min(1440, 80 * parseFloat(getComputedStyle(table).fontSize));
        const limit = Math.floor(Math.min(available, comfortable));
        const index = String(next.size);
        next.add(container);
        watching.add(parent);
        if (container.getAttribute(TABLE_MARKER) !== index) {
          container.setAttribute(TABLE_MARKER, index);
        }

        rules.push(
          `[${TABLE_MARKER}="${index}"]{--thread-content-max-width:${base}!important;` +
            `${tableCentered ? `max-width:${limit}px!important;` : ''}}`,
        );

        const columns = measureColumnWidths(table);
        for (const [column, width] of columns.entries()) {
          rules.push(
            `:where([${TABLE_MARKER}="${index}"]) :is(th,td):nth-child(${column + 1})` +
              `{--codex-hud-column-min:${width.min}px;--codex-hud-column-max:${width.max}em;` +
              `--codex-hud-column-gap:${width.gap}px;}`,
          );
        }
      }
    }

    for (const container of tables) {
      if (!next.has(container)) container.removeAttribute(TABLE_MARKER);
    }
    document.querySelectorAll(`[${TABLE_MARKER}]`).forEach((el) => {
      if (!next.has(el)) el.removeAttribute(TABLE_MARKER);
    });
    tables = next;

    const root = `[${TABLE_MARKER}]`;
    const scroller = `${root}>[class*="TableScroller"]`;
    const wrapper = `${scroller}>[class*="TableWrapper"]`;
    const rootLayout = tableCentered
      ? `${root}{position:relative;justify-self:start!important;left:50%;translate:-50% 0;width:max-content!important;min-width:0!important;}`
      : `${root}{position:static;left:auto;translate:none;width:100%!important;min-width:0!important;}`;
    const css =
      `${rootLayout}\n${wrapper},${wrapper}>table{min-width:0!important;}\n` +
      `${CELL_SELECTOR}{min-width:var(--codex-hud-column-min,0px)!important;max-width:var(--codex-hud-column-max,28em)!important;}\n` +
      `${CELL_SELECTOR}:not(:last-child){padding-inline-end:var(--codex-hud-column-gap,32px)!important;}\n` +
      rules.join('\n');

    if (tables.size) {
      if (tableStyle.textContent !== css) tableStyle.textContent = css;
      if (!tableStyle.isConnected) document.head.append(tableStyle);
    } else {
      tableStyle.remove();
      measureStyle.remove();
    }

    for (const element of observed) {
      if (!watching.has(element)) resizer.unobserve(element);
    }
    for (const element of watching) {
      if (!observed.has(element)) resizer.observe(element);
    }
    observed = watching;
  }

  function apply(): Record<string, unknown> {
    alignTitle();
    const value = pending ?? preference;
    const maxWidth =
      value === 'wide'
        ? 1152
        : typeof value === 'number' && Number.isInteger(value) && value >= 768 && value <= 1600
          ? value
          : 768;
    const mode = maxWidth === 768 ? 'default' : 'custom';

    const isVisible = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };

    const scrolls = [...document.querySelectorAll('.thread-scroll-container')].filter(isVisible);
    const next = new Set<Element>();

    for (const scroll of scrolls) {
      const candidates = [
        ...scroll.querySelectorAll('[class~="max-w-(--thread-body-max-width)"]'),
      ].filter(
        (el) =>
          isVisible(el) &&
          el.closest('.thread-scroll-container') === scroll &&
          !el.querySelector('[data-codex-composer-root],[data-composer-body]'),
      );
      const bodies = candidates.filter(
        (el) => el.getAttribute('data-thread-user-message-navigation-content') === 'true',
      );
      const matches = bodies.length ? bodies : candidates;
      if (
        matches.length === 1 &&
        getComputedStyle(matches[0]).getPropertyValue('--thread-content-max-width').trim()
      ) {
        next.add(matches[0]);
      }
    }

    for (const target of targets) {
      if (!next.has(target)) target.removeAttribute(WIDTH_MARKER);
    }
    document.querySelectorAll(`[${WIDTH_MARKER}]`).forEach((el) => {
      if (!next.has(el)) el.removeAttribute(WIDTH_MARKER);
    });
    targets = next;

    if (!targets.size) {
      clearWidth();
      clearTables();
      return { mode, maxWidth, applied: false, reason: 'unknown-transcript-layout' };
    }

    const css = `[${WIDTH_MARKER}="wide"]{--thread-content-max-width:${maxWidth}px!important;}`;
    if (style.textContent !== css) style.textContent = css;
    if (mode === 'default') {
      style.remove();
      for (const target of targets) target.removeAttribute(WIDTH_MARKER);
    } else {
      if (!style.isConnected) document.head.append(style);
      for (const target of targets) {
        if (target.getAttribute(WIDTH_MARKER) !== 'wide') target.setAttribute(WIDTH_MARKER, 'wide');
      }
    }

    applyTables(scrolls);
    const widths = [...targets].map((el) => Math.round(el.getBoundingClientRect().width));
    return {
      mode,
      maxWidth,
      applied: mode !== 'default',
      width: widths[0],
      targets: targets.size,
      widths,
      tables: tables.size,
      tableEnabled,
      tableCentered,
    };
  }

  const resizer = new ResizeObserver(() => apply());
  const observer = new MutationObserver((records) => {
    let changed = false;
    for (const record of records) {
      const element =
        record.target instanceof Element ? record.target : record.target.parentElement;
      const table =
        element?.closest('table') ||
        (record.type === 'attributes' && element?.matches('[data-markdown-table]')
          ? element.querySelector<HTMLTableElement>(
              ':scope > [class*="TableScroller"] > [class*="TableWrapper"] > table',
            )
          : null);
      const tableContainer = table?.closest('[data-markdown-table]');
      if (table && tableContainer && tables.has(tableContainer)) {
        columnCache.delete(table);
        changed = true;
      }
    }

    const relevant = records.some((record) => {
      const element =
        record.target instanceof Element ? record.target : record.target.parentElement;
      if (element?.closest('#codex-composer-hud')) return false;
      if (record.type === 'attributes') {
        return (
          record.attributeName === 'data-app-shell-active-page' ||
          Boolean(element?.matches(OBSERVED_SCOPE)) ||
          [...targets].some((target) => element?.contains(target)) ||
          Boolean(element?.querySelector(OBSERVED_SCOPE))
        );
      }
      return [...record.addedNodes, ...record.removedNodes].some(
        (node) =>
          node instanceof Element &&
          (node.matches(OBSERVED_SCOPE) || Boolean(node.querySelector(OBSERVED_SCOPE))),
      );
    });

    if (changed || relevant) apply();
  });

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      'class',
      'style',
      'hidden',
      'aria-hidden',
      'colspan',
      'rowspan',
      'data-app-shell-active-page',
      'data-thread-user-message-navigation-content',
      'data-markdown-table',
      'data-markdown-text-style',
    ],
  });
  window.addEventListener('resize', apply);

  window.__codexReadingWidth = {
    update(value) {
      preference = value;
      return apply();
    },
    setAssistantFontSize,
    setChatTitleCentered(value) {
      const next = value !== false;
      if (next === chatTitleCentered) return;
      chatTitleCentered = next;
      if (next) alignTitle();
      else clearTitle();
    },
    setTablesEnabled(value) {
      const next = value !== false;
      if (next === tableEnabled) return { tableEnabled, tables: tables.size };
      tableEnabled = next;
      return apply();
    },
    setTableCentered(value) {
      const next = value !== false;
      if (next === tableCentered) return { tableCentered };
      tableCentered = next;
      return apply();
    },
    preview(value) {
      if (Number.isInteger(value) && value >= 768 && value <= 1600) pending = value;
      return this.update(value);
    },
    settle(value) {
      if (pending === value) pending = null;
    },
    remove() {
      observer.disconnect();
      resizer.disconnect();
      window.removeEventListener('resize', apply);
      fontStyle.remove();
      filePathStyle.remove();
      clearTitle();
      clearWidth();
      clearTables();
      delete window.__codexReadingWidth;
    },
  };

  return true;
}

installReadingWidth();
