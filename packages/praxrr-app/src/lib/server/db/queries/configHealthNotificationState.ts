import { db } from '../db.ts';

/** Database row for the per-instance Config Health notification high-water state. */
export interface ConfigHealthNotificationStateRow {
  arr_instance_id: number;
  last_snapshot_id: number;
  notified_signature: string | null;
  notified_at: string | null;
  notified_snapshot_id: number | null;
  created_at: string;
  updated_at: string;
}

/** Camel-cased diagnostic view of Config Health notification high-water state. */
export interface ConfigHealthNotificationStateDetail {
  arrInstanceId: number;
  lastSnapshotId: number;
  notifiedSignature: string | null;
  notifiedAt: string | null;
  notifiedSnapshotId: number | null;
  createdAt: string;
  updatedAt: string;
}

function toDetail(row: ConfigHealthNotificationStateRow): ConfigHealthNotificationStateDetail {
  return {
    arrInstanceId: row.arr_instance_id,
    lastSnapshotId: row.last_snapshot_id,
    notifiedSignature: row.notified_signature,
    notifiedAt: row.notified_at,
    notifiedSnapshotId: row.notified_snapshot_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isIsoUtcTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
}

function requireSnapshotId(snapshotId: number): void {
  if (!Number.isSafeInteger(snapshotId) || snapshotId <= 0) {
    throw new TypeError('Config Health notification snapshot ID must be a positive safe integer');
  }
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

  /** Atomically re-arm after recovery while retaining a monotonic snapshot high-water mark. */
  rearm(instanceId: number, currentSnapshotId: number): boolean {
    requireSnapshotId(currentSnapshotId);
    const row = db.queryFirst<{ last_snapshot_id: number }>(
      `INSERT INTO config_health_notification_state (
					arr_instance_id, last_snapshot_id, notified_signature, notified_at, notified_snapshot_id
				) VALUES (?, ?, NULL, NULL, NULL)
				ON CONFLICT(arr_instance_id) DO UPDATE SET
					last_snapshot_id = excluded.last_snapshot_id,
					notified_signature = NULL,
					notified_at = NULL,
					notified_snapshot_id = NULL,
					updated_at = CURRENT_TIMESTAMP
				WHERE excluded.last_snapshot_id > config_health_notification_state.last_snapshot_id
				RETURNING last_snapshot_id`,
      instanceId,
      currentSnapshotId
    );
    return row?.last_snapshot_id === currentSnapshotId;
  },

  /**
   * Atomically claim a new degraded-state signature.
   *
   * The monotonic conflict update rejects stale snapshot IDs. A newer identical signature advances
   * the high-water mark but preserves its original notification snapshot, allowing the RETURNING row
   * to distinguish state advancement from a dispatch-winning claim without a read-before-write race.
   */
  claim(instanceId: number, currentSnapshotId: number, signature: string, notifiedAt: string): boolean {
    requireSnapshotId(currentSnapshotId);
    if (signature.length === 0) {
      throw new TypeError('Config Health notification signature must not be empty');
    }
    if (!isIsoUtcTimestamp(notifiedAt)) {
      throw new TypeError('Config Health notification time must be a valid ISO-8601 UTC timestamp');
    }

    const row = db.queryFirst<{ last_snapshot_id: number; notified_snapshot_id: number | null }>(
      `INSERT INTO config_health_notification_state (
					arr_instance_id, last_snapshot_id, notified_signature, notified_at, notified_snapshot_id
				) VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(arr_instance_id) DO UPDATE SET
					last_snapshot_id = excluded.last_snapshot_id,
					notified_signature = excluded.notified_signature,
					notified_at = CASE
						WHEN config_health_notification_state.notified_signature IS excluded.notified_signature
							THEN config_health_notification_state.notified_at
						ELSE excluded.notified_at
					END,
					notified_snapshot_id = CASE
						WHEN config_health_notification_state.notified_signature IS excluded.notified_signature
							THEN config_health_notification_state.notified_snapshot_id
						ELSE excluded.notified_snapshot_id
					END,
					updated_at = CURRENT_TIMESTAMP
				WHERE excluded.last_snapshot_id > config_health_notification_state.last_snapshot_id
				RETURNING last_snapshot_id, notified_snapshot_id`,
      instanceId,
      currentSnapshotId,
      signature,
      notifiedAt,
      currentSnapshotId
    );
    return row?.last_snapshot_id === currentSnapshotId && row.notified_snapshot_id === currentSnapshotId;
  },
};
