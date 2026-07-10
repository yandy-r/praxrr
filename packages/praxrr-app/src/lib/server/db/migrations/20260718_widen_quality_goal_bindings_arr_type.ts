import type { Migration } from '../migrations.ts';

/**
 * Migration 20260718: Widen `quality_goal_bindings.arr_type` to include `lidarr` (issue #222).
 *
 * The Lidarr native Quality Goals apply path persists an audio-domain goal binding, but the original
 * table (20260711) CHECK-constrained `arr_type` to `radarr`/`sonarr`. SQLite CHECK constraints are
 * immutable, so this rebuilds the table with the widened CHECK, faithfully preserving the
 * `ON DELETE CASCADE` FK to `database_instances` and the composite `PRIMARY KEY`. Nothing references
 * `quality_goal_bindings`, so the rebuild is safe inside the runner's transaction without toggling
 * `foreign_keys` (mirrors the FK-rebuild idiom in migration 048).
 */
export const migration: Migration = {
  version: 20260718,
  name: 'Widen quality goal bindings arr_type to include lidarr',

  up: `
		CREATE TABLE quality_goal_bindings_new (
			database_id    INTEGER NOT NULL REFERENCES database_instances(id) ON DELETE CASCADE,
			profile_name   TEXT NOT NULL,
			arr_type       TEXT NOT NULL CHECK (arr_type IN ('radarr', 'sonarr', 'lidarr')),
			preset_id      TEXT NOT NULL,
			weights_json   TEXT NOT NULL,
			engine_version TEXT NOT NULL,
			applied_at     TEXT NOT NULL,
			created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (database_id, profile_name, arr_type)
		);

		INSERT INTO quality_goal_bindings_new
			(database_id, profile_name, arr_type, preset_id, weights_json, engine_version, applied_at, created_at, updated_at)
		SELECT
			database_id, profile_name, arr_type, preset_id, weights_json, engine_version, applied_at, created_at, updated_at
		FROM quality_goal_bindings;

		DROP TABLE quality_goal_bindings;
		ALTER TABLE quality_goal_bindings_new RENAME TO quality_goal_bindings;
	`,

  down: `
		CREATE TABLE quality_goal_bindings_new (
			database_id    INTEGER NOT NULL REFERENCES database_instances(id) ON DELETE CASCADE,
			profile_name   TEXT NOT NULL,
			arr_type       TEXT NOT NULL CHECK (arr_type IN ('radarr', 'sonarr')),
			preset_id      TEXT NOT NULL,
			weights_json   TEXT NOT NULL,
			engine_version TEXT NOT NULL,
			applied_at     TEXT NOT NULL,
			created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (database_id, profile_name, arr_type)
		);

		INSERT INTO quality_goal_bindings_new
			(database_id, profile_name, arr_type, preset_id, weights_json, engine_version, applied_at, created_at, updated_at)
		SELECT
			database_id, profile_name, arr_type, preset_id, weights_json, engine_version, applied_at, created_at, updated_at
		FROM quality_goal_bindings
		WHERE arr_type IN ('radarr', 'sonarr');

		DROP TABLE quality_goal_bindings;
		ALTER TABLE quality_goal_bindings_new RENAME TO quality_goal_bindings;
	`,
};
