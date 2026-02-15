/**
 * Portable Entity Types
 *
 * JSON-friendly representations of PCD entities for serialize/deserialize.
 * No database IDs, no timestamps, no Generated<T> wrappers.
 *
 * These are the wire format for:
 * - Clone (serialize → rename → deserialize)
 * - Import/Export (future)
 *
 * Field names use camelCase to match existing create input interfaces,
 * so portable types can be passed directly as create function inputs.
 */

import type { ConditionData, OrderedItem, QualityDefinitionEntry } from './display.ts';
import type { PreferredProtocol } from './display.ts';
import type { RadarrNamingRow, SonarrNamingRow, RadarrMediaSettingsRow } from './types.ts';

type LidarrPortableValidationEntityType = 'sonarr_naming' | 'sonarr_media_settings' | 'sonarr_quality_definitions';

type LidarrPortableLegacyAliasEntityType =
  | 'sonarr_naming'
  | 'radarr_media_settings'
  | 'sonarr_media_settings'
  | 'radarr_quality_definitions'
  | 'sonarr_quality_definitions';

export const LIDARR_MEDIA_MANAGEMENT_PORTABLE_ENTITIES = [
  'lidarr_naming',
  'lidarr_media_settings',
  'lidarr_quality_definitions',
] as const;

export type LidarrMediaManagementPortableEntityType = (typeof LIDARR_MEDIA_MANAGEMENT_PORTABLE_ENTITIES)[number];

interface LidarrMediaManagementPortableEntry {
  reusableEntityType: LidarrPortableValidationEntityType;
  legacyAliasEntityTypes?: readonly LidarrPortableLegacyAliasEntityType[];
  requiredFields: readonly string[];
  forbiddenFields?: readonly string[];
}

export const LIDARR_MEDIA_MANAGEMENT_PORTABLE_MATRIX: Record<
  LidarrMediaManagementPortableEntityType,
  LidarrMediaManagementPortableEntry
> = {
  lidarr_naming: {
    reusableEntityType: 'sonarr_naming',
    legacyAliasEntityTypes: ['sonarr_naming'],
    requiredFields: [
      'name',
      'rename',
      'standardEpisodeFormat',
      'dailyEpisodeFormat',
      'animeEpisodeFormat',
      'seriesFolderFormat',
      'seasonFolderFormat',
      'replaceIllegalCharacters',
      'colonReplacementFormat',
      'customColonReplacementFormat',
      'multiEpisodeStyle',
    ],
    forbiddenFields: ['movieFormat', 'movieFolderFormat'],
  },
  lidarr_media_settings: {
    reusableEntityType: 'sonarr_media_settings',
    legacyAliasEntityTypes: ['radarr_media_settings', 'sonarr_media_settings'],
    requiredFields: ['name', 'propersRepacks', 'enableMediaInfo'],
  },
  lidarr_quality_definitions: {
    reusableEntityType: 'sonarr_quality_definitions',
    legacyAliasEntityTypes: ['radarr_quality_definitions', 'sonarr_quality_definitions'],
    requiredFields: ['name', 'entries'],
  },
} as const;

export function isLidarrMediaManagementPortableEntityType(
  entityType: string
): entityType is LidarrMediaManagementPortableEntityType {
  return (LIDARR_MEDIA_MANAGEMENT_PORTABLE_ENTITIES as readonly string[]).includes(entityType);
}

export function getLidarrMediaManagementPortableEntry(entityType: EntityType) {
  if (!isLidarrMediaManagementPortableEntityType(entityType)) {
    return null;
  }

  return LIDARR_MEDIA_MANAGEMENT_PORTABLE_MATRIX[entityType];
}

// ============================================================================
// ENTITY TYPE ENUM
// ============================================================================

export const ENTITY_TYPES = [
  'delay_profile',
  'regular_expression',
  'custom_format',
  'quality_profile',
  'radarr_naming',
  'sonarr_naming',
  'radarr_media_settings',
  'sonarr_media_settings',
  'radarr_quality_definitions',
  'sonarr_quality_definitions',
  ...LIDARR_MEDIA_MANAGEMENT_PORTABLE_ENTITIES,
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

// ============================================================================
// SIMPLE ENTITIES
// ============================================================================

export interface PortableDelayProfile {
  name: string;
  preferredProtocol: PreferredProtocol;
  usenetDelay: number;
  torrentDelay: number;
  bypassIfHighestQuality: boolean;
  bypassIfAboveCfScore: boolean;
  minimumCfScore: number;
}

// ============================================================================
// TAGGED ENTITIES
// ============================================================================

export interface PortableRegularExpression {
  name: string;
  pattern: string;
  tags: string[];
  description: string | null;
  regex101Id: string | null;
}

// ============================================================================
// COMPOUND ENTITIES
// ============================================================================

export interface PortableCustomFormatTest {
  title: string;
  type: 'movie' | 'series';
  shouldMatch: boolean;
  description: string | null;
}

export interface PortableCustomFormat {
  name: string;
  description: string | null;
  includeInRename: boolean;
  tags: string[];
  conditions: ConditionData[];
  tests: PortableCustomFormatTest[];
}

export interface PortableCustomFormatScore {
  customFormatName: string;
  arrType: string;
  score: number;
}

export interface PortableQualityProfile {
  name: string;
  description: string | null;
  tags: string[];
  language: string | null;
  orderedItems: OrderedItem[];
  minimumScore: number;
  upgradeUntilScore: number;
  upgradeScoreIncrement: number;
  customFormatScores: PortableCustomFormatScore[];
}

// ============================================================================
// MEDIA MANAGEMENT
// ============================================================================

// Naming

export interface PortableRadarrNaming {
  name: string;
  rename: boolean;
  movieFormat: string;
  movieFolderFormat: string;
  replaceIllegalCharacters: boolean;
  colonReplacementFormat: RadarrNamingRow['colon_replacement_format'];
}

export interface PortableSonarrNaming {
  name: string;
  rename: boolean;
  standardEpisodeFormat: string;
  dailyEpisodeFormat: string;
  animeEpisodeFormat: string;
  seriesFolderFormat: string;
  seasonFolderFormat: string;
  replaceIllegalCharacters: boolean;
  colonReplacementFormat: SonarrNamingRow['colon_replacement_format'];
  customColonReplacementFormat: string | null;
  multiEpisodeStyle: SonarrNamingRow['multi_episode_style'];
}

export type PortableLidarrNaming = PortableSonarrNaming;

// Media Settings

export interface PortableMediaSettings {
  name: string;
  propersRepacks: RadarrMediaSettingsRow['propers_repacks'];
  enableMediaInfo: boolean;
}

export type PortableLidarrMediaSettings = PortableMediaSettings;

// Quality Definitions

export interface PortableQualityDefinitions {
  name: string;
  entries: QualityDefinitionEntry[];
}

export type PortableLidarrQualityDefinitions = PortableQualityDefinitions;
