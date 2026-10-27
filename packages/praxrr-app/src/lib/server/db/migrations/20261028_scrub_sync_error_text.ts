import type { Migration } from '../migrations.ts';
import { db } from '../db.ts';
import { GENERIC_SYNC_ERROR_TEXT, sanitizeSectionResult, toSafeSyncErrorText } from '$sync/syncHistoryFailure.ts';
import type { SyncSectionResult } from '$sync/syncHistory/types.ts';

/**
 * Migration 20261028: Scrub persisted sync error text.
 *
 * Legacy rows can embed raw Arr response detail (URLs, credentials, response bodies) in
 * free-text error columns. Rewrite every persisted value through the closed-vocabulary
 * sanitizer so only safe reasons and static writer labels survive. This is an app-DB data
 * migration only: no PCD ops are involved, so `seedBuiltInBaseOps.ts` is intentionally
 * untouched.
 *
 * `up` is a no-op statement because the schema is unchanged; the runner commits `up` before
 * `afterUp`. Only rows whose sanitized value differs are updated, so the scrub is idempotent
 * and safe rows keep their stored bytes. Malformed or non-array `section_results` JSON is
 * left untouched rather than crashing the migration or destroying the rest of the row.
 * `down` cannot restore the removed raw detail, so it is a no-op.
 */
export const migration: Migration = {
  version: 20261028,
  name: 'Scrub persisted sync error text',

  up: `SELECT 1;`,

  down: `SELECT 1;`,

  afterUp: () => scrubPersistedSyncErrorText(),
};

interface LastErrorTable {
  table: string;
  keyColumns: readonly string[];
}

/** Single-`last_error` config tables keyed by `instance_id` (plus `source_id` for TRaSH). */
const LAST_ERROR_TABLES: readonly LastErrorTable[] = [
  { table: 'arr_sync_quality_profiles_config', keyColumns: ['instance_id'] },
  { table: 'arr_sync_delay_profiles_config', keyColumns: ['instance_id'] },
  { table: 'arr_sync_media_management', keyColumns: ['instance_id'] },
  { table: 'arr_sync_metadata_profiles_config', keyColumns: ['instance_id'] },
  { table: 'trash_guide_sync_config', keyColumns: ['instance_id', 'source_id'] },
];

function safeErrorText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? toSafeSyncErrorText(value) : GENERIC_SYNC_ERROR_TEXT;
}

/**
 * Sanitize one parsed `section_results` array. Returns the rewritten array only when an
 * element's error text actually changed; returns null for malformed, non-array, or already
 * safe payloads so the caller leaves the stored bytes untouched.
 */
function scrubSectionResults(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  let changed = false;
  const scrubbed = parsed.map((element) => {
    if (element === null || typeof element !== 'object' || Array.isArray(element)) return element;
    const record = element as Record<string, unknown>;
    if (!('error' in record)) return element;
    const originalError = record.error;
    if (originalError !== null && originalError !== undefined && typeof originalError !== 'string') {
      changed = true;
      return sanitizeSectionResult({ ...record, error: GENERIC_SYNC_ERROR_TEXT } as unknown as SyncSectionResult);
    }
    const safeError = toSafeSyncErrorText(originalError as string | null | undefined);
    if (safeError === originalError) return element;
    changed = true;
    return sanitizeSectionResult(record as unknown as SyncSectionResult);
  });

  return changed ? JSON.stringify(scrubbed) : null;
}

/** Rewrite unsafe persisted sync error text in place. Safe to run repeatedly. */
export async function scrubPersistedSyncErrorText(): Promise<void> {
  await db.transaction(() => {
    const historyRows = db.query<{ id: number; error: string | null; section_results: string }>(
      'SELECT id, error, section_results FROM sync_history'
    );
    for (const row of historyRows) {
      const safeError = safeErrorText(row.error);
      const scrubbedSections = scrubSectionResults(row.section_results);
      if (safeError !== row.error && scrubbedSections !== null) {
        db.execute(
          'UPDATE sync_history SET error = ?, section_results = ? WHERE id = ?',
          safeError,
          scrubbedSections,
          row.id
        );
      } else if (safeError !== row.error) {
        db.execute('UPDATE sync_history SET error = ? WHERE id = ?', safeError, row.id);
      } else if (scrubbedSections !== null) {
        db.execute('UPDATE sync_history SET section_results = ? WHERE id = ?', scrubbedSections, row.id);
      }
    }

    for (const { table, keyColumns } of LAST_ERROR_TABLES) {
      const keyList = keyColumns.join(', ');
      const rows = db.query<Record<string, number> & { last_error: string | null }>(
        `SELECT ${keyList}, last_error FROM ${table}`
      );
      const where = keyColumns.map((column) => `${column} = ?`).join(' AND ');
      for (const row of rows) {
        const originalError = row.last_error;
        const safeError = safeErrorText(originalError);
        if (safeError === originalError) continue;
        db.execute(
          `UPDATE ${table} SET last_error = ? WHERE ${where}`,
          safeError,
          ...keyColumns.map((column) => row[column])
        );
      }
    }
  });
}
