import { error, redirect, fail, type Actions, type ServerLoad } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';
import { canWriteToBase } from '$pcd/index.ts';
import { parseOperationLayer } from '$pcd/index.ts';
import type { ArrAppType } from '$shared/pcd/types.ts';
import { getAvailableQualities } from '$pcd/entities/mediaManagement/quality-definitions/read.ts';
import {
  createLidarrQualityDefinitions,
  createRadarrQualityDefinitions,
  createSonarrQualityDefinitions,
} from '$pcd/entities/mediaManagement/quality-definitions/create.ts';

const QUALITY_DEFINITION_UNSUPPORTED_ERROR_PREFIX = 'Unsupported quality names for quality definitions';
const SUPPORTED_QUALITY_DEFINITION_ARR_TYPES = ['radarr', 'sonarr', 'lidarr'] as const;

type QualityDefinitionsBadRequestCode =
  | 'quality_definitions_duplicate_qualities'
  | 'quality_definitions_duplicate_name'
  | 'quality_definitions_unmapped';

interface QualityDefinitionsBadRequestError extends Error {
  status: 400;
  code: QualityDefinitionsBadRequestCode;
}

function isSupportedQualityDefinitionsArrType(value: FormDataEntryValue | null): value is ArrAppType {
  return typeof value === 'string' && SUPPORTED_QUALITY_DEFINITION_ARR_TYPES.some((arrType) => arrType === value);
}

function isQualityDefinitionsBadRequestError(value: unknown): value is QualityDefinitionsBadRequestError {
  return (
    value instanceof Error &&
    'status' in value &&
    (value as { status?: unknown }).status === 400 &&
    'code' in value &&
    typeof (value as { code?: unknown }).code === 'string'
  );
}

export const load: ServerLoad = async ({ params, parent }) => {
  const { databaseId } = params;

  if (!databaseId) {
    throw error(400, 'Missing database ID');
  }

  const currentDatabaseId = parseInt(databaseId, 10);
  if (isNaN(currentDatabaseId)) {
    throw error(400, 'Invalid database ID');
  }

  const cache = pcdManager.getCache(currentDatabaseId);
  if (!cache) {
    throw error(500, 'Database cache not available');
  }

  const radarrQualities = await getAvailableQualities(cache, 'radarr');
  const sonarrQualities = await getAvailableQualities(cache, 'sonarr');
  const lidarrQualities = await getAvailableQualities(cache, 'lidarr');

  const parentData = await parent();

  return {
    canWriteToBase: parentData.canWriteToBase,
    radarrQualities,
    sonarrQualities,
    lidarrQualities,
  };
};

function isUnmappedQualityError(message: string): boolean {
  return (
    message.startsWith(QUALITY_DEFINITION_UNSUPPORTED_ERROR_PREFIX) ||
    message.toLowerCase().includes('unsupported quality')
  );
}

function getQualityDefinitionsBadRequestCode(message: string): QualityDefinitionsBadRequestCode | null {
  if (isUnmappedQualityError(message)) {
    return 'quality_definitions_unmapped';
  }

  if (message.toLowerCase().includes('duplicate quality')) {
    return 'quality_definitions_duplicate_qualities';
  }

  if (message.includes('already exists') || message.toLowerCase().includes('duplicate')) {
    return 'quality_definitions_duplicate_name';
  }

  return null;
}

function failWithDomainError(errorValue: unknown, fallbackMessage: string) {
  const message = errorValue instanceof Error ? errorValue.message : fallbackMessage;
  const code = isQualityDefinitionsBadRequestError(errorValue)
    ? errorValue.code
    : getQualityDefinitionsBadRequestCode(message);

  if (code) {
    return fail(400, {
      status: 400,
      message,
      error: message,
      code,
    });
  }

  return fail(500, {
    status: 500,
    message,
    error: message,
  });
}

export const actions: Actions = {
  default: async ({ request, params }) => {
    const { databaseId } = params;

    if (!databaseId) {
      return fail(400, { error: 'Missing database ID' });
    }

    const currentDatabaseId = parseInt(databaseId, 10);
    if (isNaN(currentDatabaseId)) {
      return fail(400, { error: 'Invalid database ID' });
    }

    const cache = pcdManager.getCache(currentDatabaseId);
    if (!cache) {
      return fail(500, { error: 'Database cache not available' });
    }

    const formData = await request.formData();
    const arrTypeRaw = formData.get('arrType');
    const name = formData.get('name') as string;
    const layerResult = parseOperationLayer(formData.get('layer'));
    if ('error' in layerResult) {
      return fail(400, { error: layerResult.error });
    }
    const layer = layerResult.value;
    const entriesJson = formData.get('entries') as string;

    if (!name?.trim()) {
      return fail(400, { error: 'Name is required' });
    }

    if (!isSupportedQualityDefinitionsArrType(arrTypeRaw)) {
      return fail(400, { status: 400, message: 'Invalid arr type', error: 'Invalid arr type' });
    }
    const arrType = arrTypeRaw;

    if (layer === 'base' && !canWriteToBase(currentDatabaseId)) {
      return fail(403, { error: 'Cannot write to base layer without personal access token' });
    }

    let entries;
    try {
      entries = JSON.parse(entriesJson || '[]');
    } catch {
      return fail(400, { error: 'Invalid entries data' });
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      return fail(400, { error: 'At least one quality definition is required' });
    }

    const createFn =
      arrType === 'radarr'
        ? createRadarrQualityDefinitions
        : arrType === 'sonarr'
          ? createSonarrQualityDefinitions
          : createLidarrQualityDefinitions;

    let result;
    try {
      result = await createFn({
        databaseId: currentDatabaseId,
        cache,
        layer,
        input: {
          name: name.trim(),
          entries,
        },
      });
    } catch (err) {
      return failWithDomainError(err, `Failed to create ${arrType} quality definitions`);
    }

    if (!result.success) {
      const message = result.error || `Failed to create ${arrType} quality definitions`;
      return fail(500, { status: 500, message, error: message });
    }

    throw redirect(303, `/media-management/${databaseId}/quality-definitions`);
  },
};
