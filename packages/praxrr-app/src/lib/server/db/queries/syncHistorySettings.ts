import { db } from '../db.ts';

/**
 * Types for the sync_history_settings table (singleton, id = 1). Drives retention
 * (age + max entries) and a global enable flag for recording + the daily
 * `sync.history.cleanup` job.
 */
export interface SyncHistorySettings {
  id: number;
  enabled: number;
  retention_days: number;
  retention_max_entries: number;
  created_at: string;
  updated_at: string;
}

export interface UpdateSyncHistorySettingsInput {
  enabled?: boolean;
  retentionDays?: number;
  retentionMaxEntries?: number;
}

/**
 * All queries for sync_history_settings.
 * Singleton pattern — exactly one settings record (id = 1) exists (seeded by
 * migration). `get()` self-heals if the seed row is somehow absent so callers
 * never receive undefined.
 */
export const syncHistorySettingsQueries = {
  get(): SyncHistorySettings {
    let row = db.queryFirst<SyncHistorySettings>('SELECT * FROM sync_history_settings WHERE id = 1');
    if (!row) {
      db.execute('INSERT OR IGNORE INTO sync_history_settings (id) VALUES (1)');
      row = db.queryFirst<SyncHistorySettings>('SELECT * FROM sync_history_settings WHERE id = 1');
    }
    if (!row) {
      throw new Error('sync_history_settings singleton row is missing');
    }
    return row;
  },

  update(input: UpdateSyncHistorySettingsInput): boolean {
    const updates: string[] = [];
    const params: (string | number)[] = [];

    if (input.enabled !== undefined) {
      updates.push('enabled = ?');
      params.push(input.enabled ? 1 : 0);
    }
    if (input.retentionDays !== undefined) {
      updates.push('retention_days = ?');
      params.push(input.retentionDays);
    }
    if (input.retentionMaxEntries !== undefined) {
      updates.push('retention_max_entries = ?');
      params.push(input.retentionMaxEntries);
    }

    if (updates.length === 0) {
      return false;
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    const affected = db.execute(`UPDATE sync_history_settings SET ${updates.join(', ')} WHERE id = 1`, ...params);
    return affected > 0;
  },

  /** Restore defaults (used by tests / admin reset). */
  reset(): boolean {
    const affected = db.execute(
      `UPDATE sync_history_settings
			 SET enabled = 1, retention_days = 90, retention_max_entries = 10000, updated_at = CURRENT_TIMESTAMP
			 WHERE id = 1`
    );
    return affected > 0;
  },
};
