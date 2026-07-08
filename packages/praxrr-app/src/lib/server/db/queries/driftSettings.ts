import { db } from '../db.ts';

/**
 * Types for the drift_check_settings table (singleton, id = 1).
 */
export interface DriftCheckSettings {
  id: number;
  enabled: number;
  interval_minutes: number;
  last_run_at: string | null;
  error_count: number;
  backoff_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpdateDriftSettingsInput {
  enabled?: boolean;
  intervalMinutes?: number;
}

/**
 * All queries for drift_check_settings.
 * Singleton pattern — exactly one settings record (id = 1) exists (seeded by migration).
 */
export const driftSettingsQueries = {
  /**
   * Get the drift check settings (singleton). Self-heals if the seed row is somehow absent
   * so callers never receive undefined.
   */
  get(): DriftCheckSettings {
    let row = db.queryFirst<DriftCheckSettings>('SELECT * FROM drift_check_settings WHERE id = 1');
    if (!row) {
      db.execute('INSERT OR IGNORE INTO drift_check_settings (id) VALUES (1)');
      row = db.queryFirst<DriftCheckSettings>('SELECT * FROM drift_check_settings WHERE id = 1');
    }
    if (!row) {
      throw new Error('drift_check_settings singleton row is missing');
    }
    return row;
  },

  /**
   * Update drift settings (enabled / interval).
   */
  update(input: UpdateDriftSettingsInput): boolean {
    const updates: string[] = [];
    const params: (string | number)[] = [];

    if (input.enabled !== undefined) {
      updates.push('enabled = ?');
      params.push(input.enabled ? 1 : 0);
    }
    if (input.intervalMinutes !== undefined) {
      updates.push('interval_minutes = ?');
      params.push(input.intervalMinutes);
    }

    if (updates.length === 0) {
      return false;
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    const affected = db.execute(`UPDATE drift_check_settings SET ${updates.join(', ')} WHERE id = 1`, ...params);
    return affected > 0;
  },

  /**
   * Record a completed sweep: advance last_run_at and clear backoff state.
   */
  markRun(lastRunAt: string): boolean {
    const affected = db.execute(
      `UPDATE drift_check_settings
			 SET last_run_at = ?, error_count = 0, backoff_until = NULL, updated_at = CURRENT_TIMESTAMP
			 WHERE id = 1`,
      lastRunAt
    );
    return affected > 0;
  },

  /**
   * Record a failed sweep: persist the incremented backoff exponent and next-eligible gate.
   */
  markFailure(errorCount: number, backoffUntil: string): boolean {
    const affected = db.execute(
      `UPDATE drift_check_settings
			 SET error_count = ?, backoff_until = ?, updated_at = CURRENT_TIMESTAMP
			 WHERE id = 1`,
      errorCount,
      backoffUntil
    );
    return affected > 0;
  },
};
