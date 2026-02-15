import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';
import { ENTITY_TYPES, getLidarrMediaManagementPortableEntry, type EntityType } from '$shared/pcd/portable.ts';
import type { PCDCache } from '$pcd/index.ts';
import * as serialize from '$pcd/entities/serialize.ts';

const VALID_ENTITY_TYPES: ReadonlySet<string> = new Set(ENTITY_TYPES);
type ResolvedEntityType = Exclude<EntityType, 'lidarr_naming' | 'lidarr_quality_definitions'>;

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

  const resolvedEntityType = resolveEntityType(entityType as EntityType);

  const cache = pcdManager.getCache(databaseId);
  if (!cache) {
    return json({ error: 'Database cache not available' }, { status: 500 });
  }

  try {
    const data = await serializeEntity(cache, resolvedEntityType, name);
    return json({ entityType, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Export failed';
    if (message.includes('not found')) {
      return json({ error: message }, { status: 404 });
    }
    return json({ error: message }, { status: 400 });
  }
};

function resolveEntityType(entityType: EntityType): ResolvedEntityType {
  if (entityType === 'lidarr_media_settings') {
    return entityType;
  }

  const matrixEntry = getLidarrMediaManagementPortableEntry(entityType);
  return (matrixEntry?.reusableEntityType ?? entityType) as ResolvedEntityType;
}

async function serializeEntity(cache: PCDCache, entityType: ResolvedEntityType, name: string) {
  switch (entityType) {
    case 'delay_profile':
      return serialize.serializeDelayProfile(cache, name);
    case 'regular_expression':
      return serialize.serializeRegularExpression(cache, name);
    case 'custom_format':
      return serialize.serializeCustomFormat(cache, name);
    case 'quality_profile':
      return serialize.serializeQualityProfile(cache, name);
    case 'radarr_naming':
      return serialize.serializeRadarrNaming(cache, name);
    case 'sonarr_naming':
      return serialize.serializeSonarrNaming(cache, name);
    case 'radarr_media_settings':
      return serialize.serializeRadarrMediaSettings(cache, name);
    case 'sonarr_media_settings':
      return serialize.serializeSonarrMediaSettings(cache, name);
    case 'lidarr_media_settings':
      return serialize.serializeLidarrMediaSettings(cache, name);
    case 'radarr_quality_definitions':
      return serialize.serializeRadarrQualityDefinitions(cache, name);
    case 'sonarr_quality_definitions':
      return serialize.serializeSonarrQualityDefinitions(cache, name);
  }
}
