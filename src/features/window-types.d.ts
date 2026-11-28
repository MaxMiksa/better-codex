export interface BetterCodexI18n {
  locale(): string;
  t(key: string, values?: Record<string, string | number>): string;
}

export interface CommandCatalogItem {
  id: string;
  group: string;
  label?: string;
  shortLabel?: string;
  title?: string;
}

export interface CommandCatalogGroup {
  id: string;
  items: CommandCatalogItem[];
}

export interface CommandCatalogApi {
  groups: readonly (readonly [string, readonly string[]])[];
  commands: readonly CommandCatalogItem[];
  defaults: Record<string, boolean>;
  normalize(value?: unknown): Record<string, boolean>;
  isSkill(id: string): boolean;
  normalizeGroupOrder(value?: unknown): string[];
  normalizeItemOrder(value?: unknown): Record<string, string[]>;
  orderedGroups(
    groupOrder?: unknown,
    itemOrder?: unknown,
    extra?: CommandCatalogItem[],
  ): CommandCatalogGroup[];
  normalizeSkillVisible(value?: unknown): Record<string, boolean>;
  normalizeSectionOrder(value?: unknown): [string, string];
}

export interface ComposerHudApi {
  settingsOpen(): boolean;
  settingsRequest(): { value: Record<string, unknown>; revision: number } | null;
  settingsAck(value?: { revision: number } | null): void;
  settingsState(value: Record<string, unknown>): void;
  readingRequest(): { value: number; revision: number } | null;
  readingAck(value?: { revision: number; value: number } | null): void;
  readingState(value?: { maxWidth?: number } | null): void;
  bindingRequest(): { raw: string; title: string; generation: number } | null;
  bind(value: { raw: string; title: string; generation: number; id: string }): boolean;
  snapshot(): {
    id: string | null;
    generation: number;
    locale: string;
    visible: boolean;
    compatibility: Record<string, unknown>;
    metricOrder: string[];
    metricVisible: Record<string, boolean>;
    preferences: Record<string, unknown>;
  };
  render(value: {
    id: string;
    generation: number;
    locale?: string;
    speedMode?: string;
    ttft?: string;
    speed?: string;
    cache?: string;
    age?: string;
  }): boolean;
  remove(): void;
}

export interface ReadingWidthApi {
  update(value?: number | string): Record<string, unknown>;
  setAssistantFontSize(value: number | null): void;
  setChatTitleCentered(value: boolean): void;
  setTablesEnabled(value: boolean): Record<string, unknown>;
  setTableCentered(value: boolean): Record<string, unknown>;
  preview(value: number): Record<string, unknown>;
  settle(value: number): void;
  remove(): void;
}

export interface TableSortApi {
  setEnabled(value: boolean): Record<string, unknown>;
  setDefaultMode(value: string): Record<string, unknown>;
  snapshot(): Record<string, unknown>;
  remove(): void;
}

export interface FileChangesApi {
  snapshot(): { cards: number; expanded: number; defaultCollapsed: boolean };
  setDefaultCollapsed(value: boolean): { cards: number; expanded: number; defaultCollapsed: boolean };
  remove(): void;
}

export interface CustomAccentApi {
  update(value: Record<string, { accentSource?: string; accent?: string; surface?: string }>): Record<string, unknown>;
  snapshot(): Record<string, unknown>;
  remove(): void;
}

export interface CommandMenuApi {
  catalog: CommandCatalogApi;
  skillEntries(composer?: Element | null): { id: string; title: string }[];
  update(
    value?: unknown,
    order?: {
      enabled?: boolean;
      skillVisible?: unknown;
      groupOrder?: unknown;
      itemOrder?: unknown;
    },
  ): void;
  entries(): { id: string; title: string; group: string }[];
  promptRequests(): string[];
  promptState(payload: { requests: string[]; entries: { name: string; body: string }[] }): void;
  remove(): void;
}

export interface ComposerFoldApi {
  update(value?: string, afterSend?: boolean): void;
  hides(root: Element): boolean;
  remove(): void;
}

export interface AiRenameApi {
  request(): boolean;
  pull(id?: string): Record<string, unknown> | null;
  state(value?: Record<string, unknown>): void;
  available(): boolean;
  remove(): void;
  snapshot(): { busy: boolean; visible: boolean; text: string | null };
}

export interface WorkspaceTreeApi {
  pullAction(id: string): Record<string, unknown> | null;
  confirmAction(id: string): boolean;
  confirmPreview(id: string): boolean;
  actionResult(id: string, status: string): void;
  setEnabled(value: boolean): void;
  remove(): void;
}

declare global {
  interface Window {
    __codexHudI18n?: BetterCodexI18n;
    __codexComposerHud?: ComposerHudApi;
    __codexReadingWidth?: ReadingWidthApi;
    __codexTableSort?: TableSortApi;
    __codexFileChanges?: FileChangesApi;
    __codexCustomAccent?: CustomAccentApi;
    __codexCommandMenu?: CommandMenuApi;
    __codexComposerFold?: ComposerFoldApi;
    __codexAiRename?: AiRenameApi;
    __codexWorkspaceTree?: WorkspaceTreeApi;
    __betterCodexRequestPrompts?: (request: string) => void;
    __betterCodexRequestAiRename?: (requestId: string) => void;
    __betterCodexWorkspaceAction?: (actionId: string) => void;
    electronBridge?: {
      sendMessageFromView(payload: unknown): unknown;
    };
  }

  const bcTreeRoots: { home?: string; codexHome?: string };
  const bcTreeRenderer: {
    FileTree: new (options: Record<string, unknown>) => {
      render(target: { containerWrapper: Element }): void;
      subscribe(callback: () => void): () => void;
      batch(fn: (store: { remove(path: string, opts?: { recursive?: boolean }): void; add(path: string): void }) => void): void;
      setSearch(value: string | null): void;
      getSearchMatchingPaths(): string[];
      getVisibleCount(): number;
      getVisibleRows(start: number, count: number): { kind: string; isExpanded?: boolean; path: string }[];
      getItem(path: string): { isDirectory(): boolean; getPath(): string } | null;
      getFocusedItem(): { getPath(): string } | null;
      cleanUp(): void;
    };
  };
  function allowedRoot(value: unknown, roots: { home?: string; codexHome?: string }): string | null;
  function windowsName(value: unknown): boolean;
}
