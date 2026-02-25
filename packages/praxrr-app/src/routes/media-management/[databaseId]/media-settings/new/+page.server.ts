import { redirect, fail } from '@sveltejs/kit';
import type { Actions, ServerLoad } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';
import { canWriteToBase } from '$pcd/index.ts';
import { parseOperationLayer } from '$pcd/index.ts';
import type { ArrType } from '$shared/pcd/types.ts';
import type { PropersRepacks } from '$shared/pcd/mediaManagement.ts';
import {
  createLidarrMediaSettings,
  createRadarrMediaSettings,
  createSonarrMediaSettings,
} from '$pcd/entities/mediaManagement/media-settings/create.ts';

export const load: ServerLoad = async ({ parent }) => {
  const parentData = await parent();
  return {
    canWriteToBase: parentData.canWriteToBase,
  };
};

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
    const arrType = formData.get('arrType') as ArrType;
    const name = formData.get('name') as string;
    const layerResult = parseOperationLayer(formData.get('layer'));
    if ('error' in layerResult) {
      return fail(400, { error: layerResult.error });
    }
    const layer = layerResult.value;

    if (!name?.trim()) {
      return fail(400, { error: 'Name is required' });
    }

    if (!arrType || (arrType !== 'radarr' && arrType !== 'sonarr' && arrType !== 'lidarr')) {
      return fail(400, { error: 'Invalid arr type' });
    }

    if (layer === 'base' && !canWriteToBase(currentDatabaseId)) {
      return fail(403, { error: 'Cannot write to base layer without personal access token' });
    }

    const propersRepacks = formData.get('propersRepacks') as PropersRepacks;
    const enableMediaInfo = formData.get('enableMediaInfo') === 'true';

    let createFn:
      | typeof createRadarrMediaSettings
      | typeof createSonarrMediaSettings
      | typeof createLidarrMediaSettings;
    switch (arrType) {
      case 'radarr':
        createFn = createRadarrMediaSettings;
        break;
      case 'sonarr':
        createFn = createSonarrMediaSettings;
        break;
      case 'lidarr':
        createFn = createLidarrMediaSettings;
        break;
      default:
        return fail(400, { error: 'Invalid arr type' });
    }

    let result;
    try {
      result = await createFn({
        databaseId: currentDatabaseId,
        cache,
        layer,
        input: {
          name: name.trim(),
          propersRepacks: propersRepacks || 'doNotPrefer',
          enableMediaInfo,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : `Failed to create ${arrType} media settings`;
      if (message.includes('already exists')) {
        return fail(400, { error: message });
      }
      return fail(500, { error: message });
    }

    if (!result.success) {
      return fail(500, { error: result.error || `Failed to create ${arrType} media settings` });
    }

    throw redirect(303, `/media-management/${databaseId}/media-settings`);
  },
};
