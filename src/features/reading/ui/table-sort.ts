// Sort keys live only in page memory. Source rows and Markdown stay in their original order.
import hostStyles from './table-sort.css';
import controlStyles from './table-sort-control.css';

interface ParsedNumber {
  value: number;
  unit: string;
}

interface CellProfile {
  value: string;
  empty: boolean;
  number: ParsedNumber | null;
}

interface ColumnProfile {
  values: CellProfile[];
  numeric: boolean;
  serial: boolean;
}

interface TableProfiles {
  rows: HTMLTableRowElement[];
  columns: ColumnProfile[];
  collator: Intl.Collator;
}

interface RowMove {
  original: string;
  priority: string;
  hadStyle: boolean;
  value?: string;
  delta?: number;
}

interface HeaderControl {
  header: HTMLTableCellElement;
  host: HTMLSpanElement;
  button: HTMLButtonElement;
  symbol: HTMLSpanElement;
  rank: HTMLSpanElement;
  aria: string | null;
  click: (event: MouseEvent) => void;
}

interface LayoutMetrics {
  key: string;
  titles: number[];
  controls: number[];
  floating: boolean[];
}

interface TableSortState {
  table: HTMLTableElement;
  headings: string[];
  keys: { column: number; direction: 1 | -1 }[];
  directions: Map<number, 1 | -1>;
  multi: boolean;
  session: number;
  controls: HeaderControl[];
  rows: Set<HTMLTableRowElement>;
  moves: Map<HTMLTableRowElement, RowMove>;
  profiles: TableProfiles | null;
  order: number[] | null;
  orderKey?: string;
  layout?: LayoutMetrics | null;
}

const MARKER = 'data-codex-table-sort-header';
const CONTROL = 'data-codex-table-sort-control';
const MEASURING = 'data-codex-table-sort-measuring';
const POSITIONED = 'data-codex-table-sort-positioned';

// Lucide geometry; ISC/MIT notices are preserved in THIRD_PARTY_NOTICES.md.
const ICONS = {
  'small-first':
    '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M11 4h4"/><path d="M11 8h7"/><path d="M11 12h10"/>',
  'large-first':
    '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M11 4h10"/><path d="M11 8h7"/><path d="M11 12h4"/>',
} as const;

const normalizeText = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ');
const isBlank = (value: string) => !value || /^(?:[-–—]|n\/a)$/i.test(value);
const t = (key: string, values: Record<string, string | number> = {}) =>
  window.__codexHudI18n?.t(key, values) ?? key;

function parseNumber(raw: string): ParsedNumber | null {
  let value = raw;
  const negative = value.startsWith('(') && value.endsWith(')');
  if (negative) value = value.slice(1, -1).trim();
  value = value.replace(/^([+-])\s*([¥$€£])/, '$2$1');
  const match = value.match(
    /^(?:([¥$€£])\s*)?([+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)\s*([%\p{L}]+)?$/iu,
  );
  if (!match) return null;
  const numeric = Number(match[2].replaceAll(',', ''));
  return Number.isFinite(numeric)
    ? { value: negative ? -Math.abs(numeric) : numeric, unit: (match[1] || '') + (match[3] || '') }
    : null;
}

function isSerialSequence(values: string[]): boolean {
  const ids = values.map((v) => v.match(/^([a-z]{0,8})(\d+)$/i));
  if (!ids.length || ids.some((id) => !id || !Number.isSafeInteger(Number(id[2])))) return false;
  const prefix = ids[0]![1].toUpperCase();
  if (ids.some((id) => id![1].toUpperCase() !== prefix)) return false;
  if (prefix) return true;
  if (ids.length < 3) return false;
  const step = Number(ids[1]![2]) - Number(ids[0]![2]);
  return (
    Math.abs(step) === 1 &&
    ids.every((id, index) => !index || Number(id![2]) - Number(ids[index - 1]![2]) === step)
  );
}

function installTableSort(): boolean {
  if (window.__codexTableSort) return false;

  const states = new Map<HTMLTableElement, TableSortState>();
  const style = document.createElement('style');
  style.id = 'codex-table-sort';
  style.textContent = hostStyles;

  let pending: number | null = null;
  let stopped = false;
  let enabled = true;
  let ctrlDown = false;
  let controlSession = 0;
  let defaultMode: 'smart' | 'ascending' | 'descending' = 'smart';

  function getProfiles(state: TableSortState, rows: HTMLTableRowElement[]): TableProfiles {
    if (
      state.profiles &&
      state.profiles.rows.length === rows.length &&
      rows.every((row, index) => state.profiles!.rows[index] === row)
    ) {
      return state.profiles;
    }

    const columns: ColumnProfile[] = state.controls.map((_, colIdx) => {
      const values = rows.map((row) => {
        const value = normalizeText(row.cells[colIdx]?.textContent ?? '');
        return { value, empty: isBlank(value), number: parseNumber(value) };
      });
      const filled = values.filter((item) => !item.empty);
      return {
        values,
        numeric:
          filled.length > 0 &&
          filled.every((item) => item.number && item.number.unit === filled[0].number?.unit),
        serial: isSerialSequence(filled.map((item) => item.value)),
      };
    });

    state.profiles = {
      rows: [...rows],
      columns,
      collator: new Intl.Collator(
        window.__codexHudI18n?.locale() || document.documentElement.lang || 'zh-CN',
        { numeric: true, sensitivity: 'base' },
      ),
    };
    state.order = null;
    return state.profiles;
  }

  function preferredDirection(state: TableSortState, column: number, data: TableProfiles): 1 | -1 {
    return (
      state.directions.get(column) ??
      (defaultMode === 'ascending'
        ? 1
        : defaultMode === 'descending'
          ? -1
          : data.columns[column].serial
            ? 1
            : -1)
    );
  }

  function layoutControls(state: TableSortState): void {
    const headersKey = state.controls
      .map((entry) => {
        const css = getComputedStyle(entry.header);
        return [entry.rank.textContent, css.paddingInlineStart, css.paddingInlineEnd].join(',');
      })
      .join('|');
    const css = getComputedStyle(state.table);
    const key = [
      css.fontFamily,
      css.fontSize,
      css.fontWeight,
      css.fontStyle,
      css.fontStretch,
      css.letterSpacing,
      css.wordSpacing,
      headersKey,
    ].join('|');

    if (!state.layout || state.layout.key !== key) {
      const widths: number[] = [];
      const titles: number[] = [];
      try {
        state.table.setAttribute(MEASURING, '');
        for (const entry of state.controls) {
          widths.push(entry.header.getBoundingClientRect().width);
          const range = document.createRange();
          range.setStart(entry.header, 0);
          range.setEndBefore(entry.host);
          titles.push(range.getBoundingClientRect().width);
        }
        for (const entry of state.controls) entry.host.setAttribute('data-measuring', '');
        state.table.setAttribute(MEASURING, 'icons');
        state.layout = {
          key,
          titles,
          controls: state.controls.map((entry) => entry.host.getBoundingClientRect().width + 5),
          floating: state.controls.map(
            (entry, index) => entry.header.getBoundingClientRect().width > widths[index] + 0.5,
          ),
        };
      } finally {
        state.table.removeAttribute(MEASURING);
        for (const entry of state.controls) entry.host.removeAttribute('data-measuring');
      }
    }

    for (const [index, entry] of state.controls.entries()) {
      const current = getComputedStyle(entry.header);
      const available =
        entry.header.getBoundingClientRect().width -
        parseFloat(current.paddingInlineStart) -
        parseFloat(current.paddingInlineEnd) -
        parseFloat(current.borderInlineStartWidth) -
        parseFloat(current.borderInlineEndWidth);
      const floating =
        state.layout.floating[index] ||
        state.layout.titles[index] + state.layout.controls[index] > available + 0.5;
      entry.host.toggleAttribute('data-floating', floating);
      if (floating && getComputedStyle(entry.header).position === 'static') {
        entry.header.setAttribute(POSITIONED, '');
      } else if (!floating) {
        entry.header.removeAttribute(POSITIONED);
      }
      if (!floating) continue;

      const headerCss = getComputedStyle(entry.header);
      const inset = `${Math.max(1, parseFloat(headerCss.paddingInlineEnd) - 18)}px`;
      const top = `${parseFloat(headerCss.paddingTop) + Math.max(0, (parseFloat(headerCss.lineHeight) || parseFloat(headerCss.fontSize)) - 20) / 2}px`;
      if (entry.host.style.getPropertyValue('--codex-sort-inset') !== inset) {
        entry.host.style.setProperty('--codex-sort-inset', inset);
      }
      if (entry.host.style.getPropertyValue('--codex-sort-top') !== top) {
        entry.host.style.setProperty('--codex-sort-top', top);
      }
    }
  }

  function restoreRow(state: TableSortState, row: HTMLTableRowElement): void {
    const move = state.moves.get(row);
    if (!move) return;
    if (row.style.getPropertyValue('translate') === move.value) {
      if (move.original) row.style.setProperty('translate', move.original, move.priority);
      else row.style.removeProperty('translate');
      if (!move.hadStyle && !row.style.length) row.removeAttribute('style');
    }
    state.moves.delete(row);
  }

  function moveRow(state: TableSortState, row: HTMLTableRowElement, delta: number): void {
    if (Math.abs(delta) < 0.01) {
      restoreRow(state, row);
      return;
    }
    let move = state.moves.get(row);
    if (!move) {
      move = {
        original: row.style.getPropertyValue('translate'),
        priority: row.style.getPropertyPriority('translate'),
        hadStyle: row.hasAttribute('style'),
      };
      state.moves.set(row, move);
    }
    const value = `0px ${Number(delta.toFixed(3))}px`;
    if (row.style.getPropertyValue('translate') !== value) {
      row.style.setProperty('translate', value, 'important');
    }
    move.value = row.style.getPropertyValue('translate');
    move.delta = Number(delta.toFixed(3));
  }

  function inspectStructure(
    table: HTMLTableElement,
  ): { headers: HTMLTableCellElement[]; rows: HTMLTableRowElement[] } | null {
    const container = table.closest('[data-markdown-table]');
    if (!container?.closest('.thread-scroll-container') || container.closest('[data-conversation-print]')) {
      return null;
    }
    if (
      container.closest('[data-markdown-text-style]')?.getAttribute('data-markdown-text-style') !==
      'assistant-message'
    ) {
      return null;
    }
    if (
      container.querySelector(':scope > [class*="TableScroller"] > [class*="TableWrapper"] > table') !==
      table
    ) {
      return null;
    }
    if (table.tHead?.rows.length !== 1 || table.tBodies.length !== 1) return null;

    const headers = [...table.tHead.rows[0].cells];
    const rows = [...table.tBodies[0].rows];
    const state = states.get(table);
    if (!headers.length || headers.some((cell) => cell.tagName !== 'TH') || rows.length < 2) {
      return null;
    }
    if (
      [...headers, ...rows.flatMap((row) => [...row.cells])].some(
        (cell) => cell.colSpan !== 1 || cell.rowSpan !== 1,
      )
    ) {
      return null;
    }
    if (rows.some((row) => row.cells.length !== headers.length)) return null;
    if (
      rows.some((row) => {
        const move = state?.moves.get(row);
        return (
          !(move && row.style.getPropertyValue('translate') === move.value) &&
          !['none', '0px'].includes(getComputedStyle(row).translate)
        );
      })
    ) {
      return null;
    }
    return { headers, rows };
  }

  function syncLabels(state: TableSortState, data: TableProfiles): void {
    for (const [index, entry] of state.controls.entries()) {
      const rank = state.keys.findIndex((key) => key.column === index);
      const active = rank >= 0;
      const current = active ? state.keys[rank].direction : preferredDirection(state, index, data);
      const priority = active && state.multi ? t('tableSortPriority', { count: rank + 1 }) : '';
      const label = t('tableSortHint', {
        column: (entry.header.textContent ?? '').trim(),
        direction: t(current === 1 ? 'tableSortSmallFirst' : 'tableSortLargeFirst'),
        priority: priority ? ` · ${priority}` : '',
      });
      entry.button.setAttribute('aria-label', label);
      entry.button.title = label;
      entry.button.toggleAttribute('data-active', active);
      entry.button.toggleAttribute('data-preset', !active && state.directions.has(index));
      entry.host.toggleAttribute('data-visible', active || state.directions.has(index));
      entry.rank.hidden = !(active && state.multi);
      entry.rank.textContent = entry.rank.hidden ? '' : String(rank + 1);

      const icon = current === 1 ? 'small-first' : 'large-first';
      if (entry.symbol.dataset.icon !== icon) {
        entry.symbol.dataset.icon = icon;
        entry.symbol.innerHTML =
          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
          `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[icon]}</svg>`;
      }
      entry.header.setAttribute(
        'aria-sort',
        active ? (rank === 0 ? (current === 1 ? 'ascending' : 'descending') : 'other') : 'none',
      );
      entry.header.setAttribute(
        'data-codex-sort-direction',
        current === 1 ? 'ascending' : 'descending',
      );
      if (active) entry.header.setAttribute('data-codex-sort-rank', String(rank + 1));
      else entry.header.removeAttribute('data-codex-sort-rank');
    }
    layoutControls(state);
  }

  function render(state: TableSortState, rows: HTMLTableRowElement[]): void {
    const keep = new Set(rows);
    for (const row of state.rows) {
      if (!keep.has(row)) {
        restoreRow(state, row);
        resizer.unobserve(row);
      }
    }
    for (const row of rows) {
      if (!state.rows.has(row)) resizer.observe(row);
    }
    state.rows = keep;

    const data = getProfiles(state, rows);
    syncLabels(state, data);
    if (!state.keys.length) {
      for (const row of state.moves.keys()) restoreRow(state, row);
      return;
    }

    const orderKey = state.keys.map((key) => `${key.column}:${key.direction}`).join(',');
    if (!state.order || state.orderKey !== orderKey) {
      state.order = rows
        .map((_, index) => index)
        .sort((a, b) => {
          for (const key of state.keys) {
            const column = data.columns[key.column];
            const left = column.values[a];
            const right = column.values[b];
            if (left.empty !== right.empty) return left.empty ? 1 : -1;
            const difference = left.empty
              ? 0
              : column.numeric
                ? left.number!.value - right.number!.value
                : data.collator.compare(left.value, right.value);
            if (difference) return difference * key.direction;
          }
          return a - b;
        });
      state.orderKey = orderKey;
    }

    const boxes = new Map(
      rows.map((row) => {
        const box = row.getBoundingClientRect();
        const move = state.moves.get(row);
        const delta =
          move && row.style.getPropertyValue('translate') === move.value ? (move.delta ?? 0) : 0;
        return [row, { top: box.top - delta, height: box.height }] as const;
      }),
    );
    const first = boxes.get(rows[0])!;
    const second = boxes.get(rows[1])!;
    const gap = Math.max(0, second.top - first.top - first.height);
    let top = first.top;
    for (const index of state.order) {
      const row = rows[index];
      const box = boxes.get(row)!;
      moveRow(state, row, top - box.top);
      top += box.height + gap;
    }
  }

  function register(
    table: HTMLTableElement,
    headers: HTMLTableCellElement[],
    headings: string[],
    previous?: TableSortState | null,
  ): TableSortState {
    const state: TableSortState = {
      table,
      headings,
      keys: previous?.keys ?? [],
      directions: previous?.directions ?? new Map(),
      multi: previous?.multi ?? false,
      session: previous?.session ?? -1,
      controls: [],
      rows: new Set(),
      moves: new Map(),
      profiles: null,
      order: null,
    };

    if (!style.isConnected) document.head.append(style);
    for (const [index, header] of headers.entries()) {
      const host = document.createElement('span');
      host.setAttribute(CONTROL, '');
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML =
        `<style>${controlStyles}</style>` +
        `<button type="button"><span data-symbol aria-hidden="true"></span>` +
        `<span data-priority aria-hidden="true" hidden></span></button>`;

      const button = shadow.querySelector<HTMLButtonElement>('button')!;
      const symbol = shadow.querySelector<HTMLSpanElement>('[data-symbol]')!;
      const rank = shadow.querySelector<HTMLSpanElement>('[data-priority]')!;
      const aria = header.getAttribute('aria-sort');

      header.setAttribute(MARKER, '');
      header.append(host);

      const click = (event: MouseEvent) => {
        if (event.defaultPrevented || event.button !== 0 || event.detail > 1) return;
        const buttonClick = event.composedPath().includes(button);
        const selection = window.getSelection();
        if (!buttonClick && selection && !selection.isCollapsed && header.contains(selection.anchorNode)) {
          return;
        }
        if (
          !buttonClick &&
          event.target instanceof Element &&
          event.target.closest('a,button,input,select,textarea,[contenteditable="true"]')
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();

        const current = inspectStructure(table);
        if (!current || table.getBoundingClientRect().width <= 0) return;

        const data = getProfiles(state, current.rows);
        const preferred = preferredDirection(state, index, data);
        const selected = state.keys.find((key) => key.column === index);

        if (event.altKey) {
          const next = (-(selected?.direction ?? preferred)) as 1 | -1;
          state.directions.set(index, next);
          if (selected) selected.direction = next;
        } else if (event.ctrlKey) {
          if (!ctrlDown) {
            ctrlDown = true;
            controlSession++;
          }
          if (state.session !== controlSession) {
            state.keys = [];
            state.session = controlSession;
          }
          state.multi = true;
          if (!state.keys.some((key) => key.column === index)) {
            state.keys.push({ column: index, direction: preferred });
          }
        } else {
          state.multi = false;
          if (state.keys.length === 1 && selected) {
            state.keys =
              selected.direction === preferred
                ? [{ column: index, direction: (-preferred) as 1 | -1 }]
                : [];
          } else {
            state.keys = [{ column: index, direction: preferred }];
          }
        }
        state.order = null;
        render(state, current.rows);
      };

      header.addEventListener('click', click);
      state.controls.push({ header, host, button, symbol, rank, aria, click });
    }

    states.set(table, state);
    resizer.observe(table);
    return state;
  }

  function unregister(state: TableSortState): void {
    for (const row of state.moves.keys()) restoreRow(state, row);
    for (const row of state.rows) resizer.unobserve(row);
    resizer.unobserve(state.table);
    for (const entry of state.controls) {
      entry.header.removeEventListener('click', entry.click);
      entry.host.remove();
      entry.header.removeAttribute(MARKER);
      entry.header.removeAttribute(POSITIONED);
      entry.header.removeAttribute('data-codex-sort-direction');
      entry.header.removeAttribute('data-codex-sort-rank');
      if (entry.aria === null) entry.header.removeAttribute('aria-sort');
      else entry.header.setAttribute('aria-sort', entry.aria);
    }
    states.delete(state.table);
  }

  function scan(): void {
    if (stopped || !enabled) return;
    const next = new Set<HTMLTableElement>();
    for (const table of document.querySelectorAll<HTMLTableElement>(
      '.thread-scroll-container [data-markdown-table] table',
    )) {
      const current = inspectStructure(table);
      if (!current) continue;
      let state = states.get(table);
      if (table.getBoundingClientRect().width <= 0) {
        if (state) {
          next.add(table);
          state.layout = null;
          for (const row of state.moves.keys()) restoreRow(state, row);
        }
        continue;
      }

      const headings = current.headers.map((header) => normalizeText(header.textContent ?? ''));
      if (state) {
        const unique = new Set(headings).size === headings.length;
        const sameColumns =
          headings.length === state.headings.length &&
          headings.every(
            (name, index) =>
              name === state!.headings[index] &&
              ((unique && Boolean(name)) || state!.controls[index].header === current.headers[index]),
          );
        const sameControls = current.headers.every(
          (header, index) =>
            state!.controls[index]?.header === header &&
            state!.controls[index].host.parentNode === header,
        );
        if (!sameColumns || !sameControls) {
          unregister(state);
          state = register(table, current.headers, headings, sameColumns ? state : null);
        }
      }
      state ||= register(table, current.headers, headings);
      next.add(table);
      render(state, current.rows);
    }

    for (const [table, state] of states) {
      if (!next.has(table)) unregister(state);
    }
    if (states.size && !style.isConnected) document.head.append(style);
    if (!states.size) style.remove();
  }

  function schedule(): void {
    if (enabled && !stopped && pending === null) {
      pending = requestAnimationFrame(() => {
        pending = null;
        scan();
      });
    }
  }

  const resizer = new ResizeObserver(schedule);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const element =
        record.target instanceof Element ? record.target : record.target.parentElement;
      const closestTable = element?.closest('table');
      const state = closestTable ? states.get(closestTable) : undefined;
      if (state) {
        state.profiles = null;
        state.order = null;
        state.layout = null;
      } else if (record.type === 'attributes') {
        for (const item of states.values()) {
          if (element?.contains(item.table)) {
            item.profiles = null;
            item.order = null;
            item.layout = null;
          }
        }
      }
    }

    const relevant = records.some((record) => {
      const element =
        record.target instanceof Element ? record.target : record.target.parentElement;
      if (element?.closest('#codex-composer-hud')) return false;
      if (record.type === 'attributes' && element === document.documentElement) return true;
      if (element?.closest('[data-markdown-table]')) return true;
      if (record.type === 'attributes') return Boolean(element?.querySelector('[data-markdown-table]'));
      return [...record.addedNodes, ...record.removedNodes].some(
        (node) =>
          node instanceof Element &&
          (node.matches('[data-markdown-table]') || Boolean(node.querySelector('[data-markdown-table]'))),
      );
    });
    if (relevant) schedule();
  });

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'hidden', 'aria-hidden', 'colspan', 'rowspan'],
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Control' && !ctrlDown) {
      ctrlDown = true;
      controlSession++;
    }
  };
  const keyup = (event: KeyboardEvent) => {
    if (event.key === 'Control') ctrlDown = false;
  };
  const blur = () => {
    ctrlDown = false;
  };
  const scroll = (event: Event) => {
    const target = event.target;
    if (
      target instanceof Node &&
      [...states.keys()].some(
        (table) => target.contains(table) || table.closest('[data-markdown-table]')?.contains(target),
      )
    ) {
      schedule();
    }
  };

  document.addEventListener('keydown', keydown);
  document.addEventListener('keyup', keyup);
  window.addEventListener('blur', blur);
  window.addEventListener('scroll', scroll, true);
  window.addEventListener('resize', schedule);

  function snapshot() {
    return {
      enabled,
      tables: states.size,
      sorted: [...states.values()].filter((s) => s.keys.length > 0).length,
      multi: [...states.values()].filter((s) => s.multi && s.keys.length > 0).length,
      defaultMode,
    };
  }

  window.__codexTableSort = {
    setEnabled(value) {
      const next = value !== false;
      if (next === enabled) return snapshot();
      enabled = next;
      if (enabled) {
        schedule();
        return snapshot();
      }
      if (pending !== null) {
        cancelAnimationFrame(pending);
        pending = null;
      }
      for (const state of states.values()) unregister(state);
      style.remove();
      return snapshot();
    },
    setDefaultMode(value) {
      const next = (['smart', 'ascending', 'descending'].includes(value) ? value : 'smart') as
        | 'smart'
        | 'ascending'
        | 'descending';
      if (next === defaultMode) return snapshot();
      defaultMode = next;
      schedule();
      return snapshot();
    },
    snapshot,
    remove() {
      stopped = true;
      observer.disconnect();
      resizer.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      window.removeEventListener('scroll', scroll, true);
      if (pending !== null) cancelAnimationFrame(pending);
      for (const state of states.values()) unregister(state);
      style.remove();
      delete window.__codexTableSort;
    },
  };

  scan();
  return true;
}

installTableSort();
