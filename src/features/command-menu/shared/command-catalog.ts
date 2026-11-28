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

export const COMMAND_GROUPS: readonly (readonly [string, readonly string[]])[] = [
  ['chat', ['new', 'rename', 'ai-rename', 'archive']],
  ['context', ['side', 'fork', 'compact']],
  ['project', ['init', 'review-mode']],
  ['organize', ['pin', 'share', 'delete']],
  ['model', ['model', 'reasoning', 'service-tier:priority']],
  ['workflow', ['plan-mode', 'goal']],
  ['tools', ['mcp', 'ide-context']],
  ['creative', ['sketch', 'pet']],
  ['help', ['status', 'usage', 'feedback']],
  ['other', []],
];

const INITIAL_ENABLED = new Set([
  'new',
  'rename',
  'ai-rename',
  'archive',
  'side',
  'fork',
  'compact',
  'init',
  'review-mode',
]);

const SHORTENED_LABELS = new Set(['pin', 'share', 'delete', 'mcp', 'usage']);

export const PRESET_SKILLS: Record<string, string> = {
  'create-statusline': 'Create Statusline',
  'excel-live-control': 'Excel Live Control',
  health: 'Health',
  spreadsheets: 'Spreadsheets',
  visualize: 'Visualize',
};

export const SKILL_ALIASES: Record<string, string> = {
  'health:health': 'health',
  'spreadsheets:excel-live-control': 'excel-live-control',
  'spreadsheets:spreadsheets': 'spreadsheets',
  'visualize:visualize': 'visualize',
};

export const COMMANDS: readonly CommandCatalogItem[] = COMMAND_GROUPS.flatMap(([group, ids]) =>
  ids.map((id) => ({
    id,
    group,
    label: `command.${id}`,
    shortLabel: `${SHORTENED_LABELS.has(id) ? 'commandShort.' : 'command.'}${id}`,
  })),
);

export const COMMAND_DEFAULTS: Record<string, boolean> = Object.fromEntries(
  COMMANDS.map((item) => [item.id, INITIAL_ENABLED.has(item.id)]),
);

export function isSkill(id: string): boolean {
  return id.startsWith('skill:');
}

export function skillKey(title: string, name?: string): string {
  const slug = (text: string) =>
    text
      .trim()
      .toLowerCase()
      .replace(/\s*:\s*/g, ':')
      .replace(/[\s_-]+/g, '-');
  const key = slug(title);
  const raw = name ? slug(name) : key;
  if (Object.hasOwn(SKILL_ALIASES, raw)) return SKILL_ALIASES[raw];
  if (Object.hasOwn(PRESET_SKILLS, raw)) return raw;
  return Object.hasOwn(SKILL_ALIASES, key) ? SKILL_ALIASES[key] : key;
}

export function normalizeSkillVisible(value?: unknown): Record<string, boolean> {
  const defaults = Object.fromEntries(Object.keys(PRESET_SKILLS).map((id) => [id, false]));
  const choices =
    value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
  return {
    ...defaults,
    ...Object.fromEntries(
      choices.filter(
        ([id, on]) => id.length > 0 && id.length < 1024 && typeof on === 'boolean',
      ),
    ),
  };
}

export function normalize(value?: unknown): Record<string, boolean> {
  const entries =
    value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
  return {
    ...COMMAND_DEFAULTS,
    ...Object.fromEntries(
      entries.filter(([id, on]) => id.length > 0 && id.length < 1024 && typeof on === 'boolean'),
    ),
  };
}

export function normalizeSectionOrder(value?: unknown): [string, string] {
  return Array.isArray(value) && value[0] === 'skills'
    ? ['skills', 'commands']
    : ['commands', 'skills'];
}

export function normalizeGroupOrder(value?: unknown): string[] {
  const saved = Array.isArray(value) ? (value as string[]) : [];
  const secondary = COMMAND_GROUPS.slice(3, -1).map(([id]) => id);
  const legacy = saved.includes('other') && !saved.some((id) => secondary.includes(id));
  return [
    ...new Set([
      ...saved
        .flatMap((id) => (id === 'other' && legacy ? [...secondary, id] : [id]))
        .filter((id) => COMMAND_GROUPS.some(([group]) => group === id)),
      ...COMMAND_GROUPS.map(([id]) => id),
    ]),
  ];
}

export function normalizeItemOrder(value?: unknown): Record<string, string[]> {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    COMMAND_GROUPS.map(([group, ids]) => {
      const saved = Array.isArray(record[group])
        ? (record[group] as unknown[])
        : Array.isArray(record.other)
          ? (record.other as unknown[])
          : [];
      const valid = saved.filter(
        (id): id is string =>
          typeof id === 'string' &&
          id.length > 0 &&
          id.length < 1024 &&
          !isSkill(id) &&
          (group === 'other' ? !COMMANDS.some((item) => item.id === id) : ids.includes(id)),
      );
      const ordered = valid.length ? [...valid] : [...ids];
      if (group === 'chat' && !ordered.includes('ai-rename') && ids.includes('ai-rename')) {
        const at = ordered.indexOf('rename');
        ordered.splice(at >= 0 ? at + 1 : 0, 0, 'ai-rename');
      }
      return [group, [...new Set([...ordered, ...ids])]];
    }),
  );
}

export function orderedGroups(
  groupOrder?: unknown,
  itemOrder?: unknown,
  extra: CommandCatalogItem[] = [],
): CommandCatalogGroup[] {
  const order = normalizeItemOrder(itemOrder);
  return normalizeGroupOrder(groupOrder).map((group) => ({
    id: group,
    items: [...COMMANDS, ...extra]
      .filter((item) => item.group === group && !isSkill(item.id))
      .sort((a, b) => {
        const rank = (id: string) =>
          order[group].includes(id)
            ? order[group].indexOf(id)
            : order[group].length + extra.findIndex((item) => item.id === id);
        return rank(a.id) - rank(b.id);
      }),
  }));
}

export const commandCatalog: CommandCatalogApi = {
  groups: COMMAND_GROUPS,
  commands: COMMANDS,
  defaults: COMMAND_DEFAULTS,
  normalize,
  isSkill,
  normalizeGroupOrder,
  normalizeItemOrder,
  orderedGroups,
  normalizeSkillVisible,
  normalizeSectionOrder,
};

export default commandCatalog;
