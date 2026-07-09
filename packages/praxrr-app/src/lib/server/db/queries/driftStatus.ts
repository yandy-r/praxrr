import { db } from '../db.ts';
import type { SyncPreviewArrType } from '$sync/preview/types.ts';
import type { DriftEntityChange, DriftReason, DriftStatus } from '$sync/drift/types.ts';

/**
 * Row shape for drift_instance_status (byte-aligned to the migration columns).
 */
export interface DriftInstanceStatusRow {
  arr_instance_id: number;
  arr_type: string;
  status: string;
  reason: string | null;
  drifted_count: number;
  missing_count: number;
  unmanaged_count: number;
  drift_signature: string | null;
  notified_signature: string | null;
  detected_version: string | null;
  changes: string;
  checked_at: string;
  content_checked_at: string | null;
  duration_ms: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * Parsed, camelCased detail with the `changes` JSON blob decoded.
 */
export interface DriftInstanceStatusDetail {
  arrInstanceId: number;
  arrType: SyncPreviewArrType;
  status: DriftStatus;
  reason: DriftReason | null;
  counts: { drifted: number; missing: number; unmanaged: number };
  driftSignature: string | null;
  notifiedSignature: string | null;
  detectedVersion: string | null;
  changes: DriftEntityChange[];
  checkedAt: string;
  contentCheckedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Input for an upsert. persist.ts pre-merges prior content on a failed check, so this
 * query writes every content column unconditionally; `notified_signature` is managed
 * separately via {@link markNotified} and is never touched here.
 */
export interface UpsertDriftStatusInput {
  arrInstanceId: number;
  arrType: string;
  status: DriftStatus;
  reason: DriftReason | null;
  driftedCount: number;
  missingCount: number;
  unmanagedCount: number;
  driftSignature: string | null;
  detectedVersion: string | null;
  changes: readonly DriftEntityChange[];
  checkedAt: string;
  contentCheckedAt: string | null;
  durationMs: number | null;
}

function parseChanges(raw: string): DriftEntityChange[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DriftEntityChange[]) : [];
  } catch {
    return [];
  }
}

function toDetail(row: DriftInstanceStatusRow): DriftInstanceStatusDetail {
  return {
    arrInstanceId: row.arr_instance_id,
    arrType: row.arr_type as SyncPreviewArrType,
    status: row.status as DriftStatus,
    reason: (row.reason as DriftReason | null) ?? null,
    counts: {
      drifted: row.drifted_count,
      missing: row.missing_count,
      unmanaged: row.unmanaged_count,
    },
    driftSignature: row.drift_signature,
    notifiedSignature: row.notified_signature,
    detectedVersion: row.detected_version,
    changes: parseChanges(row.changes),
    checkedAt: row.checked_at,
    contentCheckedAt: row.content_checked_at,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * All queries for drift_instance_status.
 */
export const driftStatusQueries = {
  /**
   * Latest drift status for a single instance, or undefined if never checked.
   */
  getById(instanceId: number): DriftInstanceStatusDetail | undefined {
    const row = db.queryFirst<DriftInstanceStatusRow>(
      'SELECT * FROM drift_instance_status WHERE arr_instance_id = ?',
      instanceId
    );
    return row ? toDetail(row) : undefined;
  },

  /**
   * All stored drift statuses (one row per instance) for the summary roll-up.
   * Single full pass over a small table — no `WHERE status = ?` filter.
   */
  getAllForSummary(): DriftInstanceStatusDetail[] {
    const rows = db.query<DriftInstanceStatusRow>('SELECT * FROM drift_instance_status');
    return rows.map(toDetail);
  },

  /**
   * Replace the single latest-state row for an instance (INSERT or UPDATE on conflict).
   * Preserves `notified_signature` and `created_at`; advances `updated_at`.
   *
   * Deliberately a bare `db.execute` (no `db.transaction` wrapper): a single
   * `INSERT ... ON CONFLICT DO UPDATE` is statement-atomic, and `db.transaction` issues a
   * bare `BEGIN` on the shared connection that is NOT re-entrancy-safe — under the drift
   * sweep's concurrent `processBatches` a nested `BEGIN` would throw and silently drop rows.
   */
  upsert(input: UpsertDriftStatusInput): void {
    const changesJson = JSON.stringify(input.changes);
    db.execute(
      `INSERT INTO drift_instance_status (
					arr_instance_id, arr_type, status, reason,
					drifted_count, missing_count, unmanaged_count,
					drift_signature, detected_version, changes,
					checked_at, content_checked_at, duration_ms
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(arr_instance_id) DO UPDATE SET
					arr_type = excluded.arr_type,
					status = excluded.status,
					reason = excluded.reason,
					drifted_count = excluded.drifted_count,
					missing_count = excluded.missing_count,
					unmanaged_count = excluded.unmanaged_count,
					drift_signature = excluded.drift_signature,
					detected_version = excluded.detected_version,
					changes = excluded.changes,
					checked_at = excluded.checked_at,
					content_checked_at = excluded.content_checked_at,
					duration_ms = excluded.duration_ms,
					updated_at = CURRENT_TIMESTAMP`,
      input.arrInstanceId,
      input.arrType,
      input.status,
      input.reason,
      input.driftedCount,
      input.missingCount,
      input.unmanagedCount,
      input.driftSignature,
      input.detectedVersion,
      changesJson,
      input.checkedAt,
      input.contentCheckedAt,
      input.durationMs
    );
  },

  /**
   * Record the signature the last `drift.detected` notification fired for.
   */
  markNotified(instanceId: number, signature: string | null): boolean {
    const affected = db.execute(
      'UPDATE drift_instance_status SET notified_signature = ?, updated_at = CURRENT_TIMESTAMP WHERE arr_instance_id = ?',
      signature,
      instanceId
    );
    return affected > 0;
  },
};
