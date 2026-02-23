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
import type { LidarrNamingRow, RadarrNamingRow, SonarrNamingRow, RadarrMediaSettingsRow } from './types.ts';

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
      'standardTrackFormat',
      'artistName',
      'multiDiscTrackFormat',
      'artistFolderFormat',
      'replaceIllegalCharacters',
      'colonReplacementFormat',
      'customColonReplacementFormat',
    ],
    forbiddenFields: [
      'movieFormat',
      'movieFolderFormat',
      'standardEpisodeFormat',
      'dailyEpisodeFormat',
      'animeEpisodeFormat',
      'seriesFolderFormat',
      'seasonFolderFormat',
      'multiEpisodeStyle',
    ],
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

export const LIDARR_METADATA_PROFILE_PORTABLE_ENTITIES = ['lidarr_metadata_profile'] as const;
export type LidarrMetadataProfilePortableEntityType = (typeof LIDARR_METADATA_PROFILE_PORTABLE_ENTITIES)[number];

export type PortableMigrationFormat = 'json' | 'yaml';
export const PORTABLE_MIGRATION_FORMATS = ['json', 'yaml'] as const satisfies readonly PortableMigrationFormat[];
export const PORTABLE_MIGRATION_MIN_VERSION = 1;
export const PORTABLE_MIGRATION_SOURCE_EXPORT = 'pcd-export';

/**
 * Optional migration metadata for hybrid JSON/YAML ingestion.
 *
 * Keep as runtime-facing metadata only. Existing payloads remain valid when omitted.
 */
export interface PortableMigrationMetadata {
  /** Ingestion format marker for hybrid imports/exports. */
  format: PortableMigrationFormat;
  /** Schema version marker for migration payload format compatibility checks. */
  version: number;
  /** Source marker used to distinguish migration ingestion origin. */
  source: string;
}

export interface PortableExportMetadata {
  /** Optional migration metadata included on export responses. */
  migration?: PortableMigrationMetadata;
}

function validateMigrationFormat(value: unknown): value is PortableMigrationFormat {
  if (typeof value !== 'string') {
    return false;
  }

  return (PORTABLE_MIGRATION_FORMATS as readonly string[]).includes(value);
}

function formatMigrationRequiredMessage(path: string): string {
  return `${path}.format must be one of: ${PORTABLE_MIGRATION_FORMATS.join(', ')}`;
}

export function validatePortableMigrationMetadata(migration: unknown): string | null {
  if (migration === null || typeof migration !== 'object' || Array.isArray(migration)) {
    return 'migration must be an object';
  }

  const candidate = migration as Record<string, unknown>;
  const requiredFields = ['format', 'version', 'source'] as const;

  const missingFields = requiredFields.filter((field) => !Object.hasOwn(candidate, field));
  if (missingFields.length > 0) {
    return `migration is missing required fields: ${missingFields.join(', ')}`;
  }

  const unsupportedFields = Object.keys(candidate).filter(
    (field) => !requiredFields.includes(field as (typeof requiredFields)[number])
  );
  if (unsupportedFields.length > 0) {
    return `migration contains unsupported fields: ${unsupportedFields.join(', ')}`;
  }

  if (!validateMigrationFormat(candidate.format)) {
    return formatMigrationRequiredMessage('migration');
  }

  if (
    typeof candidate.version !== 'number' ||
    !Number.isInteger(candidate.version) ||
    candidate.version < PORTABLE_MIGRATION_MIN_VERSION
  ) {
    return `migration.version must be an integer >= ${PORTABLE_MIGRATION_MIN_VERSION}`;
  }

  if (typeof candidate.source !== 'string' || candidate.source.length === 0) {
    return 'migration.source must be a non-empty string';
  }

  return null;
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
  ...LIDARR_METADATA_PROFILE_PORTABLE_ENTITIES,
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

export interface PortableMetadataProfileType {
  id: number;
  name: string;
  allowed: boolean;
}

export interface PortableLidarrMetadataProfile {
  name: string;
  description: string | null;
  primaryTypes: PortableMetadataProfileType[];
  secondaryTypes: PortableMetadataProfileType[];
  releaseStatuses: PortableMetadataProfileType[];
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

export interface PortableLidarrNaming {
  name: string;
  rename: boolean;
  standardTrackFormat: string;
  artistName: string;
  multiDiscTrackFormat: string;
  artistFolderFormat: string;
  replaceIllegalCharacters: boolean;
  colonReplacementFormat: LidarrNamingRow['colon_replacement_format'];
  customColonReplacementFormat: string | null;
}

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
