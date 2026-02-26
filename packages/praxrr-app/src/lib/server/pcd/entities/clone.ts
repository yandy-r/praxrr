/**
 * Entity Clone
 *
 * Orchestrates serialize → rename → deserialize for any entity type.
 * The existing create functions handle name uniqueness validation.
 */

import type { PCDCache } from '$pcd/index.ts';
import type { OperationLayer } from '$pcd/index.ts';
import type { EntityType, PortableLidarrMetadataProfile } from '$shared/pcd/portable.ts';
import * as serialize from './serialize.ts';
import * as deserialize from './deserialize.ts';

interface CloneOptions {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  entityType: EntityType;
  /** Source entity name (used for name-based lookups) */
  sourceName: string;
  /** Name for the cloned entity */
  newName: string;
}

interface LidarrMetadataProfileTypeRow {
  id?: number;
  typeId?: number;
  statusId?: number;
  name: string;
  allowed: boolean;
}

/**
 * Clone an entity by serializing it from the source name, renaming, and deserializing into the PCD layer.
 *
 * @param options - Clone options including entity type, source name, new name, and operation layer
 * @returns The write result from the deserialization step
 * @throws {Error} When the source entity is not found or the database cache is unavailable
 */
export async function clone(options: CloneOptions) {
  const { databaseId, cache, layer, entityType, sourceName, newName } = options;

  switch (entityType) {
    case 'delay_profile': {
      const portable = await serialize.serializeDelayProfile(cache, sourceName);
      portable.name = newName;
      return deserialize.deserializeDelayProfile({ databaseId, cache, layer, portable });
    }

    case 'regular_expression': {
      const portable = await serialize.serializeRegularExpression(cache, sourceName);
      portable.name = newName;
      return deserialize.deserializeRegularExpression({ databaseId, cache, layer, portable });
    }

    case 'custom_format': {
      const portable = await serialize.serializeCustomFormat(cache, sourceName);
      portable.name = newName;
      return deserialize.deserializeCustomFormat({ databaseId, cache, layer, portable });
    }

    case 'quality_profile': {
      const portable = await serialize.serializeQualityProfile(cache, sourceName);
      portable.name = newName;
      return deserialize.deserializeQualityProfile({ databaseId, cache, layer, portable });
    }

    case 'radarr_naming': {
      const portable = await serialize.serializeRadarrNaming(cache, sourceName);
      portable.name = newName;
      return deserialize.deserializeRadarrNaming({ databaseId, cache, layer, portable });
    }

    case 'sonarr_naming': {
      const portable = await serialize.serializeSonarrNaming(cache, sourceName);
      portable.name = newName;
      return deserialize.deserializeSonarrNaming({ databaseId, cache, layer, portable });
    }

    case 'radarr_media_settings': {
      const portable = await serialize.serializeRadarrMediaSettings(cache, sourceName);
      portable.name = newName;
      return deserialize.deserializeRadarrMediaSettings({ databaseId, cache, layer, portable });
    }

    case 'sonarr_media_settings': {
      const portable = await serialize.serializeSonarrMediaSettings(cache, sourceName);
      portable.name = newName;
      return deserialize.deserializeSonarrMediaSettings({ databaseId, cache, layer, portable });
    }

    case 'lidarr_media_settings': {
      const portable = await serialize.serializeLidarrMediaSettings(cache, sourceName);
      portable.name = newName;
      return deserialize.deserializeLidarrMediaSettings({ databaseId, cache, layer, portable });
    }

    case 'radarr_quality_definitions': {
      const portable = await serialize.serializeRadarrQualityDefinitions(cache, sourceName);
      portable.name = newName;
      return deserialize.deserializeRadarrQualityDefinitions({ databaseId, cache, layer, portable });
    }

    case 'sonarr_quality_definitions': {
      const portable = await serialize.serializeSonarrQualityDefinitions(cache, sourceName);
      portable.name = newName;
      return deserialize.deserializeSonarrQualityDefinitions({ databaseId, cache, layer, portable });
    }

    case 'lidarr_quality_definitions': {
      const portable = await serialize.serializeLidarrQualityDefinitions(cache, sourceName);
      portable.name = newName;
      return deserialize.deserializeLidarrQualityDefinitions({ databaseId, cache, layer, portable });
    }

    case 'lidarr_metadata_profile': {
      const portable = await serialize.serializeLidarrMetadataProfile(cache, sourceName);
      const sortedPortable = normalizeLidarrMetadataProfile(portable);
      sortedPortable.name = newName;
      return deserialize.deserializeLidarrMetadataProfile({ databaseId, cache, layer, portable: sortedPortable });
    }
  }
}

function normalizeLidarrMetadataProfile(portable: PortableLidarrMetadataProfile): PortableLidarrMetadataProfile {
  return {
    ...portable,
    primaryTypes: normalizeLidarrMetadataProfileRows('primary', portable.primaryTypes),
    secondaryTypes: normalizeLidarrMetadataProfileRows('secondary', portable.secondaryTypes),
    releaseStatuses: normalizeLidarrMetadataProfileRows('release_status', portable.releaseStatuses),
  };
}

function normalizeLidarrMetadataProfileRows(
  section: 'primary' | 'secondary' | 'release_status',
  rows: readonly LidarrMetadataProfileTypeRow[]
): Array<{ id: number; name: string; allowed: boolean }> {
  return rows
    .slice()
    .map((row) => ({
      id: resolveLidarrMetadataProfileTypeId(section, row),
      name: row.name,
      allowed: row.allowed,
    }))
    .sort((a, b) => a.id - b.id);
}

function resolveLidarrMetadataProfileTypeId(
  section: 'primary' | 'secondary' | 'release_status',
  row: LidarrMetadataProfileTypeRow
): number {
  const id = row.id ?? (section === 'release_status' ? row.statusId : row.typeId);

  if (typeof id !== 'number' || !Number.isInteger(id)) {
    throw new Error(`metadata profile ${section} row id must be a valid integer`);
  }

  return id;
}
