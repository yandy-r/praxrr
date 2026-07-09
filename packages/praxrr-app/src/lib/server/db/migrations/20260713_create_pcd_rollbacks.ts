import type { Migration } from '../migrations.ts';

/**
 * Migration 20260712: Create pcd_rollbacks audit table (issue #16).
 *
 * Append-only, one row per executed Point-in-Time Restore. Distinct from sync_history
 * (which is instance-scoped and models forward Arr syncs): a rollback is PCD/database-scoped
 * and pushes to no instance, so it needs its own audit surface rather than overloading the
 * sync_history CHECK-constrained schema.
 *
 * `target_state_hash` is denormalized (the sync_history pattern) so the audit row survives
 * deletion of the source snapshot. Both the source snapshot and the pre-rollback capture are
 * linked via nullable FKs (ON DELETE SET NULL) so a pruned/deleted snapshot never orphans or
 * cascades away a rollback record.
 */
export const migration: Migration = {
  version: 20260713,
  name: 'Create pcd_rollbacks audit table',

  up: `
		CREATE TABLE pcd_rollbacks (
			id                       INTEGER PRIMARY KEY AUTOINCREMENT,
			database_id              INTEGER NOT NULL REFERENCES database_instances(id) ON DELETE CASCADE,
			snapshot_id              INTEGER REFERENCES pcd_snapshots(id) ON DELETE SET NULL,
			pre_rollback_snapshot_id INTEGER REFERENCES pcd_snapshots(id) ON DELETE SET NULL,
			target_state_hash        TEXT,
			ops_undone               INTEGER NOT NULL DEFAULT 0,
			ops_reactivated          INTEGER NOT NULL DEFAULT 0,
			status                   TEXT NOT NULL CHECK (status IN ('success', 'failed')),
			error                    TEXT,
			created_at               TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX idx_pcd_rollbacks_database_created
			ON pcd_rollbacks(database_id, created_at DESC);

		CREATE INDEX idx_pcd_rollbacks_snapshot
			ON pcd_rollbacks(snapshot_id);
	`,

  down: `
		DROP INDEX IF EXISTS idx_pcd_rollbacks_snapshot;
		DROP INDEX IF EXISTS idx_pcd_rollbacks_database_created;
		DROP TABLE IF EXISTS pcd_rollbacks;
	`,
};
