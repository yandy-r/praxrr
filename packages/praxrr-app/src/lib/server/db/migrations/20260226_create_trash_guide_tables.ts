import type { Migration } from '../migrations.ts';

/**
 * Migration 20260226: Create TRaSH Guide tables and provenance support
 */
export const migration: Migration = {
  version: 20260226,
  name: 'Create TRaSH Guide tables',

  up: `
		CREATE TABLE trash_guide_sources (
			id INTEGER PRIMARY KEY AUTOINCREMENT,

			name TEXT NOT NULL UNIQUE,
			repository_url TEXT NOT NULL,
			branch TEXT NOT NULL DEFAULT 'master',
			local_path TEXT NOT NULL,
			arr_type TEXT NOT NULL CHECK (arr_type IN ('radarr', 'sonarr')),

			score_profile TEXT NOT NULL DEFAULT 'default',
			sync_strategy INTEGER NOT NULL DEFAULT 0,
			auto_pull INTEGER NOT NULL DEFAULT 0,
			enabled INTEGER NOT NULL DEFAULT 1,

			last_synced_at DATETIME,
			last_commit_hash TEXT,

			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE trash_guide_sync_config (
			instance_id INTEGER NOT NULL,
			source_id INTEGER NOT NULL,
			trigger TEXT NOT NULL DEFAULT 'none',
			cron TEXT,
			next_run_at TEXT,
			sync_status TEXT NOT NULL DEFAULT 'idle',
			last_error TEXT,
			last_synced_at DATETIME,
			should_sync INTEGER NOT NULL DEFAULT 0,

			PRIMARY KEY (instance_id, source_id),
			FOREIGN KEY (instance_id) REFERENCES arr_instances(id) ON DELETE CASCADE,
			FOREIGN KEY (source_id) REFERENCES trash_guide_sources(id) ON DELETE CASCADE,
			CHECK (trigger IN ('none', 'manual', 'on_pull', 'on_change', 'schedule')),
			CHECK (sync_status IN ('idle', 'pending', 'in_progress', 'failed'))
		);

		CREATE TABLE trash_guide_sync_selections (
			instance_id INTEGER NOT NULL,
			source_id INTEGER NOT NULL,
			section_type TEXT NOT NULL,
			item_name TEXT NOT NULL,

			PRIMARY KEY (instance_id, source_id, section_type, item_name),
			FOREIGN KEY (instance_id) REFERENCES arr_instances(id) ON DELETE CASCADE,
			FOREIGN KEY (source_id) REFERENCES trash_guide_sources(id) ON DELETE CASCADE
		);

		CREATE TABLE trash_guide_entity_cache (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			source_id INTEGER NOT NULL,
			trash_id TEXT NOT NULL,
			entity_type TEXT NOT NULL,
			name TEXT NOT NULL,
			json_data TEXT NOT NULL,
			file_path TEXT NOT NULL,
			content_hash TEXT NOT NULL,
			fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,

			UNIQUE (source_id, trash_id, entity_type),
			FOREIGN KEY (source_id) REFERENCES trash_guide_sources(id) ON DELETE CASCADE
		);

		CREATE TABLE trash_id_mappings (
			source_id INTEGER NOT NULL,
			trash_id TEXT NOT NULL,
			arr_type TEXT NOT NULL CHECK (arr_type IN ('radarr', 'sonarr')),
			entity_type TEXT NOT NULL,
			entity_name TEXT NOT NULL,

			UNIQUE (source_id, trash_id, entity_type),
			FOREIGN KEY (source_id) REFERENCES trash_guide_sources(id) ON DELETE CASCADE
		);

		CREATE INDEX idx_trash_guide_sync_config_next_run_at
			ON trash_guide_sync_config(next_run_at);

		CREATE INDEX idx_trash_guide_sync_selections_source_instance
			ON trash_guide_sync_selections(source_id, instance_id);

		CREATE INDEX idx_trash_guide_entity_cache_type
			ON trash_guide_entity_cache(source_id, entity_type);

		CREATE INDEX idx_trash_id_mappings_arr_type_trash_id
			ON trash_id_mappings(arr_type, trash_id);

		-- SQLite cannot alter CHECK constraints, so recreate pcd_ops with updated source taxonomy
		PRAGMA foreign_keys = OFF;

		CREATE TABLE pcd_ops_new (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			database_id INTEGER NOT NULL,
			origin TEXT NOT NULL CHECK (origin IN ('base', 'user')),
			state TEXT NOT NULL CHECK (state IN ('published', 'draft', 'superseded', 'dropped', 'orphaned')),
			source TEXT NOT NULL CHECK (source IN ('repo', 'local', 'import', 'trashguide')),
			filename TEXT,
			op_number INTEGER,
			sequence INTEGER,
			sql TEXT NOT NULL,
			metadata TEXT,
			desired_state TEXT,
			content_hash TEXT,
			last_seen_in_repo_at DATETIME,
			superseded_by_op_id INTEGER,
			pushed_at DATETIME,
			pushed_commit TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (database_id) REFERENCES database_instances(id) ON DELETE CASCADE,
			FOREIGN KEY (superseded_by_op_id) REFERENCES pcd_ops_new(id)
		);

		INSERT INTO pcd_ops_new (
			id, database_id, origin, state, source, filename, op_number, sequence,
			sql, metadata, desired_state, content_hash, last_seen_in_repo_at,
			superseded_by_op_id, pushed_at, pushed_commit, created_at, updated_at
		)
		SELECT
			id, database_id, origin, state, source, filename, op_number, sequence,
			sql, metadata, desired_state, content_hash, last_seen_in_repo_at,
			superseded_by_op_id, pushed_at, pushed_commit, created_at, updated_at
		FROM pcd_ops;

		DROP TABLE pcd_ops;
		ALTER TABLE pcd_ops_new RENAME TO pcd_ops;

		DROP INDEX IF EXISTS idx_pcd_ops_apply_order;
		DROP INDEX IF EXISTS idx_pcd_ops_base_filename;
		DROP INDEX IF EXISTS idx_pcd_ops_hash;

		CREATE INDEX idx_pcd_ops_apply_order
			ON pcd_ops(database_id, origin, state, sequence, id);

		CREATE UNIQUE INDEX idx_pcd_ops_base_filename
			ON pcd_ops(database_id, origin, filename)
			WHERE origin = 'base' AND filename IS NOT NULL;

		CREATE INDEX idx_pcd_ops_hash
			ON pcd_ops(database_id, origin, content_hash);

		PRAGMA foreign_keys = ON;
	`,

  down: `
		DROP TABLE IF EXISTS trash_guide_sync_selections;
		DROP TABLE IF EXISTS trash_guide_sync_config;
		DROP TABLE IF EXISTS trash_guide_entity_cache;
		DROP TABLE IF EXISTS trash_id_mappings;
		DROP TABLE IF EXISTS trash_guide_sources;

		-- Revert pcd_ops source taxonomy to prior enum
		PRAGMA foreign_keys = OFF;

		CREATE TABLE pcd_ops_old (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			database_id INTEGER NOT NULL,
			origin TEXT NOT NULL CHECK (origin IN ('base', 'user')),
			state TEXT NOT NULL CHECK (state IN ('published', 'draft', 'superseded', 'dropped', 'orphaned')),
			source TEXT NOT NULL CHECK (source IN ('repo', 'local', 'import')),
			filename TEXT,
			op_number INTEGER,
			sequence INTEGER,
			sql TEXT NOT NULL,
			metadata TEXT,
			desired_state TEXT,
			content_hash TEXT,
			last_seen_in_repo_at DATETIME,
			superseded_by_op_id INTEGER,
			pushed_at DATETIME,
			pushed_commit TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (database_id) REFERENCES database_instances(id) ON DELETE CASCADE,
			FOREIGN KEY (superseded_by_op_id) REFERENCES pcd_ops_old(id)
		);

		INSERT INTO pcd_ops_old (
			id, database_id, origin, state, source, filename, op_number, sequence,
			sql, metadata, desired_state, content_hash, last_seen_in_repo_at,
			superseded_by_op_id, pushed_at, pushed_commit, created_at, updated_at
		)
		SELECT
			id, database_id, origin, state,
			CASE WHEN source = 'trashguide' THEN 'import' ELSE source END,
			filename, op_number, sequence,
			sql, metadata, desired_state, content_hash, last_seen_in_repo_at,
			superseded_by_op_id, pushed_at, pushed_commit, created_at, updated_at
		FROM pcd_ops;

		DROP TABLE pcd_ops;
		ALTER TABLE pcd_ops_old RENAME TO pcd_ops;

		DROP INDEX IF EXISTS idx_pcd_ops_apply_order;
		DROP INDEX IF EXISTS idx_pcd_ops_base_filename;
		DROP INDEX IF EXISTS idx_pcd_ops_hash;

		CREATE INDEX idx_pcd_ops_apply_order
			ON pcd_ops(database_id, origin, state, sequence, id);

		CREATE UNIQUE INDEX idx_pcd_ops_base_filename
			ON pcd_ops(database_id, origin, filename)
			WHERE origin = 'base' AND filename IS NOT NULL;

		CREATE INDEX idx_pcd_ops_hash
			ON pcd_ops(database_id, origin, content_hash);

		PRAGMA foreign_keys = ON;
	`,
};
