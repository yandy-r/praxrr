import { error, redirect, fail, type Actions, type ServerLoad } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';
import { canWriteToBase } from '$pcd/index.ts';
import { parseOperationLayer } from '$pcd/index.ts';
import { getLidarrByName, getAvailableQualities } from '$pcd/entities/mediaManagement/quality-definitions/read.ts';
import { updateLidarrQualityDefinitions } from '$pcd/entities/mediaManagement/quality-definitions/update.ts';
import { removeLidarrQualityDefinitions } from '$pcd/entities/mediaManagement/quality-definitions/delete.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';

const QUALITY_DEFINITION_UNSUPPORTED_ERROR_PREFIX = 'Unsupported quality names for quality definitions';

type QualityDefinitionsBadRequestCode =
  'quality_definitions_duplicate_qualities' | 'quality_definitions_duplicate_name' | 'quality_definitions_unmapped';

interface QualityDefinitionsBadRequestError extends Error {
  status: 400;
  code: QualityDefinitionsBadRequestCode;
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

async function resolveLidarrQualityDefinitionsByRouteName(
  cache: ReturnType<typeof pcdManager.getCache>,
  routeName: string
) {
  if (!cache) {
    return null;
  }

  const decodedName = decodeURIComponent(routeName);
  const directMatch = await getLidarrByName(cache, decodedName);
  if (directMatch) {
    return { config: directMatch, resolvedName: decodedName };
  }
  return null;
}

export const load: ServerLoad = async ({ params, parent }) => {
  const { databaseId, name } = params;

  if (!databaseId || !name) {
    throw error(400, 'Missing parameters');
  }

  const currentDatabaseId = parseInt(databaseId, 10);
  if (isNaN(currentDatabaseId)) {
    throw error(400, 'Invalid database ID');
  }

  const cache = pcdManager.getCache(currentDatabaseId);
  if (!cache) {
    throw error(500, 'Database cache not available');
  }

  const resolved = await resolveLidarrQualityDefinitionsByRouteName(cache, name);
  if (!resolved) {
    throw error(404, 'Quality definitions config not found');
  }

  const availableQualities = await getAvailableQualities(cache, 'lidarr');
  const parentData = await parent();

  return {
    qualityDefinitionsConfig: resolved.config,
    availableQualities,
    canWriteToBase: parentData.canWriteToBase,
  };
};

export const actions: Actions = {
  update: async ({ request, params }) => {
    const { databaseId, name } = params;

    if (!databaseId || !name) {
      return fail(400, { error: 'Missing parameters' });
    }

    const currentDatabaseId = parseInt(databaseId, 10);
    if (isNaN(currentDatabaseId)) {
      return fail(400, { error: 'Invalid database ID' });
    }

    const cache = pcdManager.getCache(currentDatabaseId);
    if (!cache) {
      return fail(500, { error: 'Database cache not available' });
    }

    const resolved = await resolveLidarrQualityDefinitionsByRouteName(cache, name);
    if (!resolved) {
      return fail(404, { error: 'Quality definitions config not found' });
    }
    const current = resolved.config;
    const resolvedName = resolved.resolvedName;

    const formData = await request.formData();
    const newName = formData.get('name') as string;
    const layerResult = parseOperationLayer(formData.get('layer'));
    if ('error' in layerResult) {
      return fail(400, { error: layerResult.error });
    }
    const layer = layerResult.value;
    const entriesJson = formData.get('entries') as string;

    if (!newName?.trim()) {
      return fail(400, { error: 'Name is required' });
    }

    if (layer === 'base' && !canWriteToBase(currentDatabaseId)) {
      return fail(403, { error: 'Cannot write to base layer without personal access token' });
    }

    let entries;
    try {
      entries = JSON.parse(entriesJson || '[]');
    } catch {
      return fail(400, { error: 'Invalid entries data' });
    }

    let result;
    try {
      result = await updateLidarrQualityDefinitions({
        databaseId: currentDatabaseId,
        cache,
        layer,
        current,
        input: {
          name: newName.trim(),
          entries,
        },
      });
    } catch (err) {
      return failWithDomainError(err, 'Failed to update quality definitions config');
    }

    if (!result.success) {
      const message = result.error || 'Failed to update quality definitions config';
      return fail(500, { status: 500, message, error: message });
    }

    if (newName.trim() !== resolvedName) {
      arrSyncQueries.updateQualityDefinitionsConfigName(resolvedName, newName.trim(), {
        arrType: 'lidarr',
        databaseId: currentDatabaseId,
      });
    }

    throw redirect(303, `/media-management/${databaseId}/quality-definitions`);
  },

  delete: async ({ request, params }) => {
    const { databaseId, name } = params;

    if (!databaseId || !name) {
      return fail(400, { error: 'Missing parameters' });
    }

    const currentDatabaseId = parseInt(databaseId, 10);
    if (isNaN(currentDatabaseId)) {
      return fail(400, { error: 'Invalid database ID' });
    }

    const cache = pcdManager.getCache(currentDatabaseId);
    if (!cache) {
      return fail(500, { error: 'Database cache not available' });
    }

    const resolved = await resolveLidarrQualityDefinitionsByRouteName(cache, name);
    if (!resolved) {
      return fail(404, { error: 'Quality definitions config not found' });
    }
    const resolvedName = resolved.resolvedName;

    const storageCurrent = await getLidarrByName(cache, resolvedName);
    if (!storageCurrent) {
      return fail(404, { error: 'Quality definitions config not found' });
    }

    const formData = await request.formData();
    const layerResult = parseOperationLayer(formData.get('layer'));
    if ('error' in layerResult) {
      return fail(400, { error: layerResult.error });
    }
    const layer = layerResult.value;

    if (layer === 'base' && !canWriteToBase(currentDatabaseId)) {
      return fail(403, { error: 'Cannot write to base layer without personal access token' });
    }

    const result = await removeLidarrQualityDefinitions({
      databaseId: currentDatabaseId,
      cache,
      layer,
      current: storageCurrent,
    });

    if (!result.success) {
      return fail(500, { error: result.error || 'Failed to delete quality definitions config' });
    }

    throw redirect(303, `/media-management/${databaseId}/quality-definitions`);
  },
};
