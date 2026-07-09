import { db } from '../db.ts';
import { CRITERION_IDS, DEFAULT_CRITERIA, type CriterionConfig, type CriterionId } from '$shared/health/index.ts';

/**
 * Raw row shape for config_health_settings (singleton, id = 1). `criteria` is a JSON string on disk.
 */
export interface ConfigHealthSettingsRow {
  id: number;
  enabled: number;
  interval_minutes: number;
  retention_days: number;
  retention_max_entries: number;
  criteria: string;
  last_run_at: string | null;
  error_count: number;
  backoff_until: string | null;
  sweep_cursor: number;
  sweep_started_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Parsed settings: identical to the row except `criteria` is decoded, validated, and normalized
 * against the canonical criterion set (unknown ids dropped, missing ids filled from defaults).
 */
export interface ConfigHealthSettings extends Omit<ConfigHealthSettingsRow, 'criteria'> {
  criteria: CriterionConfig[];
}

export interface UpdateConfigHealthSettingsInput {
  enabled?: boolean;
  intervalMinutes?: number;
  retentionDays?: number;
  retentionMaxEntries?: number;
  criteria?: CriterionConfig[];
}

const VALID_IDS = new Set<CriterionId>(CRITERION_IDS);

/** Upper bound on a criterion weight — keeps the engine's weighted rollup finite (no Infinity/NaN). */
const MAX_CRITERION_WEIGHT = 1000;

/**
 * Decode + normalize the stored criteria JSON. Merges valid stored entries over
 * {@link DEFAULT_CRITERIA} so the set is always complete and ordered by {@link CRITERION_IDS} — a
 * criterion added in a newer engine version still gets a sane default even against older stored JSON,
 * and malformed/unknown entries are dropped rather than trusted.
 */
export function normalizeCriteria(raw: string): CriterionConfig[] {
  const byId = new Map<CriterionId, CriterionConfig>(DEFAULT_CRITERIA.map((c) => [c.id, { ...c }]));
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const candidate = entry as Record<string, unknown>;
      const id = candidate.id;
      if (typeof id !== 'string' || !VALID_IDS.has(id as CriterionId)) continue;
      const rawWeight = candidate.weight;
      // Clamp to a finite [0, MAX] range so a hostile/huge weight can never yield Infinity/NaN scores.
      const weight =
        typeof rawWeight === 'number' && Number.isFinite(rawWeight) && rawWeight >= 0
          ? Math.min(rawWeight, MAX_CRITERION_WEIGHT)
          : 0;
      byId.set(id as CriterionId, {
        id: id as CriterionId,
        enabled: candidate.enabled === true,
        weight,
      });
    }
  }
  return CRITERION_IDS.map((id) => byId.get(id)!);
}

function rowToSettings(row: ConfigHealthSettingsRow): ConfigHealthSettings {
  const { criteria, ...rest } = row;
  return { ...rest, criteria: normalizeCriteria(criteria) };
}

/**
 * All queries for config_health_settings.
 * Singleton pattern — exactly one settings record (id = 1) exists (seeded by migration).
 */
export const configHealthSettingsQueries = {
  /**
   * Get the config-health settings (singleton). Self-heals if the seed row is somehow absent so
   * callers never receive undefined. Criteria are parsed and normalized against the canonical set.
   */
  get(): ConfigHealthSettings {
    let row = db.queryFirst<ConfigHealthSettingsRow>('SELECT * FROM config_health_settings WHERE id = 1');
    if (!row) {
      db.execute(
        `INSERT OR IGNORE INTO config_health_settings (id, criteria) VALUES (1, ?)`,
        JSON.stringify(DEFAULT_CRITERIA)
      );
      row = db.queryFirst<ConfigHealthSettingsRow>('SELECT * FROM config_health_settings WHERE id = 1');
    }
    if (!row) {
      throw new Error('config_health_settings singleton row is missing');
    }
    return rowToSettings(row);
  },

  /**
   * Update config-health settings (enable / cadence / retention / criteria). Criteria are
   * normalized before persistence so only the canonical, well-formed set is ever stored.
   */
  update(input: UpdateConfigHealthSettingsInput): boolean {
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
    if (input.retentionDays !== undefined) {
      updates.push('retention_days = ?');
      params.push(input.retentionDays);
    }
    if (input.retentionMaxEntries !== undefined) {
      updates.push('retention_max_entries = ?');
      params.push(input.retentionMaxEntries);
    }
    if (input.criteria !== undefined) {
      updates.push('criteria = ?');
      params.push(JSON.stringify(normalizeCriteria(JSON.stringify(input.criteria))));
    }

    if (updates.length === 0) {
      return false;
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    const affected = db.execute(`UPDATE config_health_settings SET ${updates.join(', ')} WHERE id = 1`, ...params);
    return affected > 0;
  },

  /** Persist chunked-sweep progress between job runs (cursor = last processed instance id). */
  setSweepProgress(cursor: number, sweepStartedAt: string): boolean {
    const affected = db.execute(
      `UPDATE config_health_settings
			 SET sweep_cursor = ?, sweep_started_at = ?, updated_at = CURRENT_TIMESTAMP
			 WHERE id = 1`,
      cursor,
      sweepStartedAt
    );
    return affected > 0;
  },

  /**
   * Clear any in-progress sweep state (used when config-health is disabled) so a re-enable starts a
   * fresh sweep instead of resuming a stale cursor.
   */
  resetSweepProgress(): boolean {
    const affected = db.execute(
      `UPDATE config_health_settings
			 SET sweep_cursor = 0, sweep_started_at = NULL, updated_at = CURRENT_TIMESTAMP
			 WHERE id = 1`
    );
    return affected > 0;
  },

  /** Record a completed sweep: advance last_run_at, clear backoff, and reset sweep progress. */
  markRun(lastRunAt: string): boolean {
    const affected = db.execute(
      `UPDATE config_health_settings
			 SET last_run_at = ?, error_count = 0, backoff_until = NULL,
			     sweep_cursor = 0, sweep_started_at = NULL, updated_at = CURRENT_TIMESTAMP
			 WHERE id = 1`,
      lastRunAt
    );
    return affected > 0;
  },

  /**
   * Record a failed sweep: persist the incremented backoff exponent and next-eligible gate, and
   * reset sweep progress so the next attempt restarts a fresh sweep.
   */
  markFailure(errorCount: number, backoffUntil: string): boolean {
    const affected = db.execute(
      `UPDATE config_health_settings
			 SET error_count = ?, backoff_until = ?,
			     sweep_cursor = 0, sweep_started_at = NULL, updated_at = CURRENT_TIMESTAMP
			 WHERE id = 1`,
      errorCount,
      backoffUntil
    );
    return affected > 0;
  },
};
