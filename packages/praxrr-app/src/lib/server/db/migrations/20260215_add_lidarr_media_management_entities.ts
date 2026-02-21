import type { Migration } from '../migrations.ts';

export const LIDARR_MEDIA_MANAGEMENT_OP_FILENAME = '20260215_add_lidarr_media_management_entities.sql';
export const LIDARR_MEDIA_MANAGEMENT_OP_VERSION = 20260215;
export const LIDARR_MEDIA_MANAGEMENT_OP_METADATA =
  '{"operation":"seed","entity":"lidarr_media_management","conflict_policy":"preserve_existing_lidarr_rows"}';

export const LIDARR_MEDIA_MANAGEMENT_OP_SQL = `
-- Add first-class Lidarr media-management entities.
CREATE TABLE IF NOT EXISTS lidarr_naming (
	name VARCHAR(100) NOT NULL PRIMARY KEY,
	rename INTEGER NOT NULL DEFAULT 1,
	standard_track_format TEXT NOT NULL,
	artist_name TEXT NOT NULL,
	multi_disc_track_format TEXT NOT NULL,
	artist_folder_format TEXT NOT NULL,
	replace_illegal_characters INTEGER NOT NULL DEFAULT 1,
	colon_replacement_format INTEGER NOT NULL DEFAULT 4,
	custom_colon_replacement_format TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lidarr_media_settings (
	name VARCHAR(100) NOT NULL PRIMARY KEY,
	propers_repacks VARCHAR(50) NOT NULL DEFAULT 'doNotPrefer'
		CHECK (propers_repacks IN ('doNotPrefer', 'preferAndUpgrade', 'doNotUpgradeAutomatically')),
	enable_media_info INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lidarr_quality_definitions (
	name VARCHAR(100) NOT NULL,
	quality_name VARCHAR(100) NOT NULL,
	min_size INTEGER NOT NULL DEFAULT 0,
	max_size INTEGER NOT NULL,
	preferred_size INTEGER NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (name, quality_name),
	FOREIGN KEY (quality_name) REFERENCES qualities(name) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Conflict semantics for legacy Sonarr-backed Lidarr rows:
-- - keep existing Lidarr rows unchanged when stable keys collide
-- - copy only rows missing in Lidarr tables
-- Legacy Sonarr format columns are mapped positionally into Lidarr naming fields.
INSERT INTO lidarr_naming (
	name,
	rename,
	standard_track_format,
	artist_name,
	multi_disc_track_format,
	artist_folder_format,
	replace_illegal_characters,
	colon_replacement_format,
	custom_colon_replacement_format,
	created_at,
	updated_at
)
SELECT
	name,
	rename,
	standard_episode_format,
	daily_episode_format,
	anime_episode_format,
	series_folder_format,
	replace_illegal_characters,
	colon_replacement_format,
	custom_colon_replacement_format,
	created_at,
	updated_at
FROM sonarr_naming
WHERE 1 = 1
ON CONFLICT(name) DO NOTHING;

INSERT INTO lidarr_media_settings (
	name,
	propers_repacks,
	enable_media_info,
	created_at,
	updated_at
)
SELECT
	name,
	propers_repacks,
	enable_media_info,
	created_at,
	updated_at
FROM sonarr_media_settings
WHERE 1 = 1
ON CONFLICT(name) DO NOTHING;

INSERT INTO lidarr_quality_definitions (
	name,
	quality_name,
	min_size,
	max_size,
	preferred_size,
	created_at,
	updated_at
)
SELECT
	name,
	quality_name,
	min_size,
	max_size,
	preferred_size,
	created_at,
	updated_at
FROM sonarr_quality_definitions
WHERE 1 = 1
ON CONFLICT(name, quality_name) DO NOTHING;

-- Seed/upgrade quality API mappings for arr_type = 'lidarr' deterministically.
-- Existing Lidarr mapping rows are updated only when api_name differs.
INSERT INTO quality_api_mappings (quality_name, arr_type, api_name, created_at)
SELECT quality_name, 'lidarr', api_name, created_at
FROM quality_api_mappings
WHERE arr_type = 'sonarr'
ON CONFLICT(quality_name, arr_type) DO UPDATE SET
	api_name = excluded.api_name
WHERE quality_api_mappings.api_name <> excluded.api_name;
`;

const LIDARR_MEDIA_MANAGEMENT_OP_SQL_ESCAPED = LIDARR_MEDIA_MANAGEMENT_OP_SQL.replaceAll("'", "''");

export const migration: Migration = {
  version: LIDARR_MEDIA_MANAGEMENT_OP_VERSION,
  name: 'Add Lidarr media-management entities',

  up: `
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
			'${LIDARR_MEDIA_MANAGEMENT_OP_FILENAME}',
			${LIDARR_MEDIA_MANAGEMENT_OP_VERSION},
			${LIDARR_MEDIA_MANAGEMENT_OP_VERSION},
			'${LIDARR_MEDIA_MANAGEMENT_OP_SQL_ESCAPED}',
			'${LIDARR_MEDIA_MANAGEMENT_OP_METADATA}'
		FROM database_instances di
		WHERE NOT EXISTS (
			SELECT 1
			FROM pcd_ops po
			WHERE po.database_id = di.id
				AND po.origin = 'base'
				AND po.filename = '${LIDARR_MEDIA_MANAGEMENT_OP_FILENAME}'
		);
	`,

  down: `
		DELETE FROM pcd_ops
		WHERE origin = 'base'
			AND source = 'local'
			AND filename = '${LIDARR_MEDIA_MANAGEMENT_OP_FILENAME}';
	`,
};
