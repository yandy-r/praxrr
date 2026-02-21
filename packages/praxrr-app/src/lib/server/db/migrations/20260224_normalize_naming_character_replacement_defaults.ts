import type { Migration } from '../migrations.ts';

export const NAMING_CHARACTER_REPLACEMENT_DEFAULTS_OP_FILENAME =
  '20260224_normalize_naming_character_replacement_defaults.sql';
export const NAMING_CHARACTER_REPLACEMENT_DEFAULTS_OP_VERSION = 20260224;
export const NAMING_CHARACTER_REPLACEMENT_DEFAULTS_OP_METADATA =
  '{"operation":"seed","entity":"naming","conflict_policy":"normalize_default_naming_character_replacement"}';

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
WHERE lower(name) IN ('default', 'lidarr', 'sonarr');
`;

const NAMING_CHARACTER_REPLACEMENT_DEFAULTS_OP_SQL_ESCAPED =
  NAMING_CHARACTER_REPLACEMENT_DEFAULTS_OP_SQL.replaceAll("'", "''");

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
