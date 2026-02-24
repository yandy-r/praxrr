import type { Migration } from '../migrations.ts';

export const migration: Migration = {
  version: 20260225,
  name: 'Remove embedded Lidarr built-in seed ops',

  up: `
    DELETE FROM pcd_ops
    WHERE origin = 'base'
      AND source = 'local'
      AND filename IN (
        '20260215_add_lidarr_media_management_entities.sql',
        '20260216_enforce_native_lidarr_quality_mappings.sql',
        '20260217_set_lidarr_naming_defaults.sql',
        '20260218_add_lidarr_metadata_profiles.sql',
        '20260219_seed_default_lidarr_metadata_profiles.sql',
        '20260224_normalize_naming_character_replacement_defaults.sql'
      );
  `,
};
