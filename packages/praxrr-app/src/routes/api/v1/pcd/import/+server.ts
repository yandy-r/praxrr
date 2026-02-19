import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { pcdManager, canWriteToBase } from '$pcd/index.ts';
import type { PCDCache, OperationLayer } from '$pcd/index.ts';
import {
  ENTITY_TYPES,
  getLidarrMediaManagementPortableEntry,
  type EntityType,
  type PortableCustomFormat,
  type PortableDelayProfile,
  type PortableQualityProfile,
  type PortableRegularExpression,
  type PortableLidarrMediaSettings,
  type PortableLidarrNaming,
  type PortableLidarrQualityDefinitions,
  type PortableMediaSettings,
  type PortableQualityDefinitions,
  type PortableRadarrNaming,
  type PortableSonarrNaming,
  type PortableLidarrMetadataProfile,
} from '$shared/pcd/portable.ts';
import * as deserialize from '$pcd/entities/deserialize.ts';
import { createLidarrNaming } from '$pcd/entities/mediaManagement/naming/create.ts';
import { validatePortableData } from '$pcd/entities/validate.ts';

const VALID_ENTITY_TYPES: ReadonlySet<string> = new Set(ENTITY_TYPES);

const VALID_LAYERS: Set<string> = new Set(['user', 'base']);

export const POST: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { databaseId, layer, entityType, data } = body;

  if (databaseId === undefined || !layer || !entityType || !data) {
    return json({ error: 'Missing required fields: databaseId, layer, entityType, data' }, { status: 400 });
  }

  if (typeof databaseId !== 'number' || !Number.isInteger(databaseId)) {
    return json({ error: 'Invalid databaseId' }, { status: 400 });
  }

  if (!VALID_LAYERS.has(layer as string)) {
    return json({ error: `Invalid layer: ${layer}` }, { status: 400 });
  }

  if (!VALID_ENTITY_TYPES.has(entityType as string)) {
    return json({ error: `Invalid entityType: ${entityType}` }, { status: 400 });
  }

  const typedEntityType = entityType as EntityType;

  if (layer === 'base' && !canWriteToBase(databaseId as number)) {
    return json({ error: 'Cannot write to base layer' }, { status: 403 });
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return json({ error: 'Invalid portable payload: data must be an object' }, { status: 400 });
  }

  const lidarrPayloadError = validateLidarrPayload(typedEntityType, data as Record<string, unknown>);
  if (lidarrPayloadError) {
    return json({ error: lidarrPayloadError }, { status: 400 });
  }

  const validationError = validatePortableData(typedEntityType, data as Record<string, unknown>);
  if (validationError) {
    return json({ error: validationError }, { status: 400 });
  }

  const cache = pcdManager.getCache(databaseId as number);
  if (!cache) {
    return json({ error: 'Database cache not available' }, { status: 500 });
  }

  try {
    await deserializeEntity({
      databaseId: databaseId as number,
      cache,
      layer: layer as OperationLayer,
      entityType: typedEntityType,
      data: data as Record<string, unknown>,
    });
    return json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import failed';
    return json({ error: message }, { status: 400 });
  }
};

interface DeserializeArgs {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  entityType: EntityType;
  data: Record<string, unknown>;
}

async function deserializeEntity({ databaseId, cache, layer, entityType, data }: DeserializeArgs) {
  const opts = { databaseId, cache, layer };

  switch (entityType) {
    case 'delay_profile':
      return deserialize.deserializeDelayProfile({ ...opts, portable: data as unknown as PortableDelayProfile });
    case 'regular_expression':
      return deserialize.deserializeRegularExpression({
        ...opts,
        portable: data as unknown as PortableRegularExpression,
      });
    case 'custom_format':
      return deserialize.deserializeCustomFormat({ ...opts, portable: data as unknown as PortableCustomFormat });
    case 'quality_profile':
      return deserialize.deserializeQualityProfile({ ...opts, portable: data as unknown as PortableQualityProfile });
    case 'radarr_naming':
      return deserialize.deserializeRadarrNaming({ ...opts, portable: data as unknown as PortableRadarrNaming });
    case 'sonarr_naming':
      return deserialize.deserializeSonarrNaming({ ...opts, portable: data as unknown as PortableSonarrNaming });
    case 'lidarr_naming':
      return createLidarrNaming({ ...opts, input: data as unknown as PortableLidarrNaming });
    case 'radarr_media_settings':
      return deserialize.deserializeRadarrMediaSettings({
        ...opts,
        portable: data as unknown as PortableMediaSettings,
      });
    case 'sonarr_media_settings':
      return deserialize.deserializeSonarrMediaSettings({
        ...opts,
        portable: data as unknown as PortableMediaSettings,
      });
    case 'lidarr_media_settings':
      return deserialize.deserializeLidarrMediaSettings({
        ...opts,
        portable: data as unknown as PortableLidarrMediaSettings,
      });
    case 'radarr_quality_definitions':
      return deserialize.deserializeRadarrQualityDefinitions({
        ...opts,
        portable: data as unknown as PortableQualityDefinitions,
      });
    case 'sonarr_quality_definitions':
      return deserialize.deserializeSonarrQualityDefinitions({
        ...opts,
        portable: data as unknown as PortableQualityDefinitions,
      });
    case 'lidarr_quality_definitions':
      return deserialize.deserializeLidarrQualityDefinitions({
        ...opts,
        portable: data as unknown as PortableLidarrQualityDefinitions,
      });
    case 'lidarr_metadata_profile':
      return deserialize.deserializeLidarrMetadataProfile({
        ...opts,
        portable: data as unknown as PortableLidarrMetadataProfile,
      });
  }
}

function validateLidarrPayload(entityType: EntityType, data: Record<string, unknown>): string | null {
  if (entityType === 'lidarr_metadata_profile') {
    const requiredFields = ['name', 'description', 'primaryTypes', 'secondaryTypes', 'releaseStatuses'];
    const missingRequiredFields = requiredFields.filter((field) => !Object.hasOwn(data, field));
    if (missingRequiredFields.length > 0) {
      return `Unsupported payload for lidarr_metadata_profile: missing required fields: ${missingRequiredFields.join(', ')}`;
    }

    const unsupportedFields = Object.keys(data)
      .filter((field) => !requiredFields.includes(field))
      .sort((a, b) => a.localeCompare(b));
    if (unsupportedFields.length > 0) {
      return `Unsupported payload for lidarr_metadata_profile: unsupported fields: ${unsupportedFields.join(', ')}`;
    }
  }

  const matrixEntry = getLidarrMediaManagementPortableEntry(entityType);
  if (!matrixEntry) {
    return null;
  }

  const mixedFields = (matrixEntry.forbiddenFields ?? [])
    .filter((field) => Object.hasOwn(data, field))
    .sort((a, b) => a.localeCompare(b));
  if (mixedFields.length > 0) {
    return `Mixed payload for ${entityType}: unsupported fields from another model: ${mixedFields.join(', ')}`;
  }

  const missingRequiredFields = matrixEntry.requiredFields.filter((field) => !Object.hasOwn(data, field));
  if (missingRequiredFields.length > 0) {
    return `Unsupported payload for ${entityType}: missing required fields: ${missingRequiredFields.join(', ')}`;
  }

  const allowedFields = new Set(matrixEntry.requiredFields);
  const unsupportedFields = Object.keys(data)
    .filter((field) => !allowedFields.has(field))
    .sort((a, b) => a.localeCompare(b));
  if (unsupportedFields.length > 0) {
    return `Unsupported payload for ${entityType}: unsupported fields: ${unsupportedFields.join(', ')}`;
  }

  return null;
}
