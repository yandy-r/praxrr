import { db } from '../db.ts';
import type { CanaryPartialPolicy, CanarySettings, CanarySettingsRow } from '$lib/server/sync/canary/types.ts';

/**
 * Patch shape for the canary_settings singleton. All fields optional; camelCase
 * mirrors the OpenAPI `CanarySettingsUpdate` schema.
 */
export interface CanarySettingsUpdate {
  enabled?: boolean;
  defaultMaxBatchSize?: number;
  autoSelect?: boolean;
  defaultCanaryInstanceId?: number | null;
  defaultPartialPolicy?: CanaryPartialPolicy;
}

/** Map a raw `canary_settings` row to the parsed DTO (INTEGER flags → booleans). */
function rowToSettings(row: CanarySettingsRow): CanarySettings {
  return {
    enabled: row.enabled === 1,
    defaultMaxBatchSize: row.default_max_batch_size,
    autoSelect: row.auto_select === 1,
    defaultCanaryInstanceId: row.default_canary_instance_id,
    defaultPartialPolicy: row.default_partial_policy as CanaryPartialPolicy,
    updatedAt: row.updated_at
  };
}

/**
 * All queries for canary_settings.
 * Singleton pattern — exactly one settings record (id = 1) exists (seeded by
 * migration). `get()` self-heals if the seed row is somehow absent so callers
 * never receive undefined.
 */
export const canarySettingsQueries = {
  /** Get the canary settings (singleton), mapped to the parsed DTO. */
  get(): CanarySettings {
    let row = db.queryFirst<CanarySettingsRow>('SELECT * FROM canary_settings WHERE id = 1');
    if (!row) {
      db.execute('INSERT OR IGNORE INTO canary_settings (id) VALUES (1)');
      row = db.queryFirst<CanarySettingsRow>('SELECT * FROM canary_settings WHERE id = 1');
    }
    if (!row) {
      throw new Error('canary_settings singleton row is missing');
    }
    return rowToSettings(row);
  },

  /** Apply a partial update and return the fresh settings (bumps updated_at). */
  update(patch: CanarySettingsUpdate): CanarySettings {
    const updates: string[] = [];
    const params: (string | number | null)[] = [];

    if (patch.enabled !== undefined) {
      updates.push('enabled = ?');
      params.push(patch.enabled ? 1 : 0);
    }
    if (patch.defaultMaxBatchSize !== undefined) {
      updates.push('default_max_batch_size = ?');
      params.push(patch.defaultMaxBatchSize);
    }
    if (patch.autoSelect !== undefined) {
      updates.push('auto_select = ?');
      params.push(patch.autoSelect ? 1 : 0);
    }
    if (patch.defaultCanaryInstanceId !== undefined) {
      updates.push('default_canary_instance_id = ?');
      params.push(patch.defaultCanaryInstanceId);
    }
    if (patch.defaultPartialPolicy !== undefined) {
      updates.push('default_partial_policy = ?');
      params.push(patch.defaultPartialPolicy);
    }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      db.execute(`UPDATE canary_settings SET ${updates.join(', ')} WHERE id = 1`, ...params);
    }

    return this.get();
  }
};
