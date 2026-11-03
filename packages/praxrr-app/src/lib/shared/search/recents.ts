/**
 * Shared contract and validation for command palette recents.
 *
 * Used by `PUT /api/v1/ui-preferences/command-palette-recents` (strict validation) and by the
 * client palette when reading the server response or its `localStorage` fallback (lenient
 * sanitizing). Mirrors `docs/api/v1/schemas/search.yaml#/CommandPaletteRecent`.
 */

export interface CommandPaletteRecent {
  key: string;
  label: string;
  href: string;
  kind: string;
  /** ISO 8601 timestamp of the last use. */
  usedAt: string;
}

export interface CommandPaletteRecentsResponse {
  recents: CommandPaletteRecent[];
}

/** Maximum number of recents stored per user. */
export const COMMAND_PALETTE_RECENTS_MAX = 10;

/** Per-field maximum lengths. */
export const COMMAND_PALETTE_RECENT_LIMITS = {
  key: 200,
  label: 200,
  href: 500,
  kind: 40,
} as const;

/** `localStorage` key used when the recents API is unavailable (401: bypass or API-token sessions). */
export const COMMAND_PALETTE_RECENTS_STORAGE_KEY = 'praxrr:command-palette:recents';

export type CommandPaletteRecentsValidation =
  { ok: true; recents: CommandPaletteRecent[] } | { ok: false; error: string };

// eslint-disable-next-line no-control-regex -- intentionally matches C0/C1 control characters
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * True when `href` is a same-origin relative path: starts with a single `/`, never `//`, and
 * contains no backslash or control characters (which browsers may normalize into another origin).
 * No length cap: navigation and search results may use long hrefs.
 */
export function isSafeRelativeHref(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//') && !href.includes('\\') && !CONTROL_CHARS.test(href);
}

/** True when `href` is safe and fits the stored-recent limit ({@link COMMAND_PALETTE_RECENT_LIMITS}). */
export function isStorableRecentHref(href: string): boolean {
  return href.length <= COMMAND_PALETTE_RECENT_LIMITS.href && isSafeRelativeHref(href);
}

/** Read a bounded, control-character-free, non-empty text field; returns the value or an error. */
function readText(value: unknown, field: string, max: number): string | { error: string } {
  if (typeof value !== 'string' || value.length === 0) {
    return { error: `${field} must be a non-empty string` };
  }
  if (value.length > max) {
    return { error: `${field} must be at most ${max} characters` };
  }
  if (CONTROL_CHARS.test(value)) {
    return { error: `${field} must not contain control characters` };
  }
  return value;
}

function validateEntry(value: unknown, index: number): CommandPaletteRecent | string {
  const prefix = `recents[${index}]`;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return `${prefix} must be an object`;
  }
  // Own enumerable properties only; the copy has an index signature so fields read as `unknown`.
  const entry: Readonly<Record<string, unknown>> = { ...value };

  const key = readText(entry.key, `${prefix}.key`, COMMAND_PALETTE_RECENT_LIMITS.key);
  if (typeof key !== 'string') return key.error;
  const label = readText(entry.label, `${prefix}.label`, COMMAND_PALETTE_RECENT_LIMITS.label);
  if (typeof label !== 'string') return label.error;
  const kind = readText(entry.kind, `${prefix}.kind`, COMMAND_PALETTE_RECENT_LIMITS.kind);
  if (typeof kind !== 'string') return kind.error;

  const { href, usedAt } = entry;
  if (typeof href !== 'string' || !isStorableRecentHref(href)) {
    return `${prefix}.href must be a relative path starting with "/" (max ${COMMAND_PALETTE_RECENT_LIMITS.href} characters)`;
  }
  if (typeof usedAt !== 'string' || !ISO_TIMESTAMP.test(usedAt) || Number.isNaN(Date.parse(usedAt))) {
    return `${prefix}.usedAt must be an ISO 8601 timestamp`;
  }

  return { key, label, href, kind, usedAt };
}

/**
 * Strict validation of a recents array (the `recents` field of the PUT body). Rejects the whole
 * payload on the first invalid entry, more than {@link COMMAND_PALETTE_RECENTS_MAX} entries, or a
 * duplicate `key`. Unknown entry fields are dropped.
 */
export function validateCommandPaletteRecents(value: unknown): CommandPaletteRecentsValidation {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'recents must be an array' };
  }
  if (value.length > COMMAND_PALETTE_RECENTS_MAX) {
    return { ok: false, error: `recents must contain at most ${COMMAND_PALETTE_RECENTS_MAX} entries` };
  }

  const recents: CommandPaletteRecent[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index++) {
    const result = validateEntry(value[index], index);
    if (typeof result === 'string') {
      return { ok: false, error: result };
    }
    if (seen.has(result.key)) {
      return { ok: false, error: `recents[${index}].key duplicates an earlier entry` };
    }
    seen.add(result.key);
    recents.push(result);
  }

  return { ok: true, recents };
}

/**
 * Lenient read-side sanitizing for untrusted stored data (database row, `localStorage`). Drops
 * invalid entries, keeps the first occurrence of each `key`, and truncates to
 * {@link COMMAND_PALETTE_RECENTS_MAX}. Never throws; non-arrays yield `[]`.
 */
export function sanitizeCommandPaletteRecents(value: unknown): CommandPaletteRecent[] {
  if (!Array.isArray(value)) return [];

  const recents: CommandPaletteRecent[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length && recents.length < COMMAND_PALETTE_RECENTS_MAX; index++) {
    const result = validateEntry(value[index], index);
    if (typeof result === 'string' || seen.has(result.key)) continue;
    seen.add(result.key);
    recents.push(result);
  }
  return recents;
}
