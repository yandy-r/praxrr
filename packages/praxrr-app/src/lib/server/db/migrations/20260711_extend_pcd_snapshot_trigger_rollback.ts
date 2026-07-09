import type { Migration } from '../migrations.ts';

/**
 * Migration 20260711: Extend pcd_snapshots.trigger CHECK to allow 'rollback' (issue #16).
 *
 * Rollback / Point-in-Time Restore captures a pre-rollback snapshot before it rewinds the
 * op log, so a restore is itself reversible. That capture is a `type='manual'` snapshot
 * (never auto-pruned) tagged with a distinct `trigger='rollback'` so it is filterable and
 * badgeable in the UI rather than parsed out of a magic description prefix.
 *
 * SQLite cannot ALTER a CHECK constraint, so the table is rebuilt via
 * create-new/copy/drop/rename (the 035_add_job_skipped_status precedent), preserving every
 * column, the `database_instances` FK (ON DELETE CASCADE), and both indexes.
 */
export const migration: Migration = {
  version: 20260711,
  name: 'Extend pcd_snapshots trigger with rollback',

  up: `
		CREATE TABLE pcd_snapshots_new (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			database_id INTEGER NOT NULL,
			type TEXT NOT NULL CHECK (type IN ('auto', 'manual')),
			"trigger" TEXT NOT NULL CHECK ("trigger" IN ('pull', 'sync', 'manual', 'rollback')),
			description TEXT,
			ops_sequence_max_id INTEGER NOT NULL,
			ops_count_base INTEGER NOT NULL DEFAULT 0,
			ops_count_user INTEGER NOT NULL DEFAULT 0,
			cache_state_hash TEXT,
			target_instance_ids TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (database_id) REFERENCES database_instances(id) ON DELETE CASCADE
		);

		INSERT INTO pcd_snapshots_new (
			id, database_id, type, "trigger", description,
			ops_sequence_max_id, ops_count_base, ops_count_user,
			cache_state_hash, target_instance_ids, created_at
		)
		SELECT
			id, database_id, type, "trigger", description,
			ops_sequence_max_id, ops_count_base, ops_count_user,
			cache_state_hash, target_instance_ids, created_at
		FROM pcd_snapshots;

		DROP TABLE pcd_snapshots;

		ALTER TABLE pcd_snapshots_new RENAME TO pcd_snapshots;

		CREATE INDEX idx_pcd_snapshots_database_created
			ON pcd_snapshots(database_id, created_at DESC);

		CREATE INDEX idx_pcd_snapshots_database_type
			ON pcd_snapshots(database_id, type);
	`,

  down: `
		CREATE TABLE pcd_snapshots_old (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			database_id INTEGER NOT NULL,
			type TEXT NOT NULL CHECK (type IN ('auto', 'manual')),
			"trigger" TEXT NOT NULL CHECK ("trigger" IN ('pull', 'sync', 'manual')),
			description TEXT,
			ops_sequence_max_id INTEGER NOT NULL,
			ops_count_base INTEGER NOT NULL DEFAULT 0,
			ops_count_user INTEGER NOT NULL DEFAULT 0,
			cache_state_hash TEXT,
			target_instance_ids TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (database_id) REFERENCES database_instances(id) ON DELETE CASCADE
		);

		INSERT INTO pcd_snapshots_old (
			id, database_id, type, "trigger", description,
			ops_sequence_max_id, ops_count_base, ops_count_user,
			cache_state_hash, target_instance_ids, created_at
		)
		SELECT
			id, database_id, type,
			CASE WHEN "trigger" = 'rollback' THEN 'manual' ELSE "trigger" END,
			description,
			ops_sequence_max_id, ops_count_base, ops_count_user,
			cache_state_hash, target_instance_ids, created_at
		FROM pcd_snapshots;

		DROP TABLE pcd_snapshots;

		ALTER TABLE pcd_snapshots_old RENAME TO pcd_snapshots;

		CREATE INDEX idx_pcd_snapshots_database_created
			ON pcd_snapshots(database_id, created_at DESC);

		CREATE INDEX idx_pcd_snapshots_database_type
			ON pcd_snapshots(database_id, type);
	`,
};
