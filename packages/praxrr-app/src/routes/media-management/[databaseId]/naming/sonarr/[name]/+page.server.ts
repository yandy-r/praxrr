import { error, redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { pcdManager } from '$pcd/index.ts';
import { canWriteToBase } from '$pcd/index.ts';
import type { OperationLayer } from '$pcd/index.ts';
import { getSonarrByName, updateSonarrNaming, removeSonarrNaming } from '$pcd/entities/mediaManagement/naming/index.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { logger } from '$logger/logger.ts';
import type { SonarrNamingRow } from '$shared/pcd/display.ts';
import { validateNamingFormat } from '$shared/pcd/namingTokens.ts';

export const load: PageServerLoad = async ({ params, parent }) => {
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
  const namingConfig = await getSonarrByName(cache, decodedName);

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
    const current = await getSonarrByName(cache, decodedName);
    if (!current) {
      return fail(404, { error: 'Naming config not found' });
    }

    const formData = await request.formData();
    const newName = formData.get('name') as string;
    const layer = (formData.get('layer') as OperationLayer) || 'user';

    if (!newName?.trim()) {
      return fail(400, { error: 'Name is required' });
    }

    if (layer === 'base' && !canWriteToBase(currentDatabaseId)) {
      return fail(403, { error: 'Cannot write to base layer without personal access token' });
    }

    const rename = formData.get('rename') === 'true';
    const standardEpisodeFormat = formData.get('standardEpisodeFormat') as string;
    const dailyEpisodeFormat = formData.get('dailyEpisodeFormat') as string;
    const animeEpisodeFormat = formData.get('animeEpisodeFormat') as string;
    const seriesFolderFormat = formData.get('seriesFolderFormat') as string;
    const seasonFolderFormat = formData.get('seasonFolderFormat') as string;
    const replaceIllegalCharacters = formData.get('replaceIllegalCharacters') === 'true';
    const colonReplacementFormat = formData.get(
      'colonReplacementFormat'
    ) as SonarrNamingRow['colon_replacement_format'];
    const customColonReplacementFormat = formData.get('customColonReplacementFormat') as string;
    const multiEpisodeStyle = formData.get('multiEpisodeStyle') as SonarrNamingRow['multi_episode_style'];

    const formatFields = [
      { name: 'Standard episode format', value: standardEpisodeFormat },
      { name: 'Daily episode format', value: dailyEpisodeFormat },
      { name: 'Anime episode format', value: animeEpisodeFormat },
      { name: 'Series folder format', value: seriesFolderFormat },
      { name: 'Season folder format', value: seasonFolderFormat },
    ];
    for (const field of formatFields) {
      const validation = validateNamingFormat(field.value || '', 'sonarr');
      if (!validation.valid) {
        return fail(400, { error: `${field.name}: ${validation.errors.join(', ')}` });
      }
    }

    if (!colonReplacementFormat) {
      return fail(400, { error: 'Colon replacement format is required' });
    }
    if (!multiEpisodeStyle) {
      return fail(400, { error: 'Multi-episode style is required' });
    }

    let result;
    try {
      result = await updateSonarrNaming({
        databaseId: currentDatabaseId,
        cache,
        layer,
        current,
        input: {
          name: newName.trim(),
          rename,
          standardEpisodeFormat: standardEpisodeFormat || '',
          dailyEpisodeFormat: dailyEpisodeFormat || '',
          animeEpisodeFormat: animeEpisodeFormat || '',
          seriesFolderFormat: seriesFolderFormat || '',
          seasonFolderFormat: seasonFolderFormat || '',
          replaceIllegalCharacters,
          colonReplacementFormat,
          customColonReplacementFormat: customColonReplacementFormat || null,
          multiEpisodeStyle,
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
          arrType: 'sonarr',
          databaseId: currentDatabaseId,
        });
      } catch (err) {
        await logger.error('Failed to sync updated Sonarr naming config name', {
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
    const current = await getSonarrByName(cache, decodedName);
    if (!current) {
      return fail(404, { error: 'Naming config not found' });
    }

    const formData = await request.formData();
    const layer = (formData.get('layer') as OperationLayer) || 'user';

    if (layer === 'base' && !canWriteToBase(currentDatabaseId)) {
      return fail(403, { error: 'Cannot write to base layer without personal access token' });
    }

    let result;
    try {
      result = await removeSonarrNaming({
        databaseId: currentDatabaseId,
        cache,
        layer,
        current,
      });
    } catch (err) {
      await logger.error('Failed to delete Sonarr naming config', {
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
