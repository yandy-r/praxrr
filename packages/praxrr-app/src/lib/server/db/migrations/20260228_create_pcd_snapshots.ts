import type { Migration } from '../migrations.ts';

/**
 * Migration 20260228: Create PCD snapshots table for per-database state markers
 */
export const migration: Migration = {
  version: 20260228,
  name: 'Create PCD snapshots',

  up: `
		CREATE TABLE pcd_snapshots (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			database_id INTEGER NOT NULL,
			type TEXT NOT NULL CHECK (type IN ('auto', 'manual')),
			trigger TEXT CHECK (trigger IN ('pull', 'sync', 'manual')),
			description TEXT,
			ops_sequence_max_id INTEGER NOT NULL,
			ops_count_base INTEGER NOT NULL DEFAULT 0,
			ops_count_user INTEGER NOT NULL DEFAULT 0,
			cache_state_hash TEXT,
			target_instance_ids TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (database_id) REFERENCES database_instances(id) ON DELETE CASCADE
		);

		CREATE INDEX idx_pcd_snapshots_database_created
			ON pcd_snapshots(database_id, created_at DESC);

		CREATE INDEX idx_pcd_snapshots_database_type
			ON pcd_snapshots(database_id, type);
	`,

  down: `
		DROP INDEX IF EXISTS idx_pcd_snapshots_database_type;
		DROP INDEX IF EXISTS idx_pcd_snapshots_database_created;
		DROP TABLE IF EXISTS pcd_snapshots;
	`,
};
