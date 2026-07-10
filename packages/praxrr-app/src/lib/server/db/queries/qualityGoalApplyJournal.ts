import { db } from '../db.ts';

/**
 * Row shape of `quality_goal_apply_journal` — a durable breadcrumb per Quality Goals apply/reconcile
 * attempt (#236). Written `pending` before any scoring write, then settled to `succeeded` or `failed`.
 * The actual scores live in `pcd_ops` and the intent in `quality_goal_bindings`; this table only
 * records the OUTCOME so a partial write is precisely reportable and deterministically recoverable.
 */
export interface QualityGoalApplyJournalRow {
  id: number;
  database_id: number;
  profile_name: string;
  arr_type: string;
  preset_id: string;
  weights_json: string;
  engine_version: string;
  intent_fingerprint: string;
  status: 'pending' | 'succeeded' | 'failed';
  scoring_persisted: number;
  binding_persisted: number;
  origin: 'apply' | 'reconcile';
  failure_stage: 'scoring' | 'binding' | null;
  failure_reason: string | null;
  started_at: string;
  settled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InsertPendingJournalInput {
  databaseId: number;
  profileName: string;
  arrType: 'radarr' | 'sonarr' | 'lidarr';
  presetId: string;
  weightsJson: string;
  engineVersion: string;
  intentFingerprint: string;
  origin: 'apply' | 'reconcile';
  /** ISO-8601 UTC; the handler captures it once so the row and the response report the same instant. */
  startedAt: string;
}

export interface MarkJournalFailedInput {
  failureStage: 'scoring' | 'binding';
  failureReason: string;
  /** Conservative report: 1 whenever scoring writes may have landed, 0 only when nothing could have. */
  scoringPersisted: 0 | 1;
  bindingPersisted?: 0 | 1;
}

/**
 * Lifecycle queries for `quality_goal_apply_journal`. Every method is a BARE autocommit `db.execute`
 * — deliberately NO `db.transaction()` (a bare `BEGIN` held across the writer's async body would sweep
 * concurrent writers into the goals apply and silently roll them back on failure; #236).
 */
export const qualityGoalApplyJournalQueries = {
  /** Record a new attempt as `pending` BEFORE any scoring write; returns the new row id. */
  insertPending(input: InsertPendingJournalInput): number {
    db.execute(
      `INSERT INTO quality_goal_apply_journal
				 (database_id, profile_name, arr_type, preset_id, weights_json, engine_version,
				  intent_fingerprint, status, scoring_persisted, binding_persisted, origin, started_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, 0, ?, ?)`,
      input.databaseId,
      input.profileName,
      input.arrType,
      input.presetId,
      input.weightsJson,
      input.engineVersion,
      input.intentFingerprint,
      input.origin,
      input.startedAt
    );

    const row = db.queryFirst<{ id: number }>('SELECT last_insert_rowid() AS id');
    return row?.id ?? 0;
  },

  /**
   * Settle an attempt as `succeeded` — binding is durable (the one terminal state). `scoringPersisted`
   * is `0` when the guarded builders emitted no ops (live already matched → nothing changed), `1` when
   * scoring ops were written, so a no-op re-apply honestly reports `scoringChanged=false`.
   */
  markSucceeded(id: number, scoringPersisted: 0 | 1): void {
    db.execute(
      `UPDATE quality_goal_apply_journal
			 SET status = 'succeeded', scoring_persisted = ?, binding_persisted = 1,
				 settled_at = ?, updated_at = CURRENT_TIMESTAMP
			 WHERE id = ?`,
      scoringPersisted,
      new Date().toISOString(),
      id
    );
  },

  /** Settle an attempt as `failed`, recording the exact stage + the conservative persisted flags. */
  markFailed(id: number, input: MarkJournalFailedInput): void {
    db.execute(
      `UPDATE quality_goal_apply_journal
			 SET status = 'failed', failure_stage = ?, failure_reason = ?, scoring_persisted = ?,
				 binding_persisted = ?, settled_at = ?, updated_at = CURRENT_TIMESTAMP
			 WHERE id = ?`,
      input.failureStage,
      input.failureReason,
      input.scoringPersisted,
      input.bindingPersisted ?? 0,
      new Date().toISOString(),
      id
    );
  },

  /** The most recent attempt for a profile target, or `undefined` if none has ever been attempted. */
  getLatest(databaseId: number, profileName: string, arrType: string): QualityGoalApplyJournalRow | undefined {
    return db.queryFirst<QualityGoalApplyJournalRow>(
      `SELECT * FROM quality_goal_apply_journal
			 WHERE database_id = ? AND profile_name = ? AND arr_type = ?
			 ORDER BY id DESC LIMIT 1`,
      databaseId,
      profileName,
      arrType
    );
  },

  /** Fetch a single attempt by id, or `undefined` if unknown. */
  getById(id: number): QualityGoalApplyJournalRow | undefined {
    return db.queryFirst<QualityGoalApplyJournalRow>('SELECT * FROM quality_goal_apply_journal WHERE id = ?', id);
  }
};
