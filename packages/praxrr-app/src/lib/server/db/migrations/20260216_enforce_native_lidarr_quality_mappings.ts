import type { Migration } from '../migrations.ts';

/** Filename of the PCD built-in base op SQL file for Lidarr native quality mappings. */
export const LIDARR_NATIVE_QUALITY_MAPPINGS_OP_FILENAME = '20260216_enforce_native_lidarr_quality_mappings.sql';
/** Migration version number for the Lidarr native quality mappings PCD built-in base op. */
export const LIDARR_NATIVE_QUALITY_MAPPINGS_OP_VERSION = 20260216;
/** JSON metadata string for the Lidarr native quality mappings PCD built-in base op. */
export const LIDARR_NATIVE_QUALITY_MAPPINGS_OP_METADATA =
  '{"operation":"seed","entity":"lidarr_media_management","conflict_policy":"enforce_native_lidarr_contracts"}';

const LIDARR_NATIVE_QUALITY_API_NAMES = [
  'Unknown',
  'MP3-192',
  'MP3-VBR-V0',
  'MP3-256',
  'MP3-320',
  'MP3-160',
  'FLAC',
  'ALAC',
  'MP3-VBR-V2',
  'AAC-192',
  'AAC-256',
  'AAC-320',
  'AAC-VBR',
  'WAV',
  'OGG Vorbis Q10',
  'OGG Vorbis Q9',
  'OGG Vorbis Q8',
  'OGG Vorbis Q7',
  'OGG Vorbis Q6',
  'OGG Vorbis Q5',
  'WMA',
  'FLAC 24bit',
  'MP3-128',
  'MP3-96',
  'MP3-80',
  'MP3-64',
  'MP3-56',
  'MP3-48',
  'MP3-40',
  'MP3-32',
  'MP3-24',
  'MP3-16',
  'MP3-8',
  'MP3-112',
  'MP3-224',
  'APE',
  'WavPack',
  'ALAC 24bit',
] as const;

function toSqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const LIDARR_NATIVE_QUALITY_NAMES_LIST_SQL = LIDARR_NATIVE_QUALITY_API_NAMES.map(toSqlStringLiteral).join(', ');
const LIDARR_NATIVE_QUALITY_NAMES_VALUES_SQL = LIDARR_NATIVE_QUALITY_API_NAMES.map(
  (qualityName) => `(${toSqlStringLiteral(qualityName)})`
).join(',\n');

/** SQL content of the Lidarr native quality mappings PCD built-in base op. */
export const LIDARR_NATIVE_QUALITY_MAPPINGS_OP_SQL = `
-- Enforce native Lidarr media-management contracts.
-- 1) Ensure canonical Lidarr quality names exist.
INSERT INTO qualities (name)
VALUES
${LIDARR_NATIVE_QUALITY_NAMES_VALUES_SQL}
ON CONFLICT(name) DO NOTHING;

-- 2) Remove non-native Lidarr mappings introduced by legacy Sonarr reuse.
DELETE FROM quality_api_mappings
WHERE arr_type = 'lidarr'
  AND (
    quality_name NOT IN (${LIDARR_NATIVE_QUALITY_NAMES_LIST_SQL})
    OR api_name NOT IN (${LIDARR_NATIVE_QUALITY_NAMES_LIST_SQL})
  );

-- 3) Upsert native Lidarr quality mappings (quality_name == api_name).
INSERT INTO quality_api_mappings (quality_name, arr_type, api_name, created_at)
SELECT q.name, 'lidarr', q.name, CURRENT_TIMESTAMP
FROM qualities q
WHERE q.name IN (${LIDARR_NATIVE_QUALITY_NAMES_LIST_SQL})
ON CONFLICT(quality_name, arr_type) DO UPDATE SET
  api_name = excluded.api_name
WHERE quality_api_mappings.api_name <> excluded.api_name;

-- 4) Normalize legacy Sonarr-named Lidarr defaults to native Lidarr defaults.
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

INSERT INTO lidarr_media_settings (
  name,
  propers_repacks,
  enable_media_info,
  created_at,
  updated_at
)
SELECT
  'Lidarr',
  propers_repacks,
  enable_media_info,
  created_at,
  updated_at
FROM lidarr_media_settings
WHERE name = 'Sonarr'
ON CONFLICT(name) DO NOTHING;

DELETE FROM lidarr_media_settings
WHERE name = 'Sonarr';

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
  'Lidarr',
  quality_name,
  min_size,
  max_size,
  preferred_size,
  created_at,
  updated_at
FROM lidarr_quality_definitions
WHERE name = 'Sonarr'
ON CONFLICT(name, quality_name) DO NOTHING;

DELETE FROM lidarr_quality_definitions
WHERE name = 'Sonarr';

-- 5) Keep only native Lidarr quality rows and seed default Lidarr config if missing.
DELETE FROM lidarr_quality_definitions
WHERE quality_name NOT IN (${LIDARR_NATIVE_QUALITY_NAMES_LIST_SQL});

INSERT INTO lidarr_quality_definitions (name, quality_name, min_size, max_size, preferred_size)
SELECT
  'Lidarr',
  quality_name,
  0,
  1000,
  990
FROM quality_api_mappings
WHERE arr_type = 'lidarr'
ON CONFLICT(name, quality_name) DO NOTHING;
`;

const LIDARR_NATIVE_QUALITY_MAPPINGS_OP_SQL_ESCAPED = LIDARR_NATIVE_QUALITY_MAPPINGS_OP_SQL.replaceAll("'", "''");

/** Database migration: Enforce native Lidarr quality mappings as a PCD built-in base op. */
export const migration: Migration = {
  version: LIDARR_NATIVE_QUALITY_MAPPINGS_OP_VERSION,
  name: 'Enforce native Lidarr quality mappings',

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
      '${LIDARR_NATIVE_QUALITY_MAPPINGS_OP_FILENAME}',
      ${LIDARR_NATIVE_QUALITY_MAPPINGS_OP_VERSION},
      ${LIDARR_NATIVE_QUALITY_MAPPINGS_OP_VERSION},
      '${LIDARR_NATIVE_QUALITY_MAPPINGS_OP_SQL_ESCAPED}',
      '${LIDARR_NATIVE_QUALITY_MAPPINGS_OP_METADATA}'
    FROM database_instances di
    WHERE NOT EXISTS (
      SELECT 1
      FROM pcd_ops po
      WHERE po.database_id = di.id
        AND po.origin = 'base'
        AND po.filename = '${LIDARR_NATIVE_QUALITY_MAPPINGS_OP_FILENAME}'
    );
  `,

  down: `
    DELETE FROM pcd_ops
    WHERE origin = 'base'
      AND source = 'local'
      AND filename = '${LIDARR_NATIVE_QUALITY_MAPPINGS_OP_FILENAME}';
  `,
};
