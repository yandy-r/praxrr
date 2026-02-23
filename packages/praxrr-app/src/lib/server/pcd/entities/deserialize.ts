/**
 * Entity Deserialization
 *
 * Creates entities from portable format by calling existing PCD create functions.
 * Used by clone (serialize → rename → deserialize) and import.
 */

import type { PCDCache } from '$pcd/index.ts';
import { getCache, type OperationLayer } from '$pcd/index.ts';
import type {
  PortableDelayProfile,
  PortableRegularExpression,
  PortableCustomFormat,
  PortableQualityProfile,
  PortableLidarrNaming,
  PortableLidarrMediaSettings,
  PortableLidarrMetadataProfile,
  PortableRadarrNaming,
  PortableSonarrNaming,
  PortableMediaSettings,
  PortableQualityDefinitions,
  PortableLidarrQualityDefinitions,
} from '$shared/pcd/portable.ts';
import * as delayProfileQueries from './delayProfiles/index.ts';
import * as regexQueries from './regularExpressions/index.ts';
import * as cfQueries from './customFormats/index.ts';
import * as qpQueries from './qualityProfiles/index.ts';
import * as namingQueries from './mediaManagement/naming/index.ts';
import * as mediaSettingsQueries from './mediaManagement/media-settings/index.ts';
import * as qualityDefsQueries from './mediaManagement/quality-definitions/index.ts';
import * as metadataProfilesQueries from './metadataProfiles/index.ts';
import { createLidarrNaming } from './mediaManagement/naming/create.ts';
import type { EntityType } from '$shared/pcd/portable.ts';

interface LidarrMetadataProfileTypeRow {
  id?: number;
  typeId?: number;
  statusId?: number;
  name?: string;
  allowed?: boolean;
}

type MetadataProfileSectionKind = 'primary' | 'secondary' | 'status';

// ============================================================================
// COMMON OPTIONS
// ============================================================================

interface DeserializeOptions<T> {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  portable: T;
}

export interface EntityDeserializerOptions {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  data: unknown;
}

export type EntityDeserializer = (options: EntityDeserializerOptions) => Promise<unknown>;

export interface DeserializeByEntityTypeOptions extends EntityDeserializerOptions {
  entityType: EntityType;
}

const ENTITY_DESERIALIZERS: Record<EntityType, EntityDeserializer> = {
  delay_profile: (options) => {
    return deserializeDelayProfile({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableDelayProfile>(options.data),
    });
  },
  regular_expression: (options) => {
    return deserializeRegularExpression({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableRegularExpression>(options.data),
    });
  },
  custom_format: (options) => {
    return deserializeCustomFormat({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableCustomFormat>(options.data),
    });
  },
  quality_profile: (options) => {
    return deserializeQualityProfile({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableQualityProfile>(options.data),
    });
  },
  radarr_naming: (options) => {
    return deserializeRadarrNaming({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableRadarrNaming>(options.data),
    });
  },
  sonarr_naming: (options) => {
    return deserializeSonarrNaming({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableSonarrNaming>(options.data),
    });
  },
  lidarr_naming: (options) => {
    return deserializeLidarrNaming({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableLidarrNaming>(options.data),
    });
  },
  radarr_media_settings: (options) => {
    return deserializeRadarrMediaSettings({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableMediaSettings>(options.data),
    });
  },
  sonarr_media_settings: (options) => {
    return deserializeSonarrMediaSettings({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableMediaSettings>(options.data),
    });
  },
  lidarr_media_settings: (options) => {
    return deserializeLidarrMediaSettings({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableLidarrMediaSettings>(options.data),
    });
  },
  radarr_quality_definitions: (options) => {
    return deserializeRadarrQualityDefinitions({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableQualityDefinitions>(options.data),
    });
  },
  sonarr_quality_definitions: (options) => {
    return deserializeSonarrQualityDefinitions({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableQualityDefinitions>(options.data),
    });
  },
  lidarr_quality_definitions: (options) => {
    return deserializeLidarrQualityDefinitions({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableLidarrQualityDefinitions>(options.data),
    });
  },
  lidarr_metadata_profile: (options) => {
    return deserializeLidarrMetadataProfile({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableLidarrMetadataProfile>(options.data),
    });
  },
};

/**
 * Cast helper for already-validated portable entity payloads.
 *
 * @precondition Call `validatePortableData` for the target entity type before invoking this helper.
 */
function asPortableData<T>(data: unknown): T {
  return data as unknown as T;
}

export function getEntityDeserializer(entityType: EntityType): EntityDeserializer {
  return ENTITY_DESERIALIZERS[entityType];
}

export async function deserializeByEntityType({
  databaseId,
  cache,
  layer,
  entityType,
  data,
}: DeserializeByEntityTypeOptions) {
  const handler = getEntityDeserializer(entityType);
  return handler({
    databaseId,
    cache,
    layer,
    data,
  });
}

// ============================================================================
// DELAY PROFILES
// ============================================================================

export async function deserializeDelayProfile(options: DeserializeOptions<PortableDelayProfile>) {
  const { databaseId, cache, layer, portable } = options;

  return delayProfileQueries.create({
    databaseId,
    cache,
    layer,
    input: portable,
  });
}

// ============================================================================
// REGULAR EXPRESSIONS
// ============================================================================

export async function deserializeRegularExpression(options: DeserializeOptions<PortableRegularExpression>) {
  const { databaseId, cache, layer, portable } = options;

  return regexQueries.create({
    databaseId,
    cache,
    layer,
    input: portable,
  });
}

// ============================================================================
// CUSTOM FORMATS
// ============================================================================

export async function deserializeCustomFormat(options: DeserializeOptions<PortableCustomFormat>) {
  const { databaseId, cache, layer, portable } = options;

  // 1. Create the format
  const createResult = await cfQueries.create({
    databaseId,
    cache,
    layer,
    input: {
      name: portable.name,
      description: portable.description,
      includeInRename: portable.includeInRename,
      tags: portable.tags,
    },
  });

  // 2. Add conditions (empty originalConditions = all new)
  if (portable.conditions.length > 0) {
    const freshCache = getCache(databaseId);
    if (!freshCache) throw new Error('Database cache not available');

    await cfQueries.updateConditions({
      databaseId,
      cache: freshCache,
      layer,
      formatName: portable.name,
      originalConditions: [],
      conditions: portable.conditions,
    });
  }

  // 3. Add tests
  for (const test of portable.tests) {
    await cfQueries.createTest({
      databaseId,
      layer,
      formatName: portable.name,
      input: {
        title: test.title,
        type: test.type,
        should_match: test.shouldMatch,
        description: test.description,
      },
    });
  }

  return createResult;
}

// ============================================================================
// QUALITY PROFILES
// ============================================================================

export async function deserializeQualityProfile(options: DeserializeOptions<PortableQualityProfile>) {
  const { databaseId, cache, layer, portable } = options;

  // 1. Create the profile (sets up default qualities)
  const createResult = await qpQueries.create({
    databaseId,
    cache,
    layer,
    input: {
      name: portable.name,
      description: portable.description,
      tags: portable.tags,
      language: portable.language,
    },
  });

  // 2. Update qualities to match portable
  const freshCache = getCache(databaseId);
  if (!freshCache) throw new Error('Database cache not available');

  await qpQueries.updateQualities({
    databaseId,
    cache: freshCache,
    layer,
    profileName: portable.name,
    input: { orderedItems: portable.orderedItems },
  });

  // 3. Update scoring
  const freshCache2 = getCache(databaseId);
  if (!freshCache2) throw new Error('Database cache not available');

  await qpQueries.updateScoring({
    databaseId,
    cache: freshCache2,
    layer,
    profileName: portable.name,
    input: {
      minimumScore: portable.minimumScore,
      upgradeUntilScore: portable.upgradeUntilScore,
      upgradeScoreIncrement: portable.upgradeScoreIncrement,
      customFormatScores: portable.customFormatScores,
    },
  });

  return createResult;
}

// ============================================================================
// NAMING
// ============================================================================

export async function deserializeRadarrNaming(options: DeserializeOptions<PortableRadarrNaming>) {
  const { databaseId, cache, layer, portable } = options;

  return namingQueries.createRadarrNaming({
    databaseId,
    cache,
    layer,
    input: portable,
  });
}

export async function deserializeSonarrNaming(options: DeserializeOptions<PortableSonarrNaming>) {
  const { databaseId, cache, layer, portable } = options;

  return namingQueries.createSonarrNaming({
    databaseId,
    cache,
    layer,
    input: portable,
  });
}

export async function deserializeLidarrNaming(options: DeserializeOptions<PortableLidarrNaming>) {
  const { databaseId, cache, layer, portable } = options;

  return createLidarrNaming({
    databaseId,
    cache,
    layer,
    input: portable,
  });
}

// ============================================================================
// MEDIA SETTINGS
// ============================================================================

export async function deserializeRadarrMediaSettings(options: DeserializeOptions<PortableMediaSettings>) {
  const { databaseId, cache, layer, portable } = options;

  return mediaSettingsQueries.createRadarrMediaSettings({
    databaseId,
    cache,
    layer,
    input: portable,
  });
}

export async function deserializeSonarrMediaSettings(options: DeserializeOptions<PortableMediaSettings>) {
  const { databaseId, cache, layer, portable } = options;

  return mediaSettingsQueries.createSonarrMediaSettings({
    databaseId,
    cache,
    layer,
    input: portable,
  });
}

export async function deserializeLidarrMediaSettings(options: DeserializeOptions<PortableLidarrMediaSettings>) {
  const { databaseId, cache, layer, portable } = options;

  return mediaSettingsQueries.createLidarrMediaSettings({
    databaseId,
    cache,
    layer,
    input: portable,
  });
}

// ============================================================================
// QUALITY DEFINITIONS
// ============================================================================

export async function deserializeRadarrQualityDefinitions(options: DeserializeOptions<PortableQualityDefinitions>) {
  const { databaseId, cache, layer, portable } = options;

  return qualityDefsQueries.createRadarrQualityDefinitions({
    databaseId,
    cache,
    layer,
    input: portable,
  });
}

export async function deserializeSonarrQualityDefinitions(options: DeserializeOptions<PortableQualityDefinitions>) {
  const { databaseId, cache, layer, portable } = options;

  return qualityDefsQueries.createSonarrQualityDefinitions({
    databaseId,
    cache,
    layer,
    input: portable,
  });
}

export async function deserializeLidarrQualityDefinitions(
  options: DeserializeOptions<PortableLidarrQualityDefinitions>
) {
  const { databaseId, cache, layer, portable } = options;

  return qualityDefsQueries.createLidarrQualityDefinitions({
    databaseId,
    cache,
    layer,
    input: portable,
  });
}

// ============================================================================
// LIDARR METADATA PROFILES
// ============================================================================

function getMetadataProfileTypeId(typeRow: LidarrMetadataProfileTypeRow, kind: 'album' | 'status'): number {
  if (typeof typeRow.id === 'number' && Number.isInteger(typeRow.id)) {
    return typeRow.id;
  }

  if (kind === 'status' && typeof typeRow.statusId === 'number' && Number.isInteger(typeRow.statusId)) {
    return typeRow.statusId;
  }

  if (kind === 'album' && typeof typeRow.typeId === 'number' && Number.isInteger(typeRow.typeId)) {
    return typeRow.typeId;
  }

  throw new Error(
    kind === 'status'
      ? 'Metadata profile status identifier must be an integer id or statusId'
      : 'Metadata profile type identifier must be an integer id or typeId'
  );
}

function normalizeLidarrMetadataProfileTypeRows(
  section: MetadataProfileSectionKind,
  typeRows: readonly LidarrMetadataProfileTypeRow[]
): Array<{ typeId: number; name: string; allowed: boolean }> {
  return typeRows
    .slice()
    .sort((a, b) => {
      const aId = getMetadataProfileTypeId(a, section === 'status' ? 'status' : 'album');
      const bId = getMetadataProfileTypeId(b, section === 'status' ? 'status' : 'album');
      return aId - bId;
    })
    .map((type) => ({
      typeId: getMetadataProfileTypeId(type, section === 'status' ? 'status' : 'album'),
      name: type.name ?? '',
      allowed: !!type.allowed,
    }));
}

function normalizeLidarrMetadataProfileReleaseStatusRows(
  rows: readonly LidarrMetadataProfileTypeRow[]
): Array<{ statusId: number; name: string; allowed: boolean }> {
  return normalizeLidarrMetadataProfileTypeRows('status', rows).map((row) => ({
    statusId: row.typeId,
    name: row.name,
    allowed: row.allowed,
  }));
}

export async function deserializeLidarrMetadataProfile(options: DeserializeOptions<PortableLidarrMetadataProfile>) {
  const { databaseId, cache, layer, portable } = options;

  return metadataProfilesQueries.create({
    databaseId,
    cache,
    layer,
    input: {
      name: portable.name,
      description: portable.description,
      primaryAlbumTypes: normalizeLidarrMetadataProfileTypeRows('primary', portable.primaryTypes),
      secondaryAlbumTypes: normalizeLidarrMetadataProfileTypeRows('secondary', portable.secondaryTypes),
      releaseStatuses: normalizeLidarrMetadataProfileReleaseStatusRows(portable.releaseStatuses),
    },
  });
}
