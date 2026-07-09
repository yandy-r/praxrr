/**
 * Timestamp normalization for the timeline (issue #27).
 *
 * Event sort keys (strftime) and annotation bookkeeping columns (CURRENT_TIMESTAMP) are stored in
 * SQLite space-form UTC (`YYYY-MM-DD HH:MM:SS[.SSS]`, no `T`/`Z`). `new Date(...)` parses that form
 * as LOCAL time in V8 (or Invalid Date in strict engines), so every timestamp the API returns must
 * be converted to unambiguous ISO-8601 UTC first. Kept in its own module so both the feed response
 * mapper and the annotation query module can share it without an import cycle.
 */
export function sqliteUtcToIso(ts: string): string {
  if (ts.includes('T')) {
    return ts.endsWith('Z') ? ts : `${ts}Z`;
  }
  return `${ts.replace(' ', 'T')}Z`;
}
