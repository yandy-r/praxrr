import { db } from '../db.ts';
import type { SyncPreviewArrType } from '$sync/preview/types.ts';
import type {
  DriftCounts,
  DriftEntityAck,
  DriftEntityChange,
  DriftReason,
  DriftRemediationRecord,
  DriftRemediationStatus,
  DriftRemediationTrigger,
  DriftStatus,
} from '$sync/drift/types.ts';

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
  drift_detected_at: string | null;
  acknowledged_signature: string | null;
  acknowledged_at: string | null;
  acknowledged_entity_keys: string;
  snoozed_until: string | null;
  last_remediation_trigger: string | null;
  last_remediation_status: string | null;
  last_remediation_signature: string | null;
  last_remediation_at: string | null;
  last_remediation_sync_history_id: number | null;
  last_auto_attempt_signature: string | null;
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
  counts: DriftCounts;
  driftSignature: string | null;
  notifiedSignature: string | null;
  detectedVersion: string | null;
  changes: DriftEntityChange[];
  checkedAt: string;
  contentCheckedAt: string | null;
  durationMs: number | null;
  /** ISO; first content refresh that saw the current `driftSignature` (drift event identity). */
  driftDetectedAt: string | null;
  /** Instance-level ack: the alerting CONTENT signature it covers (active only while it still matches). */
  acknowledgedSignature: string | null;
  acknowledgedAt: string | null;
  /** Stored per-entity acks (key + content fingerprint); stale ones are inert until pruned. */
  acknowledgedEntities: DriftEntityAck[];
  /** ISO; snooze active while in the future. */
  snoozedUntil: string | null;
  lastRemediation: DriftRemediationRecord;
  /** Auto-remediation idempotency key (one auto attempt per signature). */
  lastAutoAttemptSignature: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Input for an upsert. persist.ts pre-merges prior content on a failed check, so this
 * query writes every content column unconditionally; `notified_signature` is managed
 * separately via {@link markNotified}, and the suppression/remediation columns via their
 * dedicated methods — none of those are ever touched here.
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
  driftDetectedAt: string | null;
}

/** Recorded outcome of one remediation attempt (see {@link driftStatusQueries.recordRemediation}). */
export interface RecordDriftRemediationInput {
  trigger: DriftRemediationTrigger;
  status: DriftRemediationStatus;
  signature: string | null;
  at: string;
  syncHistoryId: number | null;
}

/** Full suppression state written by {@link driftStatusQueries.setSuppression}. */
export interface SetDriftSuppressionInput {
  acknowledgedSignature: string | null;
  acknowledgedEntities: readonly DriftEntityAck[];
  snoozedUntil: string | null;
  acknowledgedAt: string | null;
  /**
   * Carry the notification dedup key across a narrowing ack: when `notified_signature` still
   * equals `from` (the user was already notified about the pre-change effective set), it becomes
   * `to` (the post-change effective signature) in the same guarded UPDATE, so acknowledging part
   * of an already-notified drift never re-alerts the remainder. Omitted/`null` leaves it untouched.
   */
  carryNotified?: { from: string; to: string } | null;
}

function parseChanges(raw: string): DriftEntityChange[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DriftEntityChange[]) : [];
  } catch {
    return [];
  }
}

function parseEntityAcks(raw: string): DriftEntityAck[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (entry): entry is DriftEntityAck =>
              typeof entry === 'object' &&
              entry !== null &&
              typeof entry.key === 'string' &&
              typeof entry.fingerprint === 'string'
          )
          .map((entry) => ({ key: entry.key, fingerprint: entry.fingerprint }))
      : [];
  } catch {
    return [];
  }
}

function serializeEntityAcks(acks: readonly DriftEntityAck[]): string {
  return JSON.stringify(acks.map((ack) => ({ key: ack.key, fingerprint: ack.fingerprint })));
}

function toDetail(row: DriftInstanceStatusRow): DriftInstanceStatusDetail {
  const changes = parseChanges(row.changes);
  return {
    arrInstanceId: row.arr_instance_id,
    arrType: row.arr_type as SyncPreviewArrType,
    status: row.status as DriftStatus,
    reason: (row.reason as DriftReason | null) ?? null,
    counts: {
      drifted: row.drifted_count,
      missing: row.missing_count,
      unmanaged: row.unmanaged_count,
      prune: changes.filter((change) => change.category === 'prune').length,
    },
    driftSignature: row.drift_signature,
    notifiedSignature: row.notified_signature,
    detectedVersion: row.detected_version,
    changes,
    checkedAt: row.checked_at,
    contentCheckedAt: row.content_checked_at,
    durationMs: row.duration_ms,
    driftDetectedAt: row.drift_detected_at,
    acknowledgedSignature: row.acknowledged_signature,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedEntities: parseEntityAcks(row.acknowledged_entity_keys),
    snoozedUntil: row.snoozed_until,
    lastRemediation: {
      trigger: (row.last_remediation_trigger as DriftRemediationTrigger | null) ?? null,
      status: (row.last_remediation_status as DriftRemediationStatus | null) ?? null,
      signature: row.last_remediation_signature,
      at: row.last_remediation_at,
      syncHistoryId: row.last_remediation_sync_history_id,
    },
    lastAutoAttemptSignature: row.last_auto_attempt_signature,
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
   * Preserves `notified_signature`, the suppression/remediation columns and `created_at`;
   * advances `updated_at`.
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
					checked_at, content_checked_at, duration_ms, drift_detected_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
					drift_detected_at = excluded.drift_detected_at,
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
      input.durationMs,
      input.driftDetectedAt
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

  /**
   * Replace the suppression state, value-guarded on the drift signature the caller reviewed
   * (`IS` so a null expectation matches a null signature). Returns false when the row is
   * absent or its signature changed underneath the caller (→ 409).
   */
  setSuppression(instanceId: number, expectedSignature: string | null, input: SetDriftSuppressionInput): boolean {
    const carry = input.carryNotified;
    const affected = db.execute(
      `UPDATE drift_instance_status SET
				acknowledged_signature = ?,
				acknowledged_at = ?,
				acknowledged_entity_keys = ?,
				snoozed_until = ?,
				notified_signature = CASE WHEN ? = 1 AND notified_signature IS ? THEN ? ELSE notified_signature END,
				updated_at = CURRENT_TIMESTAMP
			WHERE arr_instance_id = ? AND drift_signature IS ?`,
      input.acknowledgedSignature,
      input.acknowledgedAt,
      serializeEntityAcks(input.acknowledgedEntities),
      input.snoozedUntil,
      carry ? 1 : 0,
      carry?.from ?? null,
      carry?.to ?? null,
      instanceId,
      expectedSignature
    );
    return affected > 0;
  },

  /**
   * After a content refresh: drop an instance ack that no longer matches the current alerting
   * CONTENT signature (value-guarded in SQL so a concurrent ack of the new content survives) and
   * prune entity acks whose key is gone or whose content fingerprint changed (`current` = the
   * `{ key, fingerprint }` of every current alerting change). Clears `acknowledged_at` when
   * nothing acked remains.
   */
  clearStaleAcknowledgements(
    instanceId: number,
    currentContentSignature: string | null,
    current: readonly DriftEntityAck[]
  ): void {
    db.execute(
      `UPDATE drift_instance_status SET
				acknowledged_signature = NULL,
				updated_at = CURRENT_TIMESTAMP
			WHERE arr_instance_id = ? AND acknowledged_signature IS NOT NULL AND acknowledged_signature IS NOT ?`,
      instanceId,
      currentContentSignature
    );

    const row = db.queryFirst<{ acknowledged_entity_keys: string }>(
      'SELECT acknowledged_entity_keys FROM drift_instance_status WHERE arr_instance_id = ?',
      instanceId
    );
    if (row) {
      const storedJson = row.acknowledged_entity_keys;
      const live = new Set(current.map((ack) => `${ack.key}\n${ack.fingerprint}`));
      const keptJson = serializeEntityAcks(
        parseEntityAcks(storedJson).filter((ack) => live.has(`${ack.key}\n${ack.fingerprint}`))
      );
      if (keptJson !== storedJson) {
        // Guarded on the exact JSON read so a concurrent ack edit is never overwritten.
        db.execute(
          `UPDATE drift_instance_status SET acknowledged_entity_keys = ?, updated_at = CURRENT_TIMESTAMP
					WHERE arr_instance_id = ? AND acknowledged_entity_keys = ?`,
          keptJson,
          instanceId,
          storedJson
        );
      }
    }

    db.execute(
      `UPDATE drift_instance_status SET acknowledged_at = NULL, updated_at = CURRENT_TIMESTAMP
			WHERE arr_instance_id = ? AND acknowledged_at IS NOT NULL
				AND acknowledged_signature IS NULL AND acknowledged_entity_keys = '[]'`,
      instanceId
    );
  },

  /**
   * Stamp the last remediation outcome (+ sync_history back-pointer). Guarded so an outcome for an
   * older drift event never overwrites a newer one: it writes only while `rec.signature` is still
   * the stored `drift_signature` (`IS`, so null matches null) or nothing has been recorded yet.
   * Sync History keeps the exact per-run record regardless. False when no row matched.
   */
  recordRemediation(instanceId: number, rec: RecordDriftRemediationInput): boolean {
    const affected = db.execute(
      `UPDATE drift_instance_status SET
				last_remediation_trigger = ?,
				last_remediation_status = ?,
				last_remediation_signature = ?,
				last_remediation_at = ?,
				last_remediation_sync_history_id = ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE arr_instance_id = ? AND (drift_signature IS ? OR last_remediation_signature IS NULL)`,
      rec.trigger,
      rec.status,
      rec.signature,
      rec.at,
      rec.syncHistoryId,
      instanceId,
      rec.signature
    );
    return affected > 0;
  },

  /**
   * Claim the single auto attempt for `signature`. Value-guarded on `signature` still being the
   * stored `drift_signature`. Returns false when this signature was already attempted, the drift
   * moved on, or no row exists — the caller must not remediate.
   */
  markAutoAttempt(instanceId: number, signature: string): boolean {
    const affected = db.execute(
      `UPDATE drift_instance_status SET last_auto_attempt_signature = ?, updated_at = CURRENT_TIMESTAMP
			WHERE arr_instance_id = ? AND drift_signature = ? AND last_auto_attempt_signature IS NOT ?`,
      signature,
      instanceId,
      signature,
      signature
    );
    return affected > 0;
  },

  /**
   * Release an auto-attempt claim when the attempt wrote nothing (retriable precondition), so the
   * next drift refresh may re-enqueue it. Value-guarded on the claim still being `signature`.
   */
  releaseAutoAttempt(instanceId: number, signature: string): boolean {
    const affected = db.execute(
      `UPDATE drift_instance_status SET last_auto_attempt_signature = NULL, updated_at = CURRENT_TIMESTAMP
			WHERE arr_instance_id = ? AND last_auto_attempt_signature = ?`,
      instanceId,
      signature
    );
    return affected > 0;
  },

  /**
   * Re-arm auto-remediation after a genuine recovery: clear the per-signature attempt claim so an
   * identical drift that recurs later is eligible again. Value-guarded on the stored row having
   * no alerting drift (`drift_signature IS NULL`), so a concurrent refresh that already persisted
   * new drift never loses its claim. Returns false when nothing was cleared.
   */
  clearAutoAttempt(instanceId: number): boolean {
    const affected = db.execute(
      `UPDATE drift_instance_status SET last_auto_attempt_signature = NULL, updated_at = CURRENT_TIMESTAMP
			WHERE arr_instance_id = ? AND last_auto_attempt_signature IS NOT NULL AND drift_signature IS NULL`,
      instanceId
    );
    return affected > 0;
  },
};
