import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';
import {
  ENTITY_TYPES,
  type EntityType,
  type PortableEntityData,
  PORTABLE_MIGRATION_MIN_VERSION,
  PORTABLE_MIGRATION_SOURCE_EXPORT,
} from '$shared/pcd/portable.ts';
import type { PCDCache } from '$pcd/index.ts';
import * as serialize from '$pcd/entities/serialize.ts';

export const _serializeDependencies = {
  serializeDelayProfile: serialize.serializeDelayProfile,
  serializeRegularExpression: serialize.serializeRegularExpression,
  serializeCustomFormat: serialize.serializeCustomFormat,
  serializeQualityProfile: serialize.serializeQualityProfile,
  serializeRadarrNaming: serialize.serializeRadarrNaming,
  serializeSonarrNaming: serialize.serializeSonarrNaming,
  serializeLidarrNaming: serialize.serializeLidarrNaming,
  serializeRadarrMediaSettings: serialize.serializeRadarrMediaSettings,
  serializeSonarrMediaSettings: serialize.serializeSonarrMediaSettings,
  serializeLidarrMediaSettings: serialize.serializeLidarrMediaSettings,
  serializeRadarrQualityDefinitions: serialize.serializeRadarrQualityDefinitions,
  serializeSonarrQualityDefinitions: serialize.serializeSonarrQualityDefinitions,
  serializeLidarrQualityDefinitions: serialize.serializeLidarrQualityDefinitions,
  serializeLidarrMetadataProfile: serialize.serializeLidarrMetadataProfile,
} as const;

const VALID_ENTITY_TYPES: ReadonlySet<string> = new Set(ENTITY_TYPES);

export const GET: RequestHandler = async ({ url }) => {
  const databaseIdParam = url.searchParams.get('databaseId');
  const entityType = url.searchParams.get('entityType');
  const name = url.searchParams.get('name');

  if (!databaseIdParam || !entityType || !name) {
    return json({ error: 'Missing required parameters: databaseId, entityType, name' }, { status: 400 });
  }

  const databaseId = parseInt(databaseIdParam, 10);
  if (isNaN(databaseId)) {
    return json({ error: 'Invalid databaseId' }, { status: 400 });
  }

  if (!VALID_ENTITY_TYPES.has(entityType)) {
    return json({ error: `Invalid entityType: ${entityType}` }, { status: 400 });
  }

  const cache = pcdManager.getCache(databaseId);
  if (!cache) {
    return json({ error: 'Database cache not available' }, { status: 500 });
  }

  try {
    const data = await serializeEntity(cache, entityType as EntityType, name);
    return json({
      entityType,
      data,
      migration: {
        source: PORTABLE_MIGRATION_SOURCE_EXPORT,
        format: 'json',
        version: PORTABLE_MIGRATION_MIN_VERSION,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Export failed';
    if (message.includes('not found')) {
      return json({ error: message }, { status: 404 });
    }
    return json({ error: message }, { status: 400 });
  }
};

async function serializeEntity(cache: PCDCache, entityType: EntityType, name: string): Promise<PortableEntityData> {
  switch (entityType) {
    case 'delay_profile':
      return _serializeDependencies.serializeDelayProfile(cache, name);
    case 'regular_expression':
      return _serializeDependencies.serializeRegularExpression(cache, name);
    case 'custom_format':
      return _serializeDependencies.serializeCustomFormat(cache, name);
    case 'quality_profile':
      return _serializeDependencies.serializeQualityProfile(cache, name);
    case 'radarr_naming':
      return _serializeDependencies.serializeRadarrNaming(cache, name);
    case 'sonarr_naming':
      return _serializeDependencies.serializeSonarrNaming(cache, name);
    case 'lidarr_naming':
      return _serializeDependencies.serializeLidarrNaming(cache, name);
    case 'radarr_media_settings':
      return _serializeDependencies.serializeRadarrMediaSettings(cache, name);
    case 'sonarr_media_settings':
      return _serializeDependencies.serializeSonarrMediaSettings(cache, name);
    case 'lidarr_media_settings':
      return _serializeDependencies.serializeLidarrMediaSettings(cache, name);
    case 'radarr_quality_definitions':
      return _serializeDependencies.serializeRadarrQualityDefinitions(cache, name);
    case 'sonarr_quality_definitions':
      return _serializeDependencies.serializeSonarrQualityDefinitions(cache, name);
    case 'lidarr_quality_definitions':
      return _serializeDependencies.serializeLidarrQualityDefinitions(cache, name);
    case 'lidarr_metadata_profile':
      return _serializeDependencies.serializeLidarrMetadataProfile(cache, name);

    default: {
      const exhaustive: never = entityType;
      throw new Error(`Unsupported entity type: ${exhaustive}`);
    }
  }
}
