import { error, redirect, fail, type Actions, type ServerLoad } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';
import { canWriteToBase } from '$pcd/index.ts';
import type { OperationLayer } from '$pcd/index.ts';
import { getLidarrByName, getAvailableQualities } from '$pcd/entities/mediaManagement/quality-definitions/read.ts';
import { updateLidarrQualityDefinitions } from '$pcd/entities/mediaManagement/quality-definitions/update.ts';
import { removeSonarrQualityDefinitions } from '$pcd/entities/mediaManagement/quality-definitions/delete.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';

const QUALITY_DEFINITION_UNSUPPORTED_ERROR_PREFIX = 'Unsupported quality names for quality definitions';

function isUnmappedQualityError(message: string): boolean {
  return (
    message.startsWith(QUALITY_DEFINITION_UNSUPPORTED_ERROR_PREFIX) ||
    message.toLowerCase().includes('unsupported quality')
  );
}

function failWithDomainError(message: string) {
  if (
    isUnmappedQualityError(message) ||
    message.includes('already exists') ||
    message.toLowerCase().includes('duplicate')
  ) {
    return fail(400, {
      status: 400,
      message,
      error: message,
    });
  }

  return fail(500, {
    status: 500,
    message,
    error: message,
  });
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

  const decodedName = decodeURIComponent(name);
  const qualityDefinitionsConfig = await getLidarrByName(cache, decodedName);

  if (!qualityDefinitionsConfig) {
    throw error(404, 'Quality definitions config not found');
  }

  const availableQualities = await getAvailableQualities(cache, 'lidarr');
  const parentData = await parent();

  return {
    qualityDefinitionsConfig,
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

    const decodedName = decodeURIComponent(name);
    const current = await getLidarrByName(cache, decodedName);
    if (!current) {
      return fail(404, { error: 'Quality definitions config not found' });
    }

    const formData = await request.formData();
    const newName = formData.get('name') as string;
    const layer = (formData.get('layer') as OperationLayer) || 'user';
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
      const message = err instanceof Error ? err.message : 'Failed to update quality definitions config';
      return failWithDomainError(message);
    }

    if (!result.success) {
      return fail(500, { error: result.error || 'Failed to update quality definitions config' });
    }

    if (newName.trim() !== decodedName) {
      arrSyncQueries.updateQualityDefinitionsConfigName(decodedName, newName.trim());
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

    const decodedName = decodeURIComponent(name);
    const current = await getLidarrByName(cache, decodedName);
    if (!current) {
      return fail(404, { error: 'Quality definitions config not found' });
    }

    const formData = await request.formData();
    const layer = (formData.get('layer') as OperationLayer) || 'user';

    if (layer === 'base' && !canWriteToBase(currentDatabaseId)) {
      return fail(403, { error: 'Cannot write to base layer without personal access token' });
    }

    const result = await removeSonarrQualityDefinitions({
      databaseId: currentDatabaseId,
      cache,
      layer,
      current,
    });

    if (!result.success) {
      return fail(500, { error: result.error || 'Failed to delete quality definitions config' });
    }

    throw redirect(303, `/media-management/${databaseId}/quality-definitions`);
  },
};
