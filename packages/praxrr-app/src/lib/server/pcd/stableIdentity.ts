import type { EntityType } from '$shared/pcd/portable.ts';

export const PORTABLE_ENTITY_STABLE_KEY_BY_TYPE: Readonly<Record<EntityType, string>> = {
  delay_profile: 'delay_profile_name',
  regular_expression: 'regular_expression_name',
  custom_format: 'custom_format_name',
  quality_profile: 'quality_profile_name',
  radarr_naming: 'radarr_naming_name',
  sonarr_naming: 'sonarr_naming_name',
  lidarr_naming: 'lidarr_naming_name',
  radarr_media_settings: 'radarr_media_settings_name',
  sonarr_media_settings: 'sonarr_media_settings_name',
  lidarr_media_settings: 'lidarr_media_settings_name',
  radarr_quality_definitions: 'radarr_quality_definitions_name',
  sonarr_quality_definitions: 'sonarr_quality_definitions_name',
  lidarr_quality_definitions: 'lidarr_quality_definitions_name',
  lidarr_metadata_profile: 'metadata_profile_name',
};

export const SQL_ENTITY_STABLE_KEY_BY_ENTITY: Readonly<Record<string, string>> = {
  ...PORTABLE_ENTITY_STABLE_KEY_BY_TYPE,
  batch: 'batch_name',
  metadata_profile: 'metadata_profile_name',
};
