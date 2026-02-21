import { error, redirect, fail } from '@sveltejs/kit';
import type { Actions, ServerLoad } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';
import { canWriteToBase } from '$pcd/index.ts';
import type { OperationLayer } from '$pcd/index.ts';
import { getLidarrByName } from '$pcd/entities/mediaManagement/naming/read.ts';
import { updateLidarrNaming } from '$pcd/entities/mediaManagement/naming/update.ts';
import { removeLidarrNaming } from '$pcd/entities/mediaManagement/naming/index.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import type { LidarrNamingRow } from '$shared/pcd/display.ts';

async function resolveLidarrNamingByRouteName(cache: ReturnType<typeof pcdManager.getCache>, routeName: string) {
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

  const resolved = await resolveLidarrNamingByRouteName(cache, name);
  if (!resolved) {
    throw error(404, 'Naming config not found');
  }

  const parentData = await parent();

  return {
    namingConfig: resolved.config,
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

    const resolved = await resolveLidarrNamingByRouteName(cache, name);
    if (!resolved) {
      return fail(404, { error: 'Naming config not found' });
    }
    const current = resolved.config;
    const resolvedName = resolved.resolvedName;

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
    const standardTrackFormat = formData.get('standardTrackFormat') as string;
    const artistName = formData.get('artistName') as string;
    const multiDiscTrackFormat = formData.get('multiDiscTrackFormat') as string;
    const artistFolderFormat = formData.get('artistFolderFormat') as string;
    const replaceIllegalCharacters = formData.get('replaceIllegalCharacters') === 'true';
    const colonReplacementFormat = formData.get(
      'colonReplacementFormat'
    ) as LidarrNamingRow['colon_replacement_format'];
    const customColonReplacementFormat = formData.get('customColonReplacementFormat') as string;

    const formatFields = [
      { name: 'Standard track format', value: standardTrackFormat },
      { name: 'Multi-disc track format', value: multiDiscTrackFormat },
      { name: 'Artist folder format', value: artistFolderFormat },
    ];
    for (const field of formatFields) {
      if (!field.value?.trim()) {
        return fail(400, { error: `${field.name} is required` });
      }
    }

    let result;
    try {
      result = await updateLidarrNaming({
        databaseId: currentDatabaseId,
        cache,
        layer,
        current,
        input: {
          name: newName.trim(),
          rename,
          standardTrackFormat: standardTrackFormat.trim(),
          artistName: (artistName as string)?.trim() || current.artist_name,
          multiDiscTrackFormat: multiDiscTrackFormat.trim(),
          artistFolderFormat: artistFolderFormat.trim(),
          replaceIllegalCharacters,
          colonReplacementFormat: colonReplacementFormat || 'smart',
          customColonReplacementFormat: customColonReplacementFormat || null,
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

    if (newName.trim() !== resolvedName) {
      arrSyncQueries.updateNamingConfigName(resolvedName, newName.trim(), {
        arrType: 'lidarr',
        databaseId: currentDatabaseId,
      });
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

    const resolved = await resolveLidarrNamingByRouteName(cache, name);
    if (!resolved) {
      return fail(404, { error: 'Naming config not found' });
    }
    const current = resolved.config;

    const formData = await request.formData();
    const layer = (formData.get('layer') as OperationLayer) || 'user';

    if (layer === 'base' && !canWriteToBase(currentDatabaseId)) {
      return fail(403, { error: 'Cannot write to base layer without personal access token' });
    }

    const result = await removeLidarrNaming({
      databaseId: currentDatabaseId,
      cache,
      layer,
      current,
    });

    if (!result.success) {
      return fail(500, { error: result.error || 'Failed to delete naming config' });
    }

    throw redirect(303, `/media-management/${databaseId}/naming`);
  },
};
