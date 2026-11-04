import { db } from '../db.ts';
import type { SyncPreviewArrType, SyncPreviewSection } from '$sync/preview/types.ts';
import type { DriftRemediationMode, DriftRemediationPolicy } from '$sync/drift/types.ts';
import { toUTC } from '$shared/utils/dates.ts';

/**
 * Row shape for drift_remediation_policy (byte-aligned to the migration columns).
 * No row == mode `off` (default off without backfill).
 */
export interface DriftRemediationPolicyRow {
  arr_instance_id: number;
  arr_type: string;
  mode: string;
  allowed_sections: string;
  created_at: string;
  updated_at: string;
}

/**
 * Input for {@link driftRemediationPolicyQueries.upsert}. `allowedSections` must already be
 * validated per `arrType` by the caller (route layer); this query persists it verbatim.
 */
export interface UpsertDriftRemediationPolicyInput {
  instanceId: number;
  arrType: SyncPreviewArrType;
  mode: DriftRemediationMode;
  allowedSections: readonly SyncPreviewSection[];
}

function parseSections(raw: string): SyncPreviewSection[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((section): section is SyncPreviewSection => typeof section === 'string')
      : [];
  } catch {
    return [];
  }
}

function toPolicy(row: DriftRemediationPolicyRow): DriftRemediationPolicy {
  return {
    instanceId: row.arr_instance_id,
    arrType: row.arr_type as SyncPreviewArrType,
    mode: row.mode as DriftRemediationMode,
    allowedSections: parseSections(row.allowed_sections),
    // SQLite `CURRENT_TIMESTAMP` (`YYYY-MM-DD HH:MM:SS`, UTC) → RFC 3339, as the API contract says.
    updatedAt: toUTC(row.updated_at),
  };
}

/**
 * All queries for drift_remediation_policy. Bare `db.execute` only (no `db.transaction`): the
 * drift sweep reads policies under concurrent `processBatches`, where a nested `BEGIN` throws.
 */
export const driftRemediationPolicyQueries = {
  /**
   * Policy for an instance. Synthesizes the `off` default (empty sections, `updatedAt: null`)
   * when no row exists. A stored row for a different `arr_type` (instance type changed) is
   * never reused across Arr apps — it also resolves to the `off` default.
   */
  get(instanceId: number, arrType: SyncPreviewArrType): DriftRemediationPolicy {
    const row = db.queryFirst<DriftRemediationPolicyRow>(
      'SELECT * FROM drift_remediation_policy WHERE arr_instance_id = ?',
      instanceId
    );
    if (!row || row.arr_type !== arrType) {
      return { instanceId, arrType, mode: 'off', allowedSections: [], updatedAt: null };
    }
    return toPolicy(row);
  },

  /** Insert or replace the policy row for an instance; returns the stored policy. */
  upsert(input: UpsertDriftRemediationPolicyInput): DriftRemediationPolicy {
    db.execute(
      `INSERT INTO drift_remediation_policy (arr_instance_id, arr_type, mode, allowed_sections)
			VALUES (?, ?, ?, ?)
			ON CONFLICT(arr_instance_id) DO UPDATE SET
				arr_type = excluded.arr_type,
				mode = excluded.mode,
				allowed_sections = excluded.allowed_sections,
				updated_at = CURRENT_TIMESTAMP`,
      input.instanceId,
      input.arrType,
      input.mode,
      JSON.stringify([...input.allowedSections])
    );
    const row = db.queryFirst<DriftRemediationPolicyRow>(
      'SELECT * FROM drift_remediation_policy WHERE arr_instance_id = ?',
      input.instanceId
    );
    if (!row) {
      throw new Error(`drift_remediation_policy row missing after upsert for instance ${input.instanceId}`);
    }
    return toPolicy(row);
  },
};
