import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';
import {
  ENTITY_TYPES,
  type EntityType,
  type PortableLidarrNaming,
  type PortableLidarrQualityDefinitions,
} from '$shared/pcd/portable.ts';
import type { PCDCache } from '$pcd/index.ts';
import * as serialize from '$pcd/entities/serialize.ts';
import { getLidarrByName as getLidarrNamingByName } from '$pcd/entities/mediaManagement/naming/read.ts';
import { getLidarrByName as getLidarrQualityDefinitionsByName } from '$pcd/entities/mediaManagement/quality-definitions/read.ts';

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
    return json({ entityType, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Export failed';
    if (message.includes('not found')) {
      return json({ error: message }, { status: 404 });
    }
    return json({ error: message }, { status: 400 });
  }
};

async function serializeEntity(cache: PCDCache, entityType: EntityType, name: string) {
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
    case 'lidarr_naming':
      return serializeLidarrNaming(cache, name);
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
    case 'lidarr_quality_definitions':
      return serializeLidarrQualityDefinitions(cache, name);
    case 'lidarr_metadata_profile':
      return serialize.serializeLidarrMetadataProfile(cache, name);
  }
}

async function serializeLidarrNaming(cache: PCDCache, name: string): Promise<PortableLidarrNaming> {
  const row = await getLidarrNamingByName(cache, name);
  if (!row) throw new Error(`Lidarr naming "${name}" not found`);

  return {
    name: row.name,
    rename: row.rename,
    standardEpisodeFormat: row.standard_track_format,
    dailyEpisodeFormat: row.artist_name,
    animeEpisodeFormat: row.multi_disc_track_format,
    seriesFolderFormat: row.artist_folder_format,
    seasonFolderFormat: row.artist_folder_format,
    replaceIllegalCharacters: row.replace_illegal_characters,
    colonReplacementFormat: row.colon_replacement_format,
    customColonReplacementFormat: row.custom_colon_replacement_format,
    multiEpisodeStyle: 'extend',
  };
}

async function serializeLidarrQualityDefinitions(
  cache: PCDCache,
  name: string
): Promise<PortableLidarrQualityDefinitions> {
  const config = await getLidarrQualityDefinitionsByName(cache, name);
  if (!config) throw new Error(`Lidarr quality definitions "${name}" not found`);

  return {
    name: config.name,
    entries: config.entries,
  };
}
