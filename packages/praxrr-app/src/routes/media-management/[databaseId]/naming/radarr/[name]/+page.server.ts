import { error, redirect, fail } from '@sveltejs/kit';
import type { Actions, ServerLoad } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';
import { canWriteToBase } from '$pcd/index.ts';
import { parseOperationLayer } from '$pcd/index.ts';
import { getRadarrByName, updateRadarrNaming, removeRadarrNaming } from '$pcd/entities/mediaManagement/naming/index.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { logger } from '$logger/logger.ts';
import type { RadarrNamingRow } from '$shared/pcd/display.ts';
import { validateNamingFormat } from '$shared/pcd/namingTokens.ts';

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
  const namingConfig = await getRadarrByName(cache, decodedName);

  if (!namingConfig) {
    throw error(404, 'Naming config not found');
  }

  const parentData = await parent();

  return {
    namingConfig,
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
    const current = await getRadarrByName(cache, decodedName);
    if (!current) {
      return fail(404, { error: 'Naming config not found' });
    }

    const formData = await request.formData();
    const newName = formData.get('name') as string;
    const layerResult = parseOperationLayer(formData.get('layer'));
    if ('error' in layerResult) {
      return fail(400, { error: layerResult.error });
    }
    const layer = layerResult.value;

    if (!newName?.trim()) {
      return fail(400, { error: 'Name is required' });
    }

    if (layer === 'base' && !canWriteToBase(currentDatabaseId)) {
      return fail(403, { error: 'Cannot write to base layer without personal access token' });
    }

    const rename = formData.get('rename') === 'true';
    const movieFormat = formData.get('movieFormat') as string;
    const movieFolderFormat = formData.get('movieFolderFormat') as string;
    const replaceIllegalCharacters = formData.get('replaceIllegalCharacters') === 'true';
    const colonReplacementFormat = formData.get(
      'colonReplacementFormat'
    ) as RadarrNamingRow['colon_replacement_format'];

    const movieFormatValidation = validateNamingFormat(movieFormat || '', 'radarr');
    if (!movieFormatValidation.valid) {
      return fail(400, { error: `Movie format: ${movieFormatValidation.errors.join(', ')}` });
    }
    const folderFormatValidation = validateNamingFormat(movieFolderFormat || '', 'radarr');
    if (!folderFormatValidation.valid) {
      return fail(400, { error: `Folder format: ${folderFormatValidation.errors.join(', ')}` });
    }

    if (!colonReplacementFormat) {
      return fail(400, { error: 'Colon replacement format is required' });
    }

    let result;
    try {
      result = await updateRadarrNaming({
        databaseId: currentDatabaseId,
        cache,
        layer,
        current,
        input: {
          name: newName.trim(),
          rename,
          movieFormat: movieFormat || '',
          movieFolderFormat: movieFolderFormat || '',
          replaceIllegalCharacters,
          colonReplacementFormat,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update naming config';
      if (message.includes('already exists')) {
        return fail(400, { error: message });
      }
      return fail(500, { error: message });
    }

    if (!result.success) {
      return fail(500, { error: result.error || 'Failed to update naming config' });
    }

    if (newName.trim() !== decodedName) {
      try {
        arrSyncQueries.updateNamingConfigName(decodedName, newName.trim(), {
          arrType: 'radarr',
          databaseId: currentDatabaseId,
        });
      } catch (err) {
        await logger.error('Failed to sync updated Radarr naming config name', {
          source: 'naming-update',
          meta: {
            databaseId: currentDatabaseId,
            oldName: decodedName,
            newName: newName.trim(),
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }

    throw redirect(303, `/media-management/${databaseId}/naming`);
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
    const current = await getRadarrByName(cache, decodedName);
    if (!current) {
      return fail(404, { error: 'Naming config not found' });
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

    let result;
    try {
      result = await removeRadarrNaming({
        databaseId: currentDatabaseId,
        cache,
        layer,
        current,
      });
    } catch (err) {
      await logger.error('Failed to delete Radarr naming config', {
        source: 'naming-delete',
        meta: {
          databaseId: currentDatabaseId,
          name: decodedName,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      return fail(500, { error: err instanceof Error ? err.message : 'Failed to delete naming config' });
    }

    if (!result.success) {
      return fail(500, { error: result.error || 'Failed to delete naming config' });
    }

    throw redirect(303, `/media-management/${databaseId}/naming`);
  },
};
