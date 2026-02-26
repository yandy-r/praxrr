import type { Migration } from '../migrations.ts';

/** Filename of the PCD built-in base op SQL file for normalizing naming character replacement defaults. */
export const NAMING_CHARACTER_REPLACEMENT_DEFAULTS_OP_FILENAME =
  '20260224_normalize_naming_character_replacement_defaults.sql';
/** Migration version number for the naming character replacement defaults PCD built-in base op. */
export const NAMING_CHARACTER_REPLACEMENT_DEFAULTS_OP_VERSION = 20260224;
/** JSON metadata string for the naming character replacement defaults PCD built-in base op. */
export const NAMING_CHARACTER_REPLACEMENT_DEFAULTS_OP_METADATA =
  '{"operation":"seed","entity":"naming","conflict_policy":"normalize_default_naming_character_replacement"}';

/** SQL content of the naming character replacement defaults PCD built-in base op. */
export const NAMING_CHARACTER_REPLACEMENT_DEFAULTS_OP_SQL = `
-- Normalize Radarr naming defaults to replace illegal characters + smart colon replacement.
UPDATE radarr_naming
SET
  replace_illegal_characters = 1,
  colon_replacement_format = 'smart',
  updated_at = CURRENT_TIMESTAMP
WHERE lower(name) IN ('default', 'radarr');

-- Normalize Sonarr naming defaults to replace illegal characters + smart colon replacement.
UPDATE sonarr_naming
SET
  replace_illegal_characters = 1,
  colon_replacement_format = 4,
  custom_colon_replacement_format = NULL,
  updated_at = CURRENT_TIMESTAMP
WHERE lower(name) IN ('default', 'sonarr');

-- Normalize Lidarr naming defaults to replace illegal characters + smart colon replacement.
UPDATE lidarr_naming
SET
  replace_illegal_characters = 1,
  colon_replacement_format = 4,
  custom_colon_replacement_format = NULL,
  updated_at = CURRENT_TIMESTAMP
-- Legacy onboarding can leave Lidarr defaults with sonarr profile names.
WHERE lower(name) IN ('default', 'lidarr', 'sonarr');
`;

const NAMING_CHARACTER_REPLACEMENT_DEFAULTS_OP_SQL_ESCAPED = NAMING_CHARACTER_REPLACEMENT_DEFAULTS_OP_SQL.replaceAll(
  "'",
  "''"
);

/** Database migration: Normalize Radarr naming character replacement defaults as a PCD built-in base op. */
export const migration: Migration = {
  version: NAMING_CHARACTER_REPLACEMENT_DEFAULTS_OP_VERSION,
  name: 'Normalize naming character replacement defaults',

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
      '${NAMING_CHARACTER_REPLACEMENT_DEFAULTS_OP_FILENAME}',
      ${NAMING_CHARACTER_REPLACEMENT_DEFAULTS_OP_VERSION},
      ${NAMING_CHARACTER_REPLACEMENT_DEFAULTS_OP_VERSION},
      '${NAMING_CHARACTER_REPLACEMENT_DEFAULTS_OP_SQL_ESCAPED}',
      '${NAMING_CHARACTER_REPLACEMENT_DEFAULTS_OP_METADATA}'
    FROM database_instances di
    WHERE NOT EXISTS (
      SELECT 1
      FROM pcd_ops po
      WHERE po.database_id = di.id
        AND po.origin = 'base'
        AND po.filename = '${NAMING_CHARACTER_REPLACEMENT_DEFAULTS_OP_FILENAME}'
    );
  `,

  down: `
    DELETE FROM pcd_ops
    WHERE origin = 'base'
      AND source = 'local'
      AND filename = '${NAMING_CHARACTER_REPLACEMENT_DEFAULTS_OP_FILENAME}';
  `,
};
