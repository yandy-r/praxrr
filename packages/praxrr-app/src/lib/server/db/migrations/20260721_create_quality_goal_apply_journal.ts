import type { Migration } from '../migrations.ts';

/**
 * Migration 20260721: Create the quality goal apply journal (issue #236).
 *
 * Records every Quality Goals apply (and reconcile) ATTEMPT as a durable breadcrumb so a partial
 * write — scoring persisted to `pcd_ops` but the goal binding not yet written — is precisely
 * reportable and deterministically recoverable. Quality Goals apply spans two durable writes on the
 * same `praxrr.db` connection (scoring ops + `quality_goal_bindings`) that cannot be made atomic
 * safely (a cross-store `db.transaction()` would hold a bare `BEGIN` across the writer's mid-body
 * awaits and silently roll back concurrent writers — see driftStatus/syncHistory/configHealthSnapshots).
 * This append-only audit table is the issue-sanctioned reconciliation marker instead.
 *
 * Lifecycle: a row is inserted `pending` BEFORE any scoring write, then transitions to `succeeded`
 * (scoring + binding both durable) or `failed` (with the exact `failure_stage` + a conservative
 * `scoring_persisted` flag). `arr_type` is CHECK-constrained to the apply scope (radarr/sonarr/lidarr)
 * and never inferred across siblings. This is a pure app-DB audit table (mirrors `sync_history` /
 * `pcd_op_history`), NOT a PCD base op, so `seedBuiltInBaseOps.ts` is intentionally untouched.
 */
export const migration: Migration = {
  version: 20260721,
  name: 'Create quality goal apply journal',

  up: `
		CREATE TABLE quality_goal_apply_journal (
			id                 INTEGER PRIMARY KEY AUTOINCREMENT,
			database_id        INTEGER NOT NULL REFERENCES database_instances(id) ON DELETE CASCADE,
			profile_name       TEXT NOT NULL,
			arr_type           TEXT NOT NULL CHECK (arr_type IN ('radarr', 'sonarr', 'lidarr')),
			preset_id          TEXT NOT NULL,
			weights_json       TEXT NOT NULL,
			engine_version     TEXT NOT NULL,
			intent_fingerprint TEXT NOT NULL,
			status             TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
			scoring_persisted  INTEGER NOT NULL DEFAULT 0 CHECK (scoring_persisted IN (0, 1)),
			binding_persisted  INTEGER NOT NULL DEFAULT 0 CHECK (binding_persisted IN (0, 1)),
			origin             TEXT NOT NULL DEFAULT 'apply' CHECK (origin IN ('apply', 'reconcile')),
			failure_stage      TEXT CHECK (failure_stage IN ('scoring', 'binding')),
			failure_reason     TEXT,
			started_at         TEXT NOT NULL,
			settled_at         TEXT,
			created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX idx_qg_apply_journal_lookup
			ON quality_goal_apply_journal (database_id, profile_name, arr_type, id DESC);
	`,

  down: `
		DROP TABLE IF EXISTS quality_goal_apply_journal;
	`
};
