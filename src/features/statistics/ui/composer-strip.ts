// Page-only view. Receives whitelisted metadata; never reads the editor or messages.
import { COMMAND_ICON_PATHS, COMPOSER_FOLD_STYLES, createPanelMarkup } from './panel-template';

type MetricKey = 'ttft' | 'speed' | 'cache' | 'age';
type FoldStyle = 'minimize' | 'hide';
type FoldMode = 'off' | FoldStyle;
type TableSortMode = 'smart' | 'ascending' | 'descending';

interface PreferencesState {
  readingWidth: number;
  assistantFontSize: number | null;
  chatTitleCentered: boolean;
  workspaceTreeEnabled: boolean;
  composerAutoHide: FoldMode;
  composerHideStyle: FoldStyle;
  composerHideAfterSend: boolean;
  fileChangesDefaultCollapsed: boolean;
  customAccent: boolean;
  tableEnabled: boolean;
  tableCentered: boolean;
  tableSortMode: TableSortMode;
  commandMenuEnabled: boolean;
  commandVisible: Record<string, boolean>;
  skillVisible: Record<string, boolean>;
  commandSectionOrder: [string, string];
  commandGroupOrder: string[];
  commandItemOrder: Record<string, string[]>;
  metricOrder: MetricKey[];
  metricVisible: Record<MetricKey, boolean>;
}

const METRIC_KEYS: readonly MetricKey[] = ['ttft', 'speed', 'cache', 'age'];
const COMPOSER_FOLD_MODES: readonly FoldMode[] = ['off', ...COMPOSER_FOLD_STYLES];
const TABLE_SORT_MODES: readonly TableSortMode[] = ['smart', 'ascending', 'descending'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function installComposerHud(): boolean {
  if (window.__codexComposerHud) return false;
  const i18n = window.__codexHudI18n!;
  const t = (key: string, values?: Record<string, string | number>) => i18n.t(key, values);

  const commandMenu = () => window.__codexCommandMenu;
  const commandCatalog = commandMenu()?.catalog;
  const normalizeCommands = (value?: unknown) => commandCatalog?.normalize(value) || {};
  const normalizeCommandGroups = (value?: unknown) => commandCatalog?.normalizeGroupOrder(value) || [];
  const normalizeCommandItems = (value?: unknown) => commandCatalog?.normalizeItemOrder(value) || {};
  const normalizeSkills = (value?: unknown) => commandCatalog?.normalizeSkillVisible?.(value) || {};
  const normalizeCommandSections = (value?: unknown): [string, string] =>
    commandCatalog?.normalizeSectionOrder?.(value) || ['commands', 'skills'];

  const DEFAULT_METRIC_ORDER: MetricKey[] = [...METRIC_KEYS];
  const DEFAULT_METRIC_VISIBLE = Object.fromEntries(
    METRIC_KEYS.map((key) => [key, true]),
  ) as Record<MetricKey, boolean>;

  const DEFAULT_PREFERENCES: PreferencesState = {
    readingWidth: 1152,
    assistantFontSize: null,
    chatTitleCentered: true,
    workspaceTreeEnabled: true,
    composerAutoHide: 'off',
    composerHideStyle: 'minimize',
    composerHideAfterSend: false,
    fileChangesDefaultCollapsed: true,
    customAccent: true,
    tableEnabled: true,
    tableCentered: true,
    tableSortMode: 'smart',
    commandMenuEnabled: true,
    commandVisible: normalizeCommands(),
    skillVisible: normalizeSkills(),
    commandSectionOrder: normalizeCommandSections(),
    commandGroupOrder: normalizeCommandGroups(),
    commandItemOrder: normalizeCommandItems(),
    metricOrder: [...DEFAULT_METRIC_ORDER],
    metricVisible: { ...DEFAULT_METRIC_VISIBLE },
  };

  const host = document.createElement('div');
  host.id = 'codex-composer-hud';
  host.style.cssText =
    'position:fixed;width:max-content;pointer-events:none;z-index:20;' +
    'transform:translateX(-50%);color:var(--color-text-tertiary,#a8a8a8);';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = createPanelMarkup();

  const $ = <T extends HTMLElement>(selector: string) => shadow.querySelector<T>(selector)!;
  const metrics = $<HTMLButtonElement>('#metrics');
  const panel = $<HTMLDivElement>('#settings-panel');
  const title = $<HTMLHeadingElement>('#settings-title');
  const saveState = $<HTMLDivElement>('#save-state');
  const saveStateText = $<HTMLSpanElement>('#save-state-text');
  const undoButton = $<HTMLButtonElement>('#undo');
  const redoButton = $<HTMLButtonElement>('#redo');
  const restoreButton = $<HTMLButtonElement>('#restore-defaults');
  const widthLabel = $<HTMLLabelElement>('#width-label');
  const widthRange = $<HTMLInputElement>('#width-range');
  const widthNumber = $<HTMLInputElement>('#width-number');
  const assistantFontLabel = $<HTMLLabelElement>('#assistant-font-label');
  const assistantFontInput = $<HTMLInputElement>('#assistant-font-size');
  const foldToggle = $<HTMLButtonElement>('#fold-toggle');
  const foldPanel = $<HTMLDivElement>('#fold-options');
  const foldGroupLabel = $<HTMLSpanElement>('#fold-group-label');
  const foldEnabled = $<HTMLButtonElement>('#fold-enabled');
  const foldPanelBody = foldPanel.querySelector<HTMLDivElement>('.table-panel-body')!;
  const foldLabel = $<HTMLSpanElement>('#composer-fold-label');
  const foldControl = $<HTMLDivElement>('#composer-fold-mode');
  const foldOptions = [...foldControl.querySelectorAll<HTMLInputElement>('input')];
  const foldAfterSendLabel = $<HTMLSpanElement>('#fold-after-send-label');
  const foldAfterSend = $<HTMLButtonElement>('#fold-after-send');
  const filesDefaultLabel = $<HTMLSpanElement>('#files-default-label');
  const filesDefaultCopy = $<HTMLSpanElement>('#files-default-copy');
  const filesDefault = $<HTMLButtonElement>('#files-default');
  const accentLabel = $<HTMLSpanElement>('#accent-label');
  const accentToggle = $<HTMLButtonElement>('#accent-toggle');
  const tableLabel = $<HTMLSpanElement>('#table-label');
  const tableToggle = $<HTMLButtonElement>('#table-toggle');
  const tableOptions = $<HTMLDivElement>('#table-options');
  const tableEnabled = $<HTMLButtonElement>('#table-enabled');
  const tableOptionsBody = tableOptions.querySelector<HTMLDivElement>('.table-panel-body')!;
  const workspaceTreeLabel = $<HTMLSpanElement>('#workspace-tree-label');
  const workspaceTreeEnabled = $<HTMLButtonElement>('#workspace-tree-enabled');
  const chatTitleCenteredLabel = $<HTMLSpanElement>('#chat-title-centered-label');
  const chatTitleCentered = $<HTMLButtonElement>('#chat-title-centered');
  const tableCenteredLabel = $<HTMLSpanElement>('#table-centered-label');
  const tableCentered = $<HTMLButtonElement>('#table-centered');
  const tableSortLabel = $<HTMLSpanElement>('#table-sort-label');
  const tableSortGroup = $<HTMLDivElement>('#table-sort-group');
  const tableSortButtons = [
    ...tableSortGroup.querySelectorAll<HTMLButtonElement>('[data-table-sort-mode]'),
  ];
  const commandEnabled = $<HTMLButtonElement>('#command-enabled');
  const commandToggle = $<HTMLButtonElement>('#command-toggle');
  const commandOptions = $<HTMLDivElement>('#command-options');
  const commandBody = $<HTMLDivElement>('#command-options-body');
  const skillButtons = $<HTMLDivElement>('#skill-buttons');
  const skillToggle = $<HTMLButtonElement>('#skill-toggle');
  const skillOptions = $<HTMLDivElement>('#skill-options');
  const slashSettings = $<HTMLDivElement>('#slash-settings');
  const slashSections = Object.fromEntries(
    [...slashSettings.children].map((section) => [
      (section as HTMLElement).dataset.slashSection!,
      section as HTMLElement,
    ]),
  );
  const slashToggle = $<HTMLButtonElement>('#slash-toggle');
  const slashOptions = $<HTMLDivElement>('#slash-options');
  const metricGroup = $<HTMLDivElement>('#metric-group');

  const metricNodes = Object.fromEntries(
    METRIC_KEYS.map((key) => {
      const node = document.createElement('span');
      node.className = 'metric';
      node.dataset.metricKey = key;
      return [key, node];
    }),
  ) as Record<MetricKey, HTMLSpanElement>;
  metrics.append(...DEFAULT_METRIC_ORDER.map((key) => metricNodes[key]));

  let slashExpanded = false;
  let skillExpanded = false;
  let skillSignature = '';
  let commandExpanded = false;
  let commandSignature = '';
  let commandDrag: { kind: string; id: string; group: string } | null = null;
  let commandSuppressClickUntil = 0;

  let settings: PreferencesState = {
    ...DEFAULT_PREFERENCES,
    metricOrder: [...DEFAULT_METRIC_ORDER],
    metricVisible: { ...DEFAULT_METRIC_VISIBLE },
  };
  let metricOrder: MetricKey[] = [...DEFAULT_METRIC_ORDER];
  let metricVisible: Record<MetricKey, boolean> = { ...DEFAULT_METRIC_VISIBLE };
  let metricValues: Record<MetricKey, string> = {
    ttft: '-s',
    speed: '- tok/s',
    cache: '-%',
    age: '',
  };
  let pendingSettings: { value: Record<string, unknown>; revision: number } | null = null;
  let settingsRevision = 0;
  let groupSignature = '';
  let dragSource = '';
  let suppressClickUntil = 0;
  let compactMetrics = false;
  let widthEditing = false;
  let widthCancel = false;
  let assistantFontEditing = false;
  let tableExpanded = false;
  let historyReady = false;
  const past: PreferencesState[] = [];
  let future: PreferencesState[] = [];

  const clampWidth = (value: unknown) => Math.max(768, Math.min(1600, Math.round(Number(value))));
  const isAssistantFontSize = (value: unknown): value is number | null =>
    value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 10 && value <= 40);

  const normalizeOrder = (value: unknown): MetricKey[] => {
    const seen = new Set<MetricKey>();
    const order: MetricKey[] = [];
    for (const key of Array.isArray(value) ? value : []) {
      if (METRIC_KEYS.includes(key as MetricKey) && !seen.has(key as MetricKey)) {
        seen.add(key as MetricKey);
        order.push(key as MetricKey);
      }
    }
    for (const key of DEFAULT_METRIC_ORDER) {
      if (!seen.has(key)) order.push(key);
    }
    return order;
  };

  const normalizeVisible = (value: unknown): Record<MetricKey, boolean> => {
    const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const visible = Object.fromEntries(
      METRIC_KEYS.map((key) => [key, record[key] !== false]),
    ) as Record<MetricKey, boolean>;
    if (!METRIC_KEYS.some((key) => visible[key])) visible.ttft = true;
    return visible;
  };

  const normalizePreferences = (value: Record<string, any> | undefined): PreferencesState => {
    const next: PreferencesState = { ...settings, ...value };
    next.readingWidth =
      Number.isInteger(value?.readingWidth) &&
      value!.readingWidth >= 768 &&
      value!.readingWidth <= 1600
        ? clampWidth(value!.readingWidth)
        : settings.readingWidth;
    next.assistantFontSize = isAssistantFontSize(value?.assistantFontSize)
      ? value!.assistantFontSize
      : settings.assistantFontSize;
    next.chatTitleCentered =
      typeof value?.chatTitleCentered === 'boolean'
        ? value.chatTitleCentered
        : settings.chatTitleCentered;
    next.workspaceTreeEnabled =
      typeof value?.workspaceTreeEnabled === 'boolean'
        ? value.workspaceTreeEnabled
        : settings.workspaceTreeEnabled;
    next.composerAutoHide = COMPOSER_FOLD_MODES.includes(value?.composerAutoHide)
      ? value!.composerAutoHide
      : settings.composerAutoHide;
    next.composerHideStyle =
      next.composerAutoHide !== 'off'
        ? next.composerAutoHide
        : COMPOSER_FOLD_STYLES.includes(value?.composerHideStyle)
          ? value!.composerHideStyle
          : settings.composerHideStyle;
    next.composerHideAfterSend =
      typeof value?.composerHideAfterSend === 'boolean'
        ? value.composerHideAfterSend
        : settings.composerHideAfterSend;
    next.fileChangesDefaultCollapsed =
      typeof value?.fileChangesDefaultCollapsed === 'boolean'
        ? value.fileChangesDefaultCollapsed
        : settings.fileChangesDefaultCollapsed;
    next.customAccent =
      typeof value?.customAccent === 'boolean' ? value.customAccent : settings.customAccent;
    next.tableEnabled =
      typeof value?.tableEnabled === 'boolean'
        ? value.tableEnabled
        : typeof value?.tableOptimization === 'boolean'
          ? value.tableOptimization
          : settings.tableEnabled;
    next.tableCentered =
      typeof value?.tableCentered === 'boolean' ? value.tableCentered : settings.tableCentered;
    next.tableSortMode = TABLE_SORT_MODES.includes(value?.tableSortMode)
      ? value!.tableSortMode
      : settings.tableSortMode;
    next.commandMenuEnabled =
      typeof value?.commandMenuEnabled === 'boolean'
        ? value.commandMenuEnabled
        : settings.commandMenuEnabled;
    next.commandVisible = normalizeCommands(value?.commandVisible ?? settings.commandVisible);
    next.skillVisible = normalizeSkills(value?.skillVisible ?? settings.skillVisible);
    next.commandSectionOrder = normalizeCommandSections(
      value?.commandSectionOrder ?? settings.commandSectionOrder,
    );
    next.commandGroupOrder = normalizeCommandGroups(
      value?.commandGroupOrder ?? settings.commandGroupOrder,
    );
    next.commandItemOrder = normalizeCommandItems(
      value?.commandItemOrder ?? settings.commandItemOrder,
    );
    next.metricOrder = normalizeOrder(value?.metricOrder ?? settings.metricOrder);
    next.metricVisible = normalizeVisible(value?.metricVisible ?? settings.metricVisible);
    return next;
  };

  const preferenceSnapshot = (): PreferencesState => ({
    readingWidth: settings.readingWidth,
    assistantFontSize: settings.assistantFontSize,
    chatTitleCentered: settings.chatTitleCentered,
    workspaceTreeEnabled: settings.workspaceTreeEnabled,
    composerAutoHide: settings.composerAutoHide,
    composerHideStyle: settings.composerHideStyle,
    composerHideAfterSend: settings.composerHideAfterSend,
    fileChangesDefaultCollapsed: settings.fileChangesDefaultCollapsed,
    customAccent: settings.customAccent,
    tableEnabled: settings.tableEnabled,
    tableCentered: settings.tableCentered,
    tableSortMode: settings.tableSortMode,
    commandMenuEnabled: settings.commandMenuEnabled,
    commandVisible: { ...settings.commandVisible },
    skillVisible: { ...settings.skillVisible },
    commandSectionOrder: [...settings.commandSectionOrder] as [string, string],
    commandGroupOrder: [...settings.commandGroupOrder],
    commandItemOrder: normalizeCommandItems(settings.commandItemOrder),
    metricOrder: [...metricOrder],
    metricVisible: { ...metricVisible },
  });

  const samePreferences = (left: PreferencesState, right: PreferencesState) =>
    JSON.stringify(left) === JSON.stringify(right);

  function updateRangeProgress(value: number): void {
    widthRange.style.setProperty('--range-progress', `${((clampWidth(value) - 768) / (1600 - 768)) * 100}%`);
  }

  function showWidth(value: number): void {
    const next = clampWidth(value);
    widthRange.value = String(next);
    if (!widthEditing) widthNumber.value = String(next);
    widthRange.setAttribute('aria-valuetext', t('pixels', { count: next }));
    updateRangeProgress(next);
  }

  function showAssistantFontSize(): void {
    if (!assistantFontEditing) {
      assistantFontInput.value = settings.assistantFontSize === null ? '' : String(settings.assistantFontSize);
    }
  }

  function colorLuminance(value: string): number | null {
    const color = String(value)
      .match(/[\d.]+/g)
      ?.slice(0, 3)
      .map(Number);
    if (!color || color.length !== 3) return null;
    return color
      .map((channel) => {
        const c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  }

  function updateAccentContrast(): void {
    const surface = getComputedStyle($('#surface-probe')).backgroundColor;
    const luminance = colorLuminance(surface);
    host.style.setProperty('--ui-accent-contrast', luminance !== null && luminance > 0.45 ? '#ffffff' : '#000000');
  }

  function setSwitch(node: HTMLElement, checked: boolean): void {
    node.dataset.state = checked ? 'checked' : 'unchecked';
    node.setAttribute('aria-checked', String(checked));
  }

  function setDisclosure(toggle: HTMLElement, options: HTMLElement, expanded: boolean): void {
    toggle.setAttribute('aria-expanded', String(expanded));
    options.dataset.open = String(expanded);
    options.setAttribute('aria-hidden', String(!expanded));
    options.inert = !expanded;
  }

  function renderTableSort(): void {
    for (const button of tableSortButtons) {
      const active = button.dataset.tableSortMode === settings.tableSortMode;
      button.dataset.state = active ? 'on' : 'off';
      button.setAttribute('aria-checked', String(active));
      button.disabled = !settings.tableEnabled;
      button.tabIndex = active && settings.tableEnabled ? 0 : -1;
    }
    tableSortGroup.setAttribute('aria-disabled', String(!settings.tableEnabled));
    tableOptionsBody.dataset.disabled = String(!settings.tableEnabled);
  }

  function renderTableDisclosure(): void {
    setDisclosure(tableToggle, tableOptions, tableExpanded);
  }

  function commandGrip(kind: string, id: string, group: string, label: string): HTMLSpanElement {
    const grip = document.createElement('span');
    grip.className = 'command-grip';
    grip.draggable = true;
    grip.tabIndex = 0;
    grip.setAttribute('role', 'button');
    grip.dataset.commandDrag = kind;
    grip.dataset.commandDragId = id;
    grip.dataset.commandDragGroup = group;
    grip.setAttribute('aria-label', t('commandReorder', { name: label }));
    grip.title = t('commandReorder', { name: label });
    grip.innerHTML =
      '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M9 5h.01 M9 12h.01 M9 19h.01 M15 5h.01 M15 12h.01 M15 19h.01" stroke-width="3"/></svg>';
    return grip;
  }

  function syncCommands(): void {
    commandMenu()?.update(settings.commandVisible, {
      enabled: settings.commandMenuEnabled,
      groupOrder: settings.commandGroupOrder,
      itemOrder: settings.commandItemOrder,
      skillVisible: settings.skillVisible,
    });
  }

  function renderSkillControls(): void {
    if (!slashExpanded || !skillExpanded || panel.hidden) return;
    const entries = commandMenu()?.skillEntries?.(composer()) || [];
    const signature = JSON.stringify(entries);
    if (signature !== skillSignature) {
      skillSignature = signature;
      skillButtons.replaceChildren(
        ...entries.map(({ id, title: skillName }) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'ui-toggle-group-item';
          button.dataset.skillId = id;
          button.textContent = skillName;
          button.title = skillName;
          return button;
        }),
      );
    }
    for (const child of skillButtons.children) {
      const button = child as HTMLButtonElement;
      const on = settings.skillVisible[button.dataset.skillId!] !== false;
      button.dataset.state = on ? 'on' : 'off';
      button.setAttribute('aria-pressed', String(on));
    }
  }

  function renderCommandControls(): void {
    const extra = commandMenu()?.entries() || [];
    const signature =
      `${i18n.locale()}|${JSON.stringify(extra.map((item) => [item.id, item.title]))}|` +
      JSON.stringify([settings.commandGroupOrder, settings.commandItemOrder]);
    const commandsLabel = t('commandButtons');
    const skillsLabel = t('commandSkills');
    $('#command-label').textContent = commandsLabel;
    $('#skill-label').textContent = skillsLabel;
    $('#slash-label').textContent = t('commandMenu');
    commandEnabled.setAttribute('aria-label', t('commandMenu'));
    commandEnabled.title = t('commandMenu');

    for (const [id, section] of Object.entries(slashSections)) {
      const header = section.firstElementChild!;
      const label = id === 'commands' ? commandsLabel : skillsLabel;
      let grip = header.querySelector<HTMLElement>('[data-command-drag]');
      if (!grip) {
        grip = commandGrip('section', id, '', label);
        header.prepend(grip);
      }
      grip.setAttribute('aria-label', t('commandReorder', { name: label }));
      grip.title = t('commandReorder', { name: label });
    }

    const first = slashSections[settings.commandSectionOrder[0]];
    if (first && slashSettings.firstElementChild !== first) {
      const focus = shadow.activeElement;
      slashSettings.prepend(first);
      if (focus instanceof HTMLElement && first.contains(focus)) focus.focus({ preventScroll: true });
    }

    if (signature !== commandSignature) {
      commandSignature = signature;
      commandBody.replaceChildren();
      for (const { id: group, items } of commandCatalog?.orderedGroups(
        settings.commandGroupOrder,
        settings.commandItemOrder,
        extra,
      ) || []) {
        if (!items.length) continue;
        const section = document.createElement('div');
        section.className = 'command-group';
        section.dataset.commandGroup = group;
        const groupLabel = t(`commandGroup.${group}`);
        section.append(commandGrip('group', group, group, groupLabel));

        const buttons = document.createElement('div');
        buttons.className = 'ui-toggle-group command-buttons';
        buttons.setAttribute('role', 'group');
        buttons.setAttribute('aria-label', groupLabel);
        section.append(buttons);

        for (const item of items) {
          const fullLabel = item.label ? t(item.label) : (item.title ?? item.id);
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'ui-toggle-group-item command-segment';
          button.dataset.commandId = item.id;
          button.dataset.commandRow = item.id;
          button.dataset.commandDrag = 'item';
          button.dataset.commandDragId = item.id;
          button.dataset.commandDragGroup = group;
          button.draggable = true;
          button.setAttribute('data-slot', 'toggle-group-item');
          button.setAttribute('aria-label', fullLabel);
          button.title = fullLabel;

          if (COMMAND_ICON_PATHS[item.id]) {
            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            icon.setAttribute('class', 'icon');
            icon.setAttribute('viewBox', '0 0 24 24');
            icon.setAttribute('aria-hidden', 'true');
            const path = document.createElementNS(icon.namespaceURI, 'path');
            path.setAttribute('d', COMMAND_ICON_PATHS[item.id]);
            icon.append(path);
            button.append(icon);
          }

          const text = document.createElement('span');
          text.textContent = item.shortLabel ? t(item.shortLabel) : fullLabel;
          button.append(text);
          buttons.append(button);
        }
        commandBody.append(section);
      }
    }

    for (const button of commandBody.querySelectorAll<HTMLButtonElement>('[data-command-id]')) {
      const on = settings.commandVisible[button.dataset.commandId!] === true;
      button.dataset.state = on ? 'on' : 'off';
      button.setAttribute('aria-pressed', String(on));
    }

    renderSkillControls();
    setSwitch(commandEnabled, settings.commandMenuEnabled);
    setDisclosure(slashToggle, slashOptions, slashExpanded);
    setDisclosure(commandToggle, commandOptions, commandExpanded);
    setDisclosure(skillToggle, skillOptions, skillExpanded);
  }

  const commandCatalogChanged = () => renderCommandControls();
  window.addEventListener('better-codex-command-catalog', commandCatalogChanged);

  function positionFoldHighlight(): void {
    const segment = foldOptions.find((option) => option.checked)?.parentElement;
    if (!segment?.offsetWidth) return;
    foldControl.style.setProperty('--fold-width', `${segment.offsetWidth}px`);
    foldControl.style.setProperty('--fold-offset', `${segment.offsetLeft}px`);
  }

  const foldSize = new ResizeObserver(positionFoldHighlight);
  for (const option of foldOptions) {
    if (option.parentElement) foldSize.observe(option.parentElement);
  }

  let renderedFoldStyle: FoldStyle | undefined;
  function renderFoldControl(): void {
    const active = settings.composerAutoHide !== 'off';
    if (renderedFoldStyle !== settings.composerHideStyle) {
      renderedFoldStyle = settings.composerHideStyle;
      for (const option of foldOptions) option.checked = option.value === renderedFoldStyle;
      positionFoldHighlight();
    }
    setSwitch(foldEnabled, active);
    foldPanelBody.dataset.disabled = String(!active);
    for (const option of foldOptions) option.disabled = !active;
    foldAfterSend.disabled = !active;
    setSwitch(foldAfterSend, settings.composerHideAfterSend);
    window.__codexComposerFold?.update(settings.composerAutoHide, settings.composerHideAfterSend);
  }

  function renderControls(): void {
    renderFoldControl();
    renderCommandControls();
    showWidth(settings.readingWidth);
    showAssistantFontSize();
    setSwitch(chatTitleCentered, settings.chatTitleCentered);
    setSwitch(workspaceTreeEnabled, settings.workspaceTreeEnabled);
    setSwitch(filesDefault, settings.fileChangesDefaultCollapsed);
    setSwitch(accentToggle, settings.customAccent);
    setSwitch(tableEnabled, settings.tableEnabled);
    setSwitch(tableCentered, settings.tableCentered);
    tableCentered.disabled = !settings.tableEnabled;
    renderTableSort();
    renderTableDisclosure();
  }

  function renderSaveState(): void {
    const state = saveState.dataset.state === 'pending' ? 'pending' : 'saved';
    saveState.dataset.state = state;
    saveStateText.textContent = t(state === 'pending' ? 'saving' : 'saved');
  }

  function renderToolbarState(): void {
    undoButton.disabled = !past.length;
    redoButton.disabled = !future.length;
    undoButton.setAttribute('aria-label', t('undo'));
    undoButton.title = t('undo');
    redoButton.setAttribute('aria-label', t('redo'));
    redoButton.title = t('redo');
    restoreButton.setAttribute('aria-label', t('restoreDefaults'));
    restoreButton.title = t('restoreDefaults');
  }

  function renderToolbar(): void {
    renderSaveState();
    renderToolbarState();
  }

  function recordHistory(): void {
    if (!historyReady) return;
    past.push(preferenceSnapshot());
    if (past.length > 50) past.shift();
    future = [];
    renderToolbarState();
  }

  let speedMode: 'magpie' | 'local' = 'magpie';
  const metricLabel = (key: MetricKey) =>
    t({ ttft: 'metricTtft', speed: 'metricTps', cache: 'metricCache', age: 'metricAge' }[key]);
  const metricTooltip = (key: MetricKey) =>
    t(
      {
        ttft: 'responseTtft',
        speed: speedMode === 'local' ? 'responseLocalAverage' : 'responseAverage',
        cache: 'responseCache',
        age: 'responseAge',
      }[key],
    );

  function renderMetricGroup(force = false): void {
    const signature = `${i18n.locale()}|${metricOrder.join(',')}`;
    if (force || signature !== groupSignature) {
      groupSignature = signature;
      const css = getComputedStyle(metricGroup);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      ctx.font = `600 ${css.fontSize} ${getComputedStyle(host).fontFamily}`;
      metricGroup.replaceChildren(
        ...metricOrder.map((key) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'ui-toggle-group-item';
          button.dataset.slot = 'toggle-group-item';
          button.dataset.metricKey = key;
          button.draggable = true;
          const label = document.createElement('span');
          label.className = 'metric-label';
          label.textContent = metricLabel(key);
          const measured =
            ctx.measureText(label.textContent).width ||
            label.textContent.length * parseFloat(css.fontSize || '14') * 0.65;
          button.style.flexGrow = String(Math.ceil(measured) + 20);
          button.dataset.labelWidth = String(Math.ceil(measured));
          button.append(label);
          button.title = metricLabel(key);
          return button;
        }),
      );
    }

    for (const button of metricGroup.querySelectorAll<HTMLButtonElement>('[data-metric-key]')) {
      const key = button.dataset.metricKey as MetricKey;
      const on = metricVisible[key];
      button.dataset.state = on ? 'on' : 'off';
      button.setAttribute('aria-pressed', String(on));
      button.setAttribute(
        'aria-label',
        `${metricLabel(key)}: ${on ? t('metricShown') : t('metricHidden')}`,
      );
    }
    metricGroup.setAttribute('aria-label', t('statsDisplay'));
  }

  function renderMetrics(): void {
    metrics.append(...metricOrder.map((key) => metricNodes[key]));
    const shown = metricOrder.filter((key) => metricVisible[key]);
    const displayed = compactMetrics ? shown.slice(0, 2) : shown;
    for (const key of METRIC_KEYS) {
      const node = metricNodes[key];
      const visible = displayed.includes(key);
      node.hidden = !visible;
      node.classList.toggle('first', visible && key === displayed[0]);
      node.textContent = metricValues[key] || '';
      node.title = metricTooltip(key);
      node.dataset.metricKey = key;
    }
    metrics.dataset.visibleCount = String(displayed.length);
    metrics.title = t('openInterfaceSettings');
  }

  function setCompactMetrics(value: boolean): void {
    compactMetrics = Boolean(value);
    renderMetrics();
  }

  function applyPreferences(value: Record<string, unknown>): void {
    const previousOrder = metricOrder.join(',');
    const previousVisible = JSON.stringify(metricVisible);
    settings = normalizePreferences(value);
    syncCommands();
    metricOrder = [...settings.metricOrder];
    metricVisible = { ...settings.metricVisible };
    renderControls();
    renderMetricGroup();
    if (previousOrder !== metricOrder.join(',') || previousVisible !== JSON.stringify(metricVisible)) {
      renderMetrics();
    }
    window.__codexFileChanges?.setDefaultCollapsed?.(settings.fileChangesDefaultCollapsed);
    window.__codexReadingWidth?.setTablesEnabled?.(settings.tableEnabled);
    window.__codexReadingWidth?.setTableCentered?.(settings.tableCentered);
    window.__codexReadingWidth?.setAssistantFontSize?.(settings.assistantFontSize);
    window.__codexReadingWidth?.setChatTitleCentered?.(settings.chatTitleCentered);
    window.__codexTableSort?.setEnabled?.(settings.tableEnabled);
    window.__codexTableSort?.setDefaultMode?.(settings.tableSortMode);
    window.__codexWorkspaceTree?.setEnabled?.(settings.workspaceTreeEnabled);
    if (!historyReady) historyReady = true;
  }

  function queueSettings(patch: Record<string, unknown>): void {
    pendingSettings = {
      value: { ...(pendingSettings?.value || {}), ...patch },
      revision: ++settingsRevision,
    };
    saveState.dataset.state = 'pending';
    renderSaveState();
  }

  function changeWidth(value: unknown, save: boolean): void {
    const next = clampWidth(value);
    if (next === settings.readingWidth) return;
    if (save) recordHistory();
    settings.readingWidth = next;
    showWidth(next);
    window.__codexReadingWidth?.preview(next);
    if (save) queueSettings({ readingWidth: next });
  }

  function commitWidthInput(): boolean {
    const raw = widthNumber.value.trim();
    const value = Number(raw);
    widthEditing = false;
    if (!raw || !Number.isInteger(value) || value < 768 || value > 1600) {
      showWidth(settings.readingWidth);
      return false;
    }
    changeWidth(value, true);
    showWidth(settings.readingWidth);
    return true;
  }

  function commitAssistantFontSize(): void {
    if (!assistantFontEditing) return;
    assistantFontEditing = false;
    const raw = assistantFontInput.value.trim();
    const value = raw === '' ? null : /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (isAssistantFontSize(value) && value !== settings.assistantFontSize) {
      recordHistory();
      settings.assistantFontSize = value;
      window.__codexReadingWidth?.setAssistantFontSize?.(value);
      queueSettings({ assistantFontSize: value });
    }
    showAssistantFontSize();
  }

  function toggleMetric(key: MetricKey): void {
    if (Date.now() < suppressClickUntil) return;
    if (metricVisible[key] && metricOrder.filter((candidate) => metricVisible[candidate]).length === 1) {
      const button = metricGroup.querySelector(`[data-metric-key="${key}"]`);
      button?.animate(
        [{ transform: 'translateX(-2px)' }, { transform: 'translateX(2px)' }, { transform: 'translateX(0)' }],
        { duration: 160 },
      );
      return;
    }
    recordHistory();
    metricVisible[key] = !metricVisible[key];
    settings.metricVisible = { ...metricVisible };
    renderMetricGroup();
    renderMetrics();
    queueSettings({ metricVisible: { ...metricVisible } });
  }

  function moveMetric(source: MetricKey, target: MetricKey): void {
    if (!source || !target || source === target) return;
    const next = metricOrder.filter((key) => key !== source);
    const index = next.indexOf(target);
    if (index < 0) return;
    recordHistory();
    next.splice(index, 0, source);
    metricOrder = next;
    settings.metricOrder = [...next];
    renderMetricGroup(true);
    renderMetrics();
    queueSettings({ metricOrder: [...next] });
  }

  function applySnapshot(value: PreferencesState): void {
    applyPreferences(value as unknown as Record<string, unknown>);
    window.__codexReadingWidth?.preview(settings.readingWidth);
    window.__codexFileChanges?.setDefaultCollapsed?.(settings.fileChangesDefaultCollapsed);
    queueSettings({
      ...preferenceSnapshot(),
      metricOrder: [...metricOrder],
      metricVisible: { ...metricVisible },
    });
    renderToolbarState();
  }

  function restoreDefaults(): void {
    const defaults: PreferencesState = {
      ...DEFAULT_PREFERENCES,
      metricOrder: [...DEFAULT_METRIC_ORDER],
      metricVisible: { ...DEFAULT_METRIC_VISIBLE },
    };
    if (samePreferences(preferenceSnapshot(), defaults)) return;
    recordHistory();
    applySnapshot(defaults);
  }

  function undo(): void {
    if (!past.length) return;
    future.push(preferenceSnapshot());
    applySnapshot(past.pop()!);
  }

  function redo(): void {
    if (!future.length) return;
    past.push(preferenceSnapshot());
    applySnapshot(future.pop()!);
  }

  function openPanel(): void {
    panel.hidden = false;
    renderSkillControls();
    metrics.setAttribute('aria-expanded', 'true');
    updateAccentContrast();
    layout();
    if (!panel.hidden) widthRange.focus({ preventScroll: true });
  }

  function closePanel(focus = false): void {
    panel.hidden = true;
    metrics.setAttribute('aria-expanded', 'false');
    if (focus) metrics.focus({ preventScroll: true });
  }

  const togglePanel = () => (panel.hidden ? openPanel() : closePanel(true));

  metrics.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    togglePanel();
  });
  metrics.addEventListener('click', (event) => {
    if (event.detail === 0) togglePanel();
  });
  widthRange.addEventListener('input', () => changeWidth(widthRange.value, true));
  widthNumber.addEventListener('focus', () => {
    widthEditing = true;
    widthCancel = false;
  });
  widthNumber.addEventListener('input', () => {
    widthEditing = true;
  });
  widthNumber.addEventListener('blur', () => {
    if (widthCancel) {
      widthCancel = false;
      widthEditing = false;
      showWidth(settings.readingWidth);
      return;
    }
    commitWidthInput();
  });
  widthNumber.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitWidthInput();
      widthNumber.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      widthCancel = true;
      widthEditing = false;
      showWidth(settings.readingWidth);
      widthNumber.blur();
    }
  });
  assistantFontInput.addEventListener('input', () => {
    assistantFontEditing = true;
  });
  assistantFontInput.addEventListener('blur', commitAssistantFontSize);
  assistantFontInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      commitAssistantFontSize();
      assistantFontInput.blur();
    }
  });
  foldToggle.addEventListener('click', () => {
    setDisclosure(foldToggle, foldPanel, foldPanel.inert);
    layout();
  });

  function changeFoldMode(mode: FoldMode): void {
    recordHistory();
    settings.composerAutoHide = mode;
    if (mode !== 'off') settings.composerHideStyle = mode;
    renderFoldControl();
    queueSettings({ composerAutoHide: mode, composerHideStyle: settings.composerHideStyle });
  }

  foldEnabled.addEventListener('click', () =>
    changeFoldMode(settings.composerAutoHide === 'off' ? settings.composerHideStyle : 'off'),
  );
  foldControl.addEventListener('change', (event) => {
    const mode = (event.target as HTMLInputElement).value as FoldStyle;
    if (
      settings.composerAutoHide === 'off' ||
      !COMPOSER_FOLD_STYLES.includes(mode) ||
      mode === settings.composerAutoHide
    ) {
      return;
    }
    changeFoldMode(mode);
  });
  foldAfterSend.addEventListener('click', () => {
    if (settings.composerAutoHide === 'off') return;
    recordHistory();
    settings.composerHideAfterSend = !settings.composerHideAfterSend;
    renderFoldControl();
    queueSettings({ composerHideAfterSend: settings.composerHideAfterSend });
  });
  filesDefault.addEventListener('click', () => {
    recordHistory();
    settings.fileChangesDefaultCollapsed = !settings.fileChangesDefaultCollapsed;
    setSwitch(filesDefault, settings.fileChangesDefaultCollapsed);
    window.__codexFileChanges?.setDefaultCollapsed?.(settings.fileChangesDefaultCollapsed);
    queueSettings({ fileChangesDefaultCollapsed: settings.fileChangesDefaultCollapsed });
  });
  accentToggle.addEventListener('click', () => {
    recordHistory();
    settings.customAccent = !settings.customAccent;
    setSwitch(accentToggle, settings.customAccent);
    queueSettings({ customAccent: settings.customAccent });
  });
  tableEnabled.addEventListener('click', () => {
    recordHistory();
    settings.tableEnabled = !settings.tableEnabled;
    renderControls();
    window.__codexReadingWidth?.setTablesEnabled?.(settings.tableEnabled);
    window.__codexReadingWidth?.setTableCentered?.(settings.tableCentered);
    window.__codexTableSort?.setEnabled?.(settings.tableEnabled);
    window.__codexTableSort?.setDefaultMode?.(settings.tableSortMode);
    queueSettings({ tableEnabled: settings.tableEnabled });
  });
  tableToggle.addEventListener('click', () => {
    tableExpanded = !tableExpanded;
    renderTableDisclosure();
    layout();
  });
  workspaceTreeEnabled.addEventListener('click', () => {
    recordHistory();
    settings.workspaceTreeEnabled = !settings.workspaceTreeEnabled;
    setSwitch(workspaceTreeEnabled, settings.workspaceTreeEnabled);
    window.__codexWorkspaceTree?.setEnabled?.(settings.workspaceTreeEnabled);
    queueSettings({ workspaceTreeEnabled: settings.workspaceTreeEnabled });
  });
  chatTitleCentered.addEventListener('click', () => {
    recordHistory();
    settings.chatTitleCentered = !settings.chatTitleCentered;
    setSwitch(chatTitleCentered, settings.chatTitleCentered);
    window.__codexReadingWidth?.setChatTitleCentered?.(settings.chatTitleCentered);
    queueSettings({ chatTitleCentered: settings.chatTitleCentered });
  });
  tableCentered.addEventListener('click', () => {
    if (!settings.tableEnabled) return;
    recordHistory();
    settings.tableCentered = !settings.tableCentered;
    setSwitch(tableCentered, settings.tableCentered);
    window.__codexReadingWidth?.setTableCentered?.(settings.tableCentered);
    queueSettings({ tableCentered: settings.tableCentered });
  });
  tableSortGroup.addEventListener('click', (event) => {
    if (!settings.tableEnabled) return;
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-table-sort-mode]');
    const mode = button?.dataset.tableSortMode as TableSortMode | undefined;
    if (!mode || !TABLE_SORT_MODES.includes(mode) || mode === settings.tableSortMode) return;
    recordHistory();
    settings.tableSortMode = mode;
    renderTableSort();
    window.__codexTableSort?.setDefaultMode?.(mode);
    queueSettings({ tableSortMode: mode });
  });
  tableSortGroup.addEventListener('keydown', (event) => {
    if (!settings.tableEnabled || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const current = (event.target as Element).closest<HTMLButtonElement>('[data-table-sort-mode]');
    const index = current ? tableSortButtons.indexOf(current) : -1;
    if (index < 0) return;
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const next = (index + direction + tableSortButtons.length) % tableSortButtons.length;
    tableSortButtons[next].focus();
    tableSortButtons[next].click();
  });

  commandEnabled.addEventListener('click', () => {
    recordHistory();
    settings.commandMenuEnabled = !settings.commandMenuEnabled;
    syncCommands();
    renderCommandControls();
    queueSettings({ commandMenuEnabled: settings.commandMenuEnabled });
  });
  slashToggle.addEventListener('click', () => {
    slashExpanded = !slashExpanded;
    renderCommandControls();
    layout();
  });
  commandToggle.addEventListener('click', () => {
    commandExpanded = !commandExpanded;
    renderCommandControls();
    layout();
  });
  skillToggle.addEventListener('click', () => {
    skillExpanded = !skillExpanded;
    renderCommandControls();
    layout();
  });
  commandBody.addEventListener('click', (event) => {
    if (Date.now() < commandSuppressClickUntil) return;
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-command-id]');
    if (!button?.dataset.commandId) return;
    const id = button.dataset.commandId;
    recordHistory();
    settings.commandVisible = {
      ...settings.commandVisible,
      [id]: settings.commandVisible[id] !== true,
    };
    syncCommands();
    renderCommandControls();
    queueSettings({ commandVisible: { ...settings.commandVisible } });
  });
  skillButtons.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-skill-id]');
    if (!button?.dataset.skillId) return;
    const id = button.dataset.skillId;
    recordHistory();
    settings.skillVisible = {
      ...settings.skillVisible,
      [id]: settings.skillVisible[id] === false,
    };
    syncCommands();
    renderSkillControls();
    queueSettings({ skillVisible: { ...settings.skillVisible } });
  });

  function commandSequence(kind: string, group: string): string[] {
    return kind === 'section'
      ? [...settings.commandSectionOrder]
      : kind === 'group'
        ? [...settings.commandGroupOrder]
        : commandCatalog
            ?.orderedGroups(
              settings.commandGroupOrder,
              settings.commandItemOrder,
              commandMenu()?.entries() || [],
            )
            .find((item) => item.id === group)
            ?.items.map((item) => item.id) || [];
  }

  function moveCommand(kind: string, group: string, source: string, target: string): void {
    const order = commandSequence(kind, group);
    const from = order.indexOf(source);
    const to = order.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    recordHistory();
    order.splice(from, 1);
    order.splice(to, 0, source);
    const patch =
      kind === 'section'
        ? { commandSectionOrder: order }
        : kind === 'group'
          ? { commandGroupOrder: order }
          : { commandItemOrder: { ...settings.commandItemOrder, [group]: order } };
    Object.assign(settings, patch);
    if (kind !== 'section') syncCommands();
    renderCommandControls();
    queueSettings(patch);
  }

  function commandDropTarget(event: DragEvent): { node: HTMLElement; id: string } | null {
    if (!commandDrag || !(event.target instanceof Element)) return null;
    if (commandDrag.kind === 'section') {
      const target = event.target.closest<HTMLElement>('[data-slash-section]');
      return target?.firstElementChild instanceof HTMLElement && target.dataset.slashSection
        ? { node: target.firstElementChild, id: target.dataset.slashSection }
        : null;
    }
    const section = event.target.closest<HTMLElement>('[data-command-group]');
    if (!section?.dataset.commandGroup) return null;
    if (commandDrag.kind === 'group') return { node: section, id: section.dataset.commandGroup };
    const row = event.target.closest<HTMLElement>('[data-command-row]');
    return row?.dataset.commandRow && section.dataset.commandGroup === commandDrag.group
      ? { node: row, id: row.dataset.commandRow }
      : null;
  }

  function clearCommandDrag(): void {
    commandDrag = null;
    for (const node of slashSettings.querySelectorAll('[data-command-drop],.command-dragging')) {
      node.removeAttribute('data-command-drop');
      node.classList.remove('command-dragging');
    }
  }

  slashSettings.addEventListener('dragstart', (event) => {
    const grip = (event.target as Element).closest<HTMLElement>('[data-command-drag]');
    if (!grip || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    commandDrag = {
      kind: grip.dataset.commandDrag!,
      id: grip.dataset.commandDragId!,
      group: grip.dataset.commandDragGroup!,
    };
    grip.classList.add('command-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', 'better-codex-command-order');
    if (commandDrag.kind !== 'section') commandSuppressClickUntil = Date.now() + 350;
  });

  slashSettings.addEventListener('dragover', (event) => {
    const target = commandDropTarget(event);
    if (!target || !commandDrag || target.id === commandDrag.id || !event.dataTransfer) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    for (const node of slashSettings.querySelectorAll('[data-command-drop]')) {
      node.removeAttribute('data-command-drop');
    }
    const order = commandSequence(commandDrag.kind, commandDrag.group);
    target.node.dataset.commandDrop =
      order.indexOf(commandDrag.id) < order.indexOf(target.id) ? 'after' : 'before';
    const bounds = panel.getBoundingClientRect();
    if (event.clientY < bounds.top + 36) panel.scrollTop -= 12;
    else if (event.clientY > bounds.bottom - 36) panel.scrollTop += 12;
  });

  slashSettings.addEventListener('drop', (event) => {
    const target = commandDropTarget(event);
    if (!target || !commandDrag) return;
    event.preventDefault();
    const source = commandDrag;
    clearCommandDrag();
    moveCommand(source.kind, source.group, source.id, target.id);
    if (source.kind !== 'section') commandSuppressClickUntil = Date.now() + 350;
  });

  slashSettings.addEventListener('dragend', clearCommandDrag);

  commandBody.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    const button = (event.target as Element).closest<HTMLElement>('[data-command-id]');
    if (!button?.parentElement) return;
    event.preventDefault();
    const buttons = [...button.parentElement.children] as HTMLElement[];
    const index = buttons.indexOf(button);
    const next = (index + (event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next].focus({ preventScroll: true });
  });

  slashSettings.addEventListener('keydown', (event) => {
    const grip = (event.target as Element).closest<HTMLElement>('[data-command-drag]');
    if (
      !grip ||
      !['ArrowUp', 'ArrowDown'].includes(event.key) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const kind = grip.dataset.commandDrag!;
    const group = grip.dataset.commandDragGroup!;
    const id = grip.dataset.commandDragId!;
    const order = commandSequence(kind, group);
    const index = order.indexOf(id);
    const target = order[index + (event.key === 'ArrowUp' ? -1 : 1)];
    if (!target) return;
    moveCommand(kind, group, id, target);
    [...slashSettings.querySelectorAll<HTMLElement>('[data-command-drag]')]
      .find((node) => node.dataset.commandDrag === kind && node.dataset.commandDragId === id)
      ?.focus({ preventScroll: true });
  });

  restoreButton.addEventListener('click', restoreDefaults);
  undoButton.addEventListener('click', undo);
  redoButton.addEventListener('click', redo);

  metricGroup.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-metric-key]');
    if (button?.dataset.metricKey) toggleMetric(button.dataset.metricKey as MetricKey);
  });
  metricGroup.addEventListener('dragstart', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-metric-key]');
    if (!button?.dataset.metricKey || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    dragSource = button.dataset.metricKey;
    button.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragSource);
    suppressClickUntil = Date.now() + 350;
  });
  metricGroup.addEventListener('dragover', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-metric-key]');
    if (!button || button.dataset.metricKey === dragSource || !event.dataTransfer) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    for (const node of metricGroup.querySelectorAll('[data-drag-over="true"]')) {
      node.removeAttribute('data-drag-over');
    }
    button.setAttribute('data-drag-over', 'true');
  });
  metricGroup.addEventListener('dragleave', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-metric-key]');
    if (button && !(event.relatedTarget instanceof Node && button.contains(event.relatedTarget))) {
      button.removeAttribute('data-drag-over');
    }
  });
  metricGroup.addEventListener('drop', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-metric-key]');
    if (!button?.dataset.metricKey) return;
    event.preventDefault();
    const source = (dragSource || event.dataTransfer?.getData('text/plain') || '') as MetricKey;
    moveMetric(source, button.dataset.metricKey as MetricKey);
    suppressClickUntil = Date.now() + 350;
  });
  metricGroup.addEventListener('dragend', () => {
    dragSource = '';
    suppressClickUntil = Date.now() + 350;
    for (const node of metricGroup.querySelectorAll('.dragging,[data-drag-over="true"]')) {
      node.classList.remove('dragging');
      node.removeAttribute('data-drag-over');
    }
  });

  const outside = (event: PointerEvent) => {
    if (event.composedPath().includes(host)) return;
    commitWidthInput();
    commitAssistantFontSize();
    closePanel();
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !panel.hidden) {
      event.preventDefault();
      event.stopPropagation();
      if (widthEditing) {
        widthCancel = true;
        widthEditing = false;
        showWidth(settings.readingWidth);
      }
      assistantFontEditing = false;
      showAssistantFontSize();
      closePanel(true);
    }
  };
  const closeOnBlur = () => closePanel();

  document.addEventListener('pointerdown', outside, true);
  window.addEventListener('keydown', escape, true);
  window.addEventListener('keyup', escape, true);
  window.addEventListener('blur', closeOnBlur);

  let key = '';
  let generation = 0;
  let updated = 0;
  let disposed = false;
  let language = '';
  let localizedSpeedMode = '';

  function localize(): void {
    const next = i18n.locale();
    if (language === next && localizedSpeedMode === speedMode) return;
    language = next;
    localizedSpeedMode = speedMode;
    host.lang = next;
    renderCommandControls();
    title.textContent = t('interfaceSettings');
    widthLabel.textContent = t('readingWidth');
    assistantFontLabel.textContent = t('assistantFontSize');
    chatTitleCenteredLabel.textContent = t('chatTitleCentered');
    workspaceTreeLabel.textContent = t('workspaceTree.title');
    workspaceTreeEnabled.title = t('workspaceTree.settingsHint');
    workspaceTreeEnabled.setAttribute('aria-description', workspaceTreeEnabled.title);
    assistantFontInput.placeholder = t('assistantFontNative');
    assistantFontInput.title = t('assistantFontSizeHint');
    assistantFontInput.setAttribute('aria-description', assistantFontInput.title);
    foldGroupLabel.textContent = t('composerHideGroup');
    foldLabel.textContent = t('composerHideStyle');
    foldAfterSendLabel.textContent = t('composerHideAfterSend');
    for (const option of foldOptions) {
      if (option.nextElementSibling) {
        option.nextElementSibling.textContent = t(`composerFold.${option.value}`);
      }
    }
    filesDefaultLabel.textContent = t('fileChangesList');
    filesDefaultCopy.textContent = t('defaultCollapsed');
    accentLabel.textContent = t('customAccentFix');
    tableLabel.textContent = t('table');
    tableCenteredLabel.textContent = t('tableCentered');
    tableSortLabel.textContent = t('tableSort');
    tableSortGroup.setAttribute('aria-label', t('tableSort'));
    const sortLabels: Record<TableSortMode, string> = {
      smart: 'tableSortSmart',
      ascending: 'tableSortAscendingDefault',
      descending: 'tableSortDescendingDefault',
    };
    for (const button of tableSortButtons) {
      button.textContent = t(sortLabels[button.dataset.tableSortMode as TableSortMode]);
    }
    renderToolbar();
    showWidth(settings.readingWidth);
    renderMetricGroup(true);
    if (!updated) metricValues.age = t('waiting');
    renderMetrics();
  }

  let resolved: { raw: string; title: string; id: string; at: number } | null = null;
  let compatibility: Record<string, unknown> = { status: 'pending', reason: 'awaiting-chat' };
  let geometryNodes: Element[] = [];
  const geometryObserver = new ResizeObserver(() => layout());

  function watchGeometry(root: Element, body: Element, content: Element[] = []): void {
    const next = [
      ...new Set(
        [root, body, root.closest('[data-app-shell-focus-area]'), ...content].filter(
          (node): node is Element => Boolean(node),
        ),
      ),
    ];
    if (next.length === geometryNodes.length && next.every((node, index) => node === geometryNodes[index])) {
      return;
    }
    geometryObserver.disconnect();
    geometryNodes = next;
    for (const node of geometryNodes) geometryObserver.observe(node);
  }

  const isVisible = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden';
  };

  function refuse(reason: string): null {
    compatibility = { status: 'pending', reason };
    return null;
  }

  function footerContent(body: Element, editor: Element, y: number, height: number) {
    const rects: DOMRect[] = [];
    const nodes: Element[] = [];
    const intersects = (rect: DOMRect) =>
      rect.width > 0 && rect.height > 0 && rect.top < y + height + 4 && rect.bottom > y - 4;

    function visit(element: Element): void {
      if (element === editor || element === host || element.matches('textarea,[contenteditable],script,style,template')) {
        return;
      }
      const css = getComputedStyle(element);
      if (css.display === 'none' || Number(css.opacity) === 0) return;
      const rect = element.getBoundingClientRect();
      const shown = css.visibility !== 'hidden' && css.visibility !== 'collapse';
      if (
        element.matches(
          'button,[role="button"],select,input,svg,img,canvas,video,progress,meter,[role="img"],[role="progressbar"],[role="meter"]',
        )
      ) {
        nodes.push(element);
        if (shown && intersects(rect)) rects.push(rect);
        return;
      }
      let hasContent = false;
      for (const child of element.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          hasContent = true;
          visit(child as Element);
        } else if (child.nodeType === Node.TEXT_NODE) {
          hasContent = true;
          if (!shown) continue;
          const range = document.createRange();
          range.selectNodeContents(child);
          for (const textRect of range.getClientRects()) {
            if (intersects(textRect)) {
              rects.push(textRect);
              nodes.push(element);
            }
          }
        }
      }
      if (!hasContent && shown && intersects(rect)) {
        const painted =
          css.backgroundImage !== 'none' ||
          !['transparent', 'rgba(0, 0, 0, 0)'].includes(css.backgroundColor) ||
          css.boxShadow !== 'none' ||
          (['Top', 'Right', 'Bottom', 'Left'] as const).some(
            (side) =>
              parseFloat(css[`border${side}Width` as keyof CSSStyleDeclaration] as string) > 0 &&
              css[`border${side}Style` as keyof CSSStyleDeclaration] !== 'none',
          );
        if (painted) {
          rects.push(rect);
          nodes.push(element);
        }
      }
    }

    visit(body);
    return { rects, nodes };
  }

  function composer(): Element | null {
    const area = '[data-app-shell-focus-area]';
    const active = '[data-app-shell-active-page="true"]';
    const roots = [...document.querySelectorAll('[data-codex-composer-root]')].filter(
      (root) =>
        !root.closest('[data-app-shell-active-page="false"]') &&
        (isVisible(root) ||
          window.__codexComposerFold?.hides(root) ||
          (root.closest(active) && root.querySelector('[data-above-composer-conversation-id]'))),
    );
    const onActivePage = roots.filter(
      (root) =>
        root.closest(active) &&
        (!root.closest(area) || root.closest(area)?.getAttribute('data-app-shell-focus-area') === 'main'),
    );
    const candidates = onActivePage.length ? onActivePage : roots;
    const main = candidates.filter(
      (root) => root.closest(area)?.getAttribute('data-app-shell-focus-area') === 'main',
    );
    if (!main.length && candidates.length === 1 && !candidates[0].closest(area)) return candidates[0];
    if (main.length === 1) return main[0];
    const painted = main.filter((root) => isVisible(root) || window.__codexComposerFold?.hides(root));
    return painted.length === 1 ? painted[0] : refuse('ambiguous-or-missing-composer');
  }

  function chat(root = composer()): { raw: string; title: string } | null {
    if (!root) return null;
    const markers = [...root.querySelectorAll('[data-above-composer-conversation-id]')];
    if (markers.length) {
      const ids = [
        ...new Set(markers.map((el) => el.getAttribute('data-above-composer-conversation-id'))),
      ];
      if (ids.length !== 1) return refuse('ambiguous-composer-chat');
      const id = ids[0];
      if (!UUID_RE.test(id || '')) return refuse('invalid-composer-chat-id');
      return { raw: `local:${id}`, title: '' };
    }
    const rows = [...document.querySelectorAll('[data-app-action-sidebar-thread-active="true"]')].filter(
      isVisible,
    );
    if (rows.length !== 1) return refuse('ambiguous-or-missing-chat');
    const row = rows[0];
    const raw = row.getAttribute('data-app-action-sidebar-thread-id') || '';
    if (
      row.getAttribute('data-app-action-sidebar-thread-kind') !== 'local' ||
      row.getAttribute('data-app-action-sidebar-thread-host-id') !== 'local'
    ) {
      return refuse('unsupported-chat');
    }
    return { raw, title: row.getAttribute('data-app-action-sidebar-thread-title') || '' };
  }

  function context(): { id: string; x?: number; y?: number; visible: boolean } | null {
    const root = composer();
    const selected = chat(root);
    if (!root || !selected) return null;

    const { raw, title: chatTitle } = selected;
    let id = /^local:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
      ? raw.slice(6)
      : null;
    if (!id && resolved?.raw === raw && resolved.title === chatTitle && Date.now() - resolved.at < 1500) {
      id = resolved.id;
    }
    if (!id) return refuse('awaiting-persistent-chat-id');

    if (window.__codexComposerFold?.hides(root)) {
      compatibility = { status: 'compatible', reason: 'composer-folded' };
      return { id, visible: false };
    }
    if (!isVisible(root)) {
      compatibility = { status: 'compatible', reason: 'composer-not-painted' };
      return { id, visible: false };
    }

    const bodies = [...root.querySelectorAll('[data-composer-body]')].filter(isVisible);
    if (bodies.length > 1) return refuse('ambiguous-composer-body');
    const body = bodies[0] || root;
    const bounds = body.getBoundingClientRect();

    if (root.closest('[data-right-panel-composer-overlay-content="true"]')) {
      return refuse('floating-composer-hidden');
    }
    const questions = [...root.querySelectorAll('[data-codex-composer-request-navigation]')];
    if (
      questions.some(
        (el) => isVisible(el) && !el.closest('[aria-hidden="true"],[inert],[data-app-shell-active-page="false"]'),
      )
    ) {
      return refuse('question-card-hidden');
    }

    let editors = [...body.querySelectorAll('[contenteditable="true"],textarea')].filter(isVisible);
    const primary = editors.filter((el) => el.getAttribute('data-codex-composer') === 'true');
    if (primary.length) editors = primary;
    if (editors.length !== 1) return refuse('unknown-editor-contract');

    const buttons = [...body.querySelectorAll('button,[role="button"],select')].filter(isVisible);
    const controls = buttons.map((el) => el.getBoundingClientRect());
    if (controls.length < 2) return refuse('missing-composer-controls');

    const bottom = Math.max(...controls.map((rect) => (rect.top + rect.bottom) / 2));
    const rowControls = controls.filter((rect) => Math.abs((rect.top + rect.bottom) / 2 - bottom) < 12);
    const compact = bottom < editors[0].getBoundingClientRect().bottom - 3;
    if (rowControls.length < 2 || (compact && !editors[0].closest('[data-composer-footer-responsive]'))) {
      return refuse('unknown-footer-contract');
    }

    const x = (bounds.left + bounds.right) / 2;
    const labels = buttons
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.right > x && Math.abs((rect.top + rect.bottom) / 2 - bottom) < 12;
      })
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);

    let reference: Element | undefined;
    for (const button of labels) {
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (
          parent &&
          (node.textContent ?? '').trim().length > 1 &&
          /[\p{L}\p{N}]/u.test(node.textContent ?? '') &&
          !parent.closest('svg') &&
          isVisible(parent)
        ) {
          reference = parent;
          break;
        }
      }
      if (reference) break;
    }
    if (!reference) return refuse('missing-footer-label-style');

    const refCss = getComputedStyle(reference);
    for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing'] as const) {
      host.style[property] = refCss[property];
    }

    if (!host.isConnected) document.body.append(host);
    host.style.visibility = 'hidden';
    host.hidden = false;
    setCompactMetrics(false);
    let size = host.getBoundingClientRect();
    const edge = Math.max(bounds.bottom, root.getBoundingClientRect().bottom);
    const gap = Math.min(4, Math.max(1, innerHeight - edge - size.height - 2));
    const y = compact ? edge + gap : bottom - size.height / 2;

    const hidden = (reason: string) => {
      refuse(reason);
      return { id, x, y, visible: false };
    };
    if (
      y < bounds.top ||
      (!compact && y + size.height > bounds.bottom) ||
      y + size.height > innerHeight - (compact ? 1 : 4) ||
      y < 0
    ) {
      return hidden('insufficient-space');
    }

    const content = footerContent(body, editors[0], y, size.height);
    watchGeometry(root, body, content.nodes);
    let spaces = [{ left: bounds.left + 12, right: bounds.right - 12 }];
    for (const rect of content.rects) {
      spaces = spaces.flatMap((space) => {
        if (rect.left - 12 >= space.right || rect.right + 12 <= space.left) return [space];
        return [
          { left: space.left, right: Math.min(space.right, rect.left - 12) },
          { left: Math.max(space.left, rect.right + 12), right: space.right },
        ].filter((candidate) => candidate.right > candidate.left);
      });
    }

    const fit = () =>
      spaces
        .filter((space) => space.right - space.left >= size.width)
        .map((space) => Math.max(space.left + size.width / 2, Math.min(x, space.right - size.width / 2)))
        .sort((a, b) => Math.abs(a - x) - Math.abs(b - x));

    let centers = fit();
    if (!centers.length) {
      setCompactMetrics(true);
      size = host.getBoundingClientRect();
      centers = fit();
    }
    if (!centers.length) return hidden('controls-overlap');

    compatibility = {
      status: 'compatible',
      reason: 'composer-contract-passed',
      placement: compact ? 'below-composer' : 'footer',
    };
    return { id, x: centers[0], y, visible: true };
  }

  function clearMetrics(): void {
    metricValues = { ttft: '-s', speed: '- tok/s', cache: '-%', age: t('waiting') };
    updated = 0;
    speedMode = 'magpie';
    renderMetrics();
  }

  function layout() {
    if (disposed) return null;
    localize();
    const current = context();
    const next = current?.id || '';
    if (key !== next) {
      key = next;
      generation++;
      clearMetrics();
      closePanel();
    }
    if (!current?.visible) {
      host.hidden = true;
      closePanel();
      return current;
    }
    if (!host.isConnected) document.body.append(host);
    host.style.left = `${current.x}px`;
    host.style.top = `${current.y}px`;
    host.style.visibility = 'visible';
    host.hidden = false;
    if (!panel.hidden) {
      const top = host.getBoundingClientRect().top;
      panel.style.maxHeight = `${Math.max(120, top - 24)}px`;
      panel.style.marginLeft = '0px';
      const bounds = panel.getBoundingClientRect();
      panel.style.marginLeft = `${
        bounds.left < 12 ? 12 - bounds.left : bounds.right > innerWidth - 12 ? innerWidth - 12 - bounds.right : 0
      }px`;
      if (bounds.top < 8) closePanel();
    }
    return current;
  }

  const timer = setInterval(() => {
    layout();
    if (updated && Date.now() - updated > 3000) clearMetrics();
  }, 250);

  const observer = new MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          record.target !== host &&
          !host.contains(record.target) &&
          (record.type !== 'attributes' ||
            !['class', 'style', 'hidden'].includes(record.attributeName ?? '') ||
            geometryNodes.some((node) => record.target.contains(node) || node.contains(record.target))),
      )
    ) {
      layout();
    }
  });

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      'data-above-composer-conversation-id',
      'data-app-action-sidebar-thread-active',
      'data-app-action-sidebar-thread-id',
      'aria-hidden',
      'inert',
      'class',
      'style',
      'hidden',
      'data-app-shell-active-page',
      'data-app-shell-focus-area',
      'data-codex-composer-request-navigation',
      'data-right-panel-composer-overlay-content',
    ],
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang', 'data-theme'] });
  window.addEventListener('resize', layout);
  window.addEventListener('languagechange', layout);

  renderControls();
  renderMetricGroup(true);
  renderMetrics();
  renderToolbar();

  window.__codexComposerHud = {
    settingsOpen: () => !panel.hidden,
    settingsRequest: () => pendingSettings,
    settingsAck(value) {
      if (value && pendingSettings?.revision === value.revision) {
        pendingSettings = null;
        saveState.dataset.state = 'saved';
        renderSaveState();
      }
    },
    settingsState(value) {
      applyPreferences({ ...value, ...(pendingSettings?.value || {}) });
      updateAccentContrast();
    },
    readingRequest() {
      const readingWidth = pendingSettings?.value?.readingWidth;
      return typeof readingWidth === 'number' && Number.isInteger(readingWidth)
        ? { value: readingWidth, revision: pendingSettings!.revision }
        : null;
    },
    readingAck(value) {
      if (
        value &&
        pendingSettings?.revision === value.revision &&
        pendingSettings.value.readingWidth === value.value
      ) {
        pendingSettings = null;
        saveState.dataset.state = 'saved';
        renderSaveState();
        window.__codexReadingWidth?.settle(value.value);
      }
    },
    readingState(value) {
      if (!pendingSettings && typeof value?.maxWidth === 'number' && Number.isInteger(value.maxWidth)) {
        settings.readingWidth = clampWidth(value.maxWidth);
        showWidth(settings.readingWidth);
      }
    },
    bindingRequest() {
      layout();
      const selected = chat();
      return selected && selected.raw.startsWith('local:client-new-thread:')
        ? { ...selected, generation }
        : null;
    },
    bind(value) {
      const selected = chat();
      if (!selected || value.raw !== selected.raw || value.title !== selected.title || value.generation !== generation) {
        return false;
      }
      resolved = { ...value, at: Date.now() };
      layout();
      return true;
    },
    snapshot() {
      const current = layout();
      return {
        id: current?.id || null,
        generation,
        locale: i18n.locale(),
        visible: host.isConnected && !host.hidden,
        compatibility,
        metricOrder: [...metricOrder],
        metricVisible: { ...metricVisible },
        preferences: {
          ...settings,
          metricOrder: [...metricOrder],
          metricVisible: { ...metricVisible },
        },
      };
    },
    render(value) {
      const current = layout();
      if (
        !current ||
        value.id !== current.id ||
        value.generation !== generation ||
        (value.locale && value.locale !== i18n.locale())
      ) {
        return false;
      }
      speedMode = value.speedMode === 'local' ? 'local' : 'magpie';
      metricValues = {
        ttft: String(value.ttft ?? '-s'),
        speed: String(value.speed ?? '- tok/s'),
        cache: String(value.cache ?? '-%'),
        age: String(value.age ?? t('waiting')),
      };
      updated = Date.now();
      localize();
      renderMetrics();
      return Boolean(layout()?.visible);
    },
    remove() {
      window.removeEventListener('better-codex-command-catalog', commandCatalogChanged);
      disposed = true;
      clearInterval(timer);
      observer.disconnect();
      geometryObserver.disconnect();
      foldSize.disconnect();
      window.removeEventListener('resize', layout);
      window.removeEventListener('languagechange', layout);
      window.removeEventListener('blur', closeOnBlur);
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('keyup', escape, true);
      host.remove();
      delete window.__codexComposerHud;
    },
  };

  layout();
  return true;
}

installComposerHud();
