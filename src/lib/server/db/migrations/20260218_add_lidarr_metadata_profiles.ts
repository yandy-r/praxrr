import type { Migration } from '../migrations.ts';

export const LIDARR_METADATA_PROFILES_OP_FILENAME = '20260218_add_lidarr_metadata_profiles.sql';
export const LIDARR_METADATA_PROFILES_OP_VERSION = 20260218;
export const LIDARR_METADATA_PROFILES_OP_METADATA =
  '{"operation":"seed","entity":"lidarr_metadata_profiles","conflict_policy":"preserve_existing_lidarr_metadata_profiles"}';

export const LIDARR_METADATA_PROFILES_OP_SQL = `
-- Add first-class Lidarr metadata-profile entities.
CREATE TABLE IF NOT EXISTS lidarr_metadata_profiles (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name VARCHAR(100) NOT NULL UNIQUE,
	description TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lidarr_metadata_profile_primary_types (
	metadata_profile_name VARCHAR(100) NOT NULL,
	type_id INTEGER NOT NULL,
	name VARCHAR(100) NOT NULL,
	allowed INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (metadata_profile_name, type_id),
	FOREIGN KEY (metadata_profile_name) REFERENCES lidarr_metadata_profiles(name) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS lidarr_metadata_profile_secondary_types (
	metadata_profile_name VARCHAR(100) NOT NULL,
	type_id INTEGER NOT NULL,
	name VARCHAR(100) NOT NULL,
	allowed INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (metadata_profile_name, type_id),
	FOREIGN KEY (metadata_profile_name) REFERENCES lidarr_metadata_profiles(name) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS lidarr_metadata_profile_release_statuses (
	metadata_profile_name VARCHAR(100) NOT NULL,
	status_id INTEGER NOT NULL,
	name VARCHAR(100) NOT NULL,
	allowed INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (metadata_profile_name, status_id),
	FOREIGN KEY (metadata_profile_name) REFERENCES lidarr_metadata_profiles(name) ON DELETE CASCADE ON UPDATE CASCADE
);
`;

const LIDARR_METADATA_PROFILES_OP_SQL_ESCAPED = LIDARR_METADATA_PROFILES_OP_SQL.replaceAll("'", "''");

export const migration: Migration = {
	version: LIDARR_METADATA_PROFILES_OP_VERSION,
	name: 'Add Lidarr metadata profiles',

	up: `
		CREATE TABLE arr_sync_metadata_profiles_config (
			instance_id INTEGER PRIMARY KEY,
			trigger TEXT NOT NULL DEFAULT 'none',
			cron TEXT,
			should_sync INTEGER NOT NULL DEFAULT 0,
			next_run_at TEXT,
			database_id INTEGER,
			profile_name TEXT,
			sync_status TEXT NOT NULL DEFAULT 'idle',
			last_error TEXT,
			last_synced_at TEXT,
			FOREIGN KEY (instance_id) REFERENCES arr_instances(id) ON DELETE CASCADE,
			FOREIGN KEY (database_id) REFERENCES database_instances(id) ON DELETE SET NULL
		);

		INSERT INTO pcd_ops (
			database_id,
			origin,
			state,
			source,
			filename,
			op_number,
			sequence,
			sql,
			metadata
		)
		SELECT
			di.id,
			'base',
			'published',
			'local',
			'${LIDARR_METADATA_PROFILES_OP_FILENAME}',
			${LIDARR_METADATA_PROFILES_OP_VERSION},
			${LIDARR_METADATA_PROFILES_OP_VERSION},
			'${LIDARR_METADATA_PROFILES_OP_SQL_ESCAPED}',
			'${LIDARR_METADATA_PROFILES_OP_METADATA}'
		FROM database_instances di
		WHERE NOT EXISTS (
			SELECT 1
			FROM pcd_ops po
			WHERE po.database_id = di.id
				AND po.origin = 'base'
				AND po.filename = '${LIDARR_METADATA_PROFILES_OP_FILENAME}'
		);
	`,

	down: `
		DROP TABLE IF EXISTS arr_sync_metadata_profiles_config;
		DELETE FROM pcd_ops
			WHERE origin = 'base'
				AND source = 'local'
				AND filename = '${LIDARR_METADATA_PROFILES_OP_FILENAME}';
	`,
};
