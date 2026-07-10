import { db } from '../db.ts';

/** Database row for the per-instance Config Health notification claim. */
export interface ConfigHealthNotificationStateRow {
  arr_instance_id: number;
  notified_signature: string;
  notified_at: string;
  created_at: string;
  updated_at: string;
}

/** Camel-cased diagnostic view of a Config Health notification claim. */
export interface ConfigHealthNotificationStateDetail {
  arrInstanceId: number;
  notifiedSignature: string;
  notifiedAt: string;
  createdAt: string;
  updatedAt: string;
}

function toDetail(row: ConfigHealthNotificationStateRow): ConfigHealthNotificationStateDetail {
  return {
    arrInstanceId: row.arr_instance_id,
    notifiedSignature: row.notified_signature,
    notifiedAt: row.notified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isIsoUtcTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
}

/** Statement-atomic queries for the current Config Health notification claim. */
export const configHealthNotificationStateQueries = {
  /** Read current claim state for diagnostics and tests, never for dispatch arbitration. */
  get(instanceId: number): ConfigHealthNotificationStateDetail | undefined {
    const row = db.queryFirst<ConfigHealthNotificationStateRow>(
      'SELECT * FROM config_health_notification_state WHERE arr_instance_id = ?',
      instanceId
    );
    return row ? toDetail(row) : undefined;
  },

  /** Clear current claim state after a meaningful, comparable recovery. */
  clear(instanceId: number): boolean {
    return db.execute('DELETE FROM config_health_notification_state WHERE arr_instance_id = ?', instanceId) > 0;
  },

  /**
   * Atomically claim a new degraded-state signature.
   *
   * The conditional conflict update makes an identical signature a no-op, so only the caller whose
   * statement affected a row may dispatch. This deliberately uses no read-before-write or explicit
   * transaction because concurrent snapshot batches share the SQLite connection.
   */
  claim(instanceId: number, signature: string, notifiedAt: string): boolean {
    if (signature.length === 0) {
      throw new TypeError('Config Health notification signature must not be empty');
    }
    if (!isIsoUtcTimestamp(notifiedAt)) {
      throw new TypeError('Config Health notification time must be a valid ISO-8601 UTC timestamp');
    }

    const affected = db.execute(
      `INSERT INTO config_health_notification_state (
					arr_instance_id, notified_signature, notified_at
				) VALUES (?, ?, ?)
				ON CONFLICT(arr_instance_id) DO UPDATE SET
					notified_signature = excluded.notified_signature,
					notified_at = excluded.notified_at,
					updated_at = CURRENT_TIMESTAMP
				WHERE notified_signature <> excluded.notified_signature`,
      instanceId,
      signature,
      notifiedAt
    );
    return affected > 0;
  },
};
