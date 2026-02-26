import type { Migration } from '../migrations.ts';

/** Filename of the PCD built-in base op SQL file for Lidarr naming defaults. */
export const LIDARR_NAMING_DEFAULTS_OP_FILENAME = '20260217_set_lidarr_naming_defaults.sql';
/** Migration version number for the Lidarr naming defaults PCD built-in base op. */
export const LIDARR_NAMING_DEFAULTS_OP_VERSION = 20260217;
/** JSON metadata string for the Lidarr naming defaults PCD built-in base op. */
export const LIDARR_NAMING_DEFAULTS_OP_METADATA =
  '{"operation":"seed","entity":"lidarr_naming","conflict_policy":"set_native_default_templates"}';

const LIDARR_DEFAULT_STANDARD_TRACK_FORMAT =
  '{Artist Name} - {Album Type} - {Album Title}  - {(Album Disambiguation)}/{Artist Name}_{Album Title}_{track:00}_{Track Title}';
const LIDARR_DEFAULT_ARTIST_NAME = '{Artist Name}';
const LIDARR_DEFAULT_MULTI_DISC_TRACK_FORMAT =
  '{Artist Name} - {Album Type} - {Album Title}  - {(Album Disambiguation)}/{Artist Name}_{Album Title}_{medium:00}-{track:00}_{Track Title}';
const LIDARR_DEFAULT_ARTIST_FOLDER_FORMAT = '{Artist Name} ({Artist MbId})';

function toSqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const LIDARR_DEFAULT_STANDARD_TRACK_FORMAT_SQL = toSqlStringLiteral(LIDARR_DEFAULT_STANDARD_TRACK_FORMAT);
const LIDARR_DEFAULT_ARTIST_NAME_SQL = toSqlStringLiteral(LIDARR_DEFAULT_ARTIST_NAME);
const LIDARR_DEFAULT_MULTI_DISC_TRACK_FORMAT_SQL = toSqlStringLiteral(LIDARR_DEFAULT_MULTI_DISC_TRACK_FORMAT);
const LIDARR_DEFAULT_ARTIST_FOLDER_FORMAT_SQL = toSqlStringLiteral(LIDARR_DEFAULT_ARTIST_FOLDER_FORMAT);

/** SQL content of the Lidarr naming defaults PCD built-in base op. */
export const LIDARR_NAMING_DEFAULTS_OP_SQL = `
-- Normalize legacy Sonarr alias to Lidarr naming row if still present.
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
  'Lidarr',
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
FROM lidarr_naming
WHERE name = 'Sonarr'
ON CONFLICT(name) DO NOTHING;

DELETE FROM lidarr_naming
WHERE name = 'Sonarr';

-- Seed Lidarr default naming template when absent.
INSERT INTO lidarr_naming (
  name,
  rename,
  standard_track_format,
  artist_name,
  multi_disc_track_format,
  artist_folder_format,
  replace_illegal_characters,
  colon_replacement_format,
  custom_colon_replacement_format
)
VALUES (
  'Lidarr',
  1,
  ${LIDARR_DEFAULT_STANDARD_TRACK_FORMAT_SQL},
  ${LIDARR_DEFAULT_ARTIST_NAME_SQL},
  ${LIDARR_DEFAULT_MULTI_DISC_TRACK_FORMAT_SQL},
  ${LIDARR_DEFAULT_ARTIST_FOLDER_FORMAT_SQL},
  1,
  4,
  NULL
)
ON CONFLICT(name) DO NOTHING;

-- If the Lidarr default row still contains Sonarr-derived episode/series patterns,
-- replace only those legacy values with native Lidarr templates.
UPDATE lidarr_naming
SET
  standard_track_format = ${LIDARR_DEFAULT_STANDARD_TRACK_FORMAT_SQL},
  artist_name = ${LIDARR_DEFAULT_ARTIST_NAME_SQL},
  multi_disc_track_format = ${LIDARR_DEFAULT_MULTI_DISC_TRACK_FORMAT_SQL},
  artist_folder_format = ${LIDARR_DEFAULT_ARTIST_FOLDER_FORMAT_SQL},
  updated_at = CURRENT_TIMESTAMP
WHERE name = 'Lidarr'
  AND (
    standard_track_format LIKE '%{Series TitleYear}%'
    OR standard_track_format LIKE '%S{season:00}E{episode:00}%'
    OR multi_disc_track_format LIKE '%{Series TitleYear}%'
    OR multi_disc_track_format LIKE '%S{season:00}E{episode:00}%'
    OR artist_folder_format LIKE '%{tvdb-%}%'
  );
`;

const LIDARR_NAMING_DEFAULTS_OP_SQL_ESCAPED = LIDARR_NAMING_DEFAULTS_OP_SQL.replaceAll("'", "''");

/** Database migration: Set Lidarr naming default templates as a PCD built-in base op. */
export const migration: Migration = {
  version: LIDARR_NAMING_DEFAULTS_OP_VERSION,
  name: 'Set Lidarr naming defaults',

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
      '${LIDARR_NAMING_DEFAULTS_OP_FILENAME}',
      ${LIDARR_NAMING_DEFAULTS_OP_VERSION},
      ${LIDARR_NAMING_DEFAULTS_OP_VERSION},
      '${LIDARR_NAMING_DEFAULTS_OP_SQL_ESCAPED}',
      '${LIDARR_NAMING_DEFAULTS_OP_METADATA}'
    FROM database_instances di
    WHERE NOT EXISTS (
      SELECT 1
      FROM pcd_ops po
      WHERE po.database_id = di.id
        AND po.origin = 'base'
        AND po.filename = '${LIDARR_NAMING_DEFAULTS_OP_FILENAME}'
    );
  `,

  down: `
    DELETE FROM pcd_ops
    WHERE origin = 'base'
      AND source = 'local'
      AND filename = '${LIDARR_NAMING_DEFAULTS_OP_FILENAME}';
  `,
};
