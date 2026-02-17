import type { Migration } from '../migrations.ts';

export const LIDARR_DEFAULT_METADATA_PROFILE_OP_FILENAME =
  '20260219_seed_default_lidarr_metadata_profiles.sql';
export const LIDARR_DEFAULT_METADATA_PROFILE_OP_VERSION = 20260219;
export const LIDARR_DEFAULT_METADATA_PROFILE_OP_METADATA =
  '{"operation":"seed","entity":"lidarr_metadata_profiles","conflict_policy":"preserve_existing_lidarr_metadata_profiles"}';

const DEFAULT_PROFILE_NAME = 'Lidarr';
const DEFAULT_PROFILE_DESCRIPTION = 'Default Lidarr metadata profile';

function toSqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const DEFAULT_PROFILE_NAME_SQL = toSqlStringLiteral(DEFAULT_PROFILE_NAME);
const DEFAULT_PROFILE_DESCRIPTION_SQL = toSqlStringLiteral(DEFAULT_PROFILE_DESCRIPTION);

export const LIDARR_DEFAULT_METADATA_PROFILE_OP_SQL = `
INSERT INTO lidarr_metadata_profiles (name, description)
VALUES (${DEFAULT_PROFILE_NAME_SQL}, ${DEFAULT_PROFILE_DESCRIPTION_SQL})
ON CONFLICT(name) DO NOTHING;

INSERT INTO lidarr_metadata_profile_primary_types (
	metadata_profile_name,
	type_id,
	name,
	allowed
)
VALUES
	(${DEFAULT_PROFILE_NAME_SQL}, 0, 'Album', 1),
	(${DEFAULT_PROFILE_NAME_SQL}, 1, 'EP', 0),
	(${DEFAULT_PROFILE_NAME_SQL}, 2, 'Single', 0),
	(${DEFAULT_PROFILE_NAME_SQL}, 3, 'Broadcast', 0),
	(${DEFAULT_PROFILE_NAME_SQL}, 4, 'Other', 0)
ON CONFLICT(metadata_profile_name, type_id) DO NOTHING;

INSERT INTO lidarr_metadata_profile_secondary_types (
	metadata_profile_name,
	type_id,
	name,
	allowed
)
VALUES
	(${DEFAULT_PROFILE_NAME_SQL}, 0, 'Studio', 1),
	(${DEFAULT_PROFILE_NAME_SQL}, 1, 'Compilation', 0),
	(${DEFAULT_PROFILE_NAME_SQL}, 2, 'Soundtrack', 0),
	(${DEFAULT_PROFILE_NAME_SQL}, 3, 'Spokenword', 0),
	(${DEFAULT_PROFILE_NAME_SQL}, 4, 'Interview', 0),
	(${DEFAULT_PROFILE_NAME_SQL}, 6, 'Live', 0),
	(${DEFAULT_PROFILE_NAME_SQL}, 7, 'Remix', 0),
	(${DEFAULT_PROFILE_NAME_SQL}, 8, 'DJ-mix', 0),
	(${DEFAULT_PROFILE_NAME_SQL}, 9, 'Mixtape/Street', 0),
	(${DEFAULT_PROFILE_NAME_SQL}, 10, 'Demo', 0),
	(${DEFAULT_PROFILE_NAME_SQL}, 11, 'Audio drama', 0)
ON CONFLICT(metadata_profile_name, type_id) DO NOTHING;

INSERT INTO lidarr_metadata_profile_release_statuses (
	metadata_profile_name,
	status_id,
	name,
	allowed
)
VALUES
	(${DEFAULT_PROFILE_NAME_SQL}, 0, 'Official', 1),
	(${DEFAULT_PROFILE_NAME_SQL}, 1, 'Promotion', 0),
	(${DEFAULT_PROFILE_NAME_SQL}, 2, 'Bootleg', 0),
	(${DEFAULT_PROFILE_NAME_SQL}, 3, 'Pseudo-Release', 0)
ON CONFLICT(metadata_profile_name, status_id) DO NOTHING;
`;

const LIDARR_DEFAULT_METADATA_PROFILE_OP_SQL_ESCAPED =
  LIDARR_DEFAULT_METADATA_PROFILE_OP_SQL.replaceAll("'", "''");

export const migration: Migration = {
	version: LIDARR_DEFAULT_METADATA_PROFILE_OP_VERSION,
	name: 'Seed default Lidarr metadata profile',

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
		'${LIDARR_DEFAULT_METADATA_PROFILE_OP_FILENAME}',
		${LIDARR_DEFAULT_METADATA_PROFILE_OP_VERSION},
		${LIDARR_DEFAULT_METADATA_PROFILE_OP_VERSION},
		'${LIDARR_DEFAULT_METADATA_PROFILE_OP_SQL_ESCAPED}',
		'${LIDARR_DEFAULT_METADATA_PROFILE_OP_METADATA}'
	FROM database_instances di
	WHERE NOT EXISTS (
		SELECT 1
		FROM pcd_ops po
		WHERE po.database_id = di.id
			AND po.origin = 'base'
			AND po.filename = '${LIDARR_DEFAULT_METADATA_PROFILE_OP_FILENAME}'
	);
	`,

	down: `
		DELETE FROM pcd_ops
		WHERE origin = 'base'
			AND source = 'local'
			AND filename = '${LIDARR_DEFAULT_METADATA_PROFILE_OP_FILENAME}';
	`,
};
