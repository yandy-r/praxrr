/**
 * Shared query-param parsing for the sync-history list + export routes, so their
 * filter handling can never diverge.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * Parse and normalize a `from`/`to` date bound to a strict ISO-8601 UTC string
 * that SQLite `datetime(...)` can always parse.
 *
 * - Rejects loose formats `Date.parse` would accept but SQLite would not (e.g.
 *   `2026-07`, `2026`, `07/09/2026`) with a thrown `Error` (caller → 400) — the
 *   previous `Date.parse`-only guard let those through and silently emptied the
 *   audit view because `datetime('2026-07')` returns NULL.
 * - Expands a date-only value to a full-day bound so the selected day is inclusive:
 *   `lower` → start-of-day, `upper` → end-of-day. A bare `to=2026-07-09` therefore
 *   includes every run recorded that day.
 *
 * Returns `undefined` for a null/empty value (no bound).
 */
export function parseDateBound(raw: string | null, name: string, bound: 'lower' | 'upper'): string | undefined {
  if (raw === null) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  if (DATE_ONLY.test(trimmed)) {
    return bound === 'upper' ? `${trimmed}T23:59:59.999Z` : `${trimmed}T00:00:00.000Z`;
  }

  if (ISO_DATETIME.test(trimmed)) {
    const ms = Date.parse(trimmed);
    if (Number.isNaN(ms)) {
      throw new Error(`Invalid ${name}`);
    }
    return new Date(ms).toISOString();
  }

  throw new Error(`Invalid ${name}`);
}
