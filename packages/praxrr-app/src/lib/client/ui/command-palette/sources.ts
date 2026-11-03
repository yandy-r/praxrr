/**
 * Pure item sources for the global command palette: nav flattening, actions, query matching and
 * grouping. Kept free of Svelte/DOM imports so it can be unit tested under Deno.
 */
import { supportsFeature, type ArrFeature } from '$shared/arr/capabilities.ts';
import type { ArrType } from '$shared/pcd/types.ts';
import type { NavShell, ResolvedNavItem } from '$shared/navigation/types.ts';
import { isSafeRelativeHref, type CommandPaletteRecent } from '$shared/search/recents.ts';
import {
  SEARCH_RESULT_TYPES,
  isSearchResultType,
  type SearchResult,
  type SearchResultSource,
  type SearchResultType,
} from '$shared/search/types.ts';

export type PaletteGroupId = 'recent' | 'nav' | 'action' | SearchResultType;

export interface PaletteItem {
  /** Stable key; also the recents key. */
  key: string;
  label: string;
  href: string;
  /** Recorded as the recent's `kind`: `nav`, `action`, or a search result type. */
  kind: string;
  group: PaletteGroupId;
  /** Secondary text, e.g. the parent nav item of a child page. */
  description?: string;
  source?: SearchResultSource | null;
  /** Arr type of an Arr instance result. */
  arrType?: 'radarr' | 'sonarr' | 'lidarr';
}

export interface PaletteGroup {
  id: PaletteGroupId;
  label: string;
  items: PaletteItem[];
}

export const PALETTE_GROUP_ORDER: readonly PaletteGroupId[] = ['recent', 'nav', 'action', ...SEARCH_RESULT_TYPES];

export const PALETTE_GROUP_LABELS: Record<PaletteGroupId, string> = {
  recent: 'Recent',
  nav: 'Pages',
  action: 'Actions',
  custom_format: 'Custom formats',
  quality_profile: 'Quality profiles',
  regular_expression: 'Regular expressions',
  delay_profile: 'Delay profiles',
  metadata_profile: 'Metadata profiles',
  arr_instance: 'Arr instances',
  database: 'Databases',
};

const RECENT_KIND_LABELS: Readonly<Record<string, string>> = {
  nav: 'Page',
  action: 'Action',
  custom_format: 'Custom format',
  quality_profile: 'Quality profile',
  regular_expression: 'Regular expression',
  delay_profile: 'Delay profile',
  metadata_profile: 'Metadata profile',
  arr_instance: 'Arr instance',
  database: 'Database',
};

/** Secondary label shown next to a recent, e.g. `Custom format`; `null` for unknown kinds. */
export function recentKindLabel(kind: string): string | null {
  return Object.hasOwn(RECENT_KIND_LABELS, kind) ? RECENT_KIND_LABELS[kind] : null;
}

const LOGOUT_HREF = '/auth/logout';

type ScopeAwareNavItem = ResolvedNavItem & { requiredFeature?: ArrFeature };

/** Mirrors pageNav's `isScopedItemVisible`: hide items whose feature the scoped Arr lacks. */
export function isScopedNavItemVisible(item: ScopeAwareNavItem, scope: ArrType): boolean {
  if (scope === 'all' || !item.requiredFeature) return true;
  return supportsFeature(scope, item.requiredFeature);
}

/**
 * Flattens nav groups (items and their children) into palette items. Skips Log Out, items hidden
 * by the current Arr scope (including their children) and duplicate hrefs.
 */
export function flattenNavItems(navShell: NavShell | null | undefined, scope: ArrType): PaletteItem[] {
  const items: PaletteItem[] = [];
  const seen = new Set<string>();

  const push = (label: string, href: string, description?: string) => {
    if (href === LOGOUT_HREF || seen.has(href) || !isSafeRelativeHref(href)) return;
    seen.add(href);
    items.push({ key: `nav:${href}`, label, href, kind: 'nav', group: 'nav', description });
  };

  for (const group of navShell?.groups ?? []) {
    for (const item of group.items as ScopeAwareNavItem[]) {
      if (!isScopedNavItemVisible(item, scope)) continue;
      push(item.label, item.href, group.label);
      for (const child of item.children ?? []) {
        push(child.label, child.href, item.label);
      }
    }
  }

  return items;
}

/** Case-insensitive match: every whitespace-separated query token appears in the text. */
export function matchesQuery(text: string, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = text.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function itemMatches(item: PaletteItem, query: string): boolean {
  return matchesQuery(item.description ? `${item.label} ${item.description}` : item.label, query);
}

/** Static actions; each also matches on its keywords. */
const STATIC_ACTIONS: ReadonlyArray<PaletteItem & { keywords: string }> = [
  {
    key: 'action:new-custom-format',
    label: 'New custom format',
    href: '/custom-formats',
    kind: 'action',
    group: 'action',
    keywords: 'create add cf',
  },
  {
    key: 'action:score-simulator',
    label: 'Open score simulator',
    href: '/score-simulator',
    kind: 'action',
    group: 'action',
    keywords: 'test release scoring',
  },
];

/**
 * `/custom-formats` redirects to the first database; when the current page already names a
 * database (`/<entity>/<id>/...`), go straight to its new-format route.
 */
export function resolveNewCustomFormatHref(pathname: string): string {
  const match =
    /^\/(?:custom-formats|quality-profiles|regular-expressions|delay-profiles|score-simulator)\/(\d+)(?:\/|$)/.exec(
      pathname
    );
  return match ? `/custom-formats/${match[1]}/new` : '/custom-formats';
}

/** "Sync instance X" actions derived from Arr instance search results (`/arr/{id}` → `/arr/{id}/sync`). */
export function buildSyncActions(results: readonly SearchResult[]): PaletteItem[] {
  const actions: PaletteItem[] = [];
  for (const result of results) {
    if (result.type !== 'arr_instance') continue;
    const match = /^\/arr\/(\d+)$/.exec(result.href);
    if (!match) continue;
    actions.push({
      key: `action:sync:${match[1]}`,
      label: `Sync instance ${result.name}`,
      href: `/arr/${match[1]}/sync`,
      kind: 'action',
      group: 'action',
    });
  }
  return actions;
}

/** Static actions with context-aware hrefs resolved for `pathname`. */
function resolveStaticActions(pathname: string): Array<PaletteItem & { keywords: string }> {
  return STATIC_ACTIONS.map((action) =>
    action.key === 'action:new-custom-format' ? { ...action, href: resolveNewCustomFormatHref(pathname) } : action
  );
}

export function buildActions(query: string, results: readonly SearchResult[], pathname = ''): PaletteItem[] {
  const statics = resolveStaticActions(pathname)
    .filter((action) => matchesQuery(`${action.label} ${action.keywords}`, query))
    .map(({ keywords: _keywords, ...action }) => action);
  // Arr instance results already match the query server-side.
  return [...statics, ...buildSyncActions(results)];
}

/**
 * A recent action stores the href it had when used; static actions are context-aware, so a recent
 * of one re-resolves to the current page's href. Other recents keep their stored href.
 */
export function resolveRecentHref(recent: CommandPaletteRecent, pathname = ''): string {
  if (!recent.key.startsWith('action:')) return recent.href;
  return resolveStaticActions(pathname).find((action) => action.key === recent.key)?.href ?? recent.href;
}

/**
 * Entity results belong to the query they were fetched for. Only show them while that query is
 * still the current trimmed query; otherwise they are stale (a newer search is pending).
 */
export function currentResults(
  results: readonly SearchResult[],
  resultsQuery: string | null,
  query: string
): readonly SearchResult[] {
  const trimmed = query.trim();
  return trimmed && resultsQuery === trimmed ? results : [];
}

/**
 * Returns a function mapping an item key to a DOM id that stays the same for that key across
 * renders (keys may contain characters that are invalid or ambiguous in ids).
 */
export function createOptionIdMap(prefix: string): (key: string) => string {
  const ids = new Map<string, string>();
  return (key) => {
    let id = ids.get(key);
    if (id === undefined) {
      id = `${prefix}-option-${ids.size}`;
      ids.set(key, id);
    }
    return id;
  };
}

/** Apple platforms use Cmd (Meta) for the palette shortcut; everything else uses Ctrl. */
export function isApplePlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

/** True for the palette toggle: Cmd+K on Apple platforms, Ctrl+K elsewhere, with no Shift/Alt. */
export function isPaletteShortcut(event: ShortcutEvent, apple: boolean): boolean {
  if (event.shiftKey || event.altKey) return false;
  if (apple ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return false;
  return event.code === 'KeyK' || event.key.toLowerCase() === 'k';
}

function parseSource(value: unknown): SearchResultSource | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'object' || !('type' in value) || !('id' in value) || !('name' in value)) return undefined;
  const { type, id, name } = value;
  if ((type !== 'pcd' && type !== 'trash') || typeof id !== 'number' || typeof name !== 'string') return undefined;
  const source: SearchResultSource = { type, id, name };
  const arrType = 'arrType' in value ? value.arrType : undefined;
  if (arrType === 'radarr' || arrType === 'sonarr') source.arrType = arrType;
  return source;
}

/** Validates a `GET /api/v1/search` body, keeping only well-formed results with a safe href. */
export function parseSearchResults(body: unknown): SearchResult[] {
  if (typeof body !== 'object' || body === null || !('results' in body) || !Array.isArray(body.results)) return [];
  const results: SearchResult[] = [];
  for (const entry of body.results as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    if (!('type' in entry) || !('id' in entry) || !('name' in entry) || !('href' in entry) || !('source' in entry)) {
      continue;
    }
    const { type, id, name, href } = entry;
    if (typeof type !== 'string' || !isSearchResultType(type)) continue;
    if (typeof id !== 'string' || typeof name !== 'string' || typeof href !== 'string') continue;
    if (!isSafeRelativeHref(href)) continue;
    const source = parseSource(entry.source);
    if (source === undefined) continue;
    const result: SearchResult = { type, id, name, href, source };
    const arrType = 'arrType' in entry ? entry.arrType : undefined;
    if (arrType === 'radarr' || arrType === 'sonarr' || arrType === 'lidarr') result.arrType = arrType;
    results.push(result);
  }
  return results;
}

export function searchResultToItem(result: SearchResult): PaletteItem | null {
  if (!isSafeRelativeHref(result.href)) return null;
  return {
    key: result.id,
    label: result.name,
    href: result.href,
    kind: result.type,
    group: result.type,
    source: result.source,
    arrType: result.type === 'arr_instance' ? result.arrType : undefined,
  };
}

export function recentToItem(recent: CommandPaletteRecent, pathname = ''): PaletteItem {
  return {
    key: recent.key,
    label: recent.label,
    href: resolveRecentHref(recent, pathname),
    kind: recent.kind,
    group: 'recent',
  };
}

export interface PaletteGroupInput {
  query: string;
  recents: readonly CommandPaletteRecent[];
  navItems: readonly PaletteItem[];
  /** Entity results already known to belong to `query` (see {@link currentResults}). */
  results: readonly SearchResult[];
  pathname?: string;
}

/**
 * Builds the ordered, non-empty groups: Recent, Pages, Actions, then entity types in
 * {@link SEARCH_RESULT_TYPES} order. An empty query shows recents, pages and static actions.
 * Items already shown as a recent are not repeated in later groups.
 */
export function buildPaletteGroups(input: PaletteGroupInput): PaletteGroup[] {
  const query = input.query.trim();
  const byGroup = new Map<PaletteGroupId, PaletteItem[]>();
  const shown = new Set<string>();

  const add = (item: PaletteItem) => {
    if (shown.has(item.key)) return;
    shown.add(item.key);
    const list = byGroup.get(item.group) ?? [];
    list.push(item);
    byGroup.set(item.group, list);
  };

  for (const recent of input.recents) {
    const item = recentToItem(recent, input.pathname);
    if (!isSafeRelativeHref(item.href)) continue;
    if (itemMatches(item, query)) add(item);
  }

  for (const item of input.navItems) {
    if (itemMatches(item, query)) add(item);
  }

  const results = query ? input.results : [];
  for (const item of buildActions(query, results, input.pathname)) add(item);

  for (const result of results) {
    const item = searchResultToItem(result);
    if (item) add(item);
  }

  return PALETTE_GROUP_ORDER.filter((id) => byGroup.has(id)).map((id) => ({
    id,
    label: PALETTE_GROUP_LABELS[id],
    items: byGroup.get(id) ?? [],
  }));
}

/** True for inputs, textareas, selects and contenteditable hosts, where `/` must type normally. */
export function isEditableTarget(target: EventTarget | null): boolean {
  // Structural checks (not `instanceof HTMLElement`) keep this testable outside a DOM.
  if (!target || typeof target !== 'object') return false;
  if ('isContentEditable' in target && target.isContentEditable === true) return true;
  const tag = 'tagName' in target && typeof target.tagName === 'string' ? target.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
