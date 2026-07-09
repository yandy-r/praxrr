import { error } from '@sveltejs/kit';
import type { ServerLoad } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';
import * as qualityProfileQueries from '$pcd/entities/qualityProfiles/index.ts';

/**
 * Editor load for `/goals/[databaseId]`. Goals apply to PCD quality profiles only (they generate
 * standard PCD user ops), so only PCD profiles are offered as targets.
 */
export const load: ServerLoad = async ({ params }) => {
  const { databaseId } = params;
  if (!databaseId) {
    throw error(400, 'Missing database ID');
  }

  const databases = pcdManager.getAll();
  const currentDatabaseId = Number.parseInt(databaseId, 10);
  const currentDatabase = Number.isNaN(currentDatabaseId)
    ? undefined
    : databases.find((database) => database.id === currentDatabaseId);
  if (!currentDatabase) {
    throw error(404, 'Database not found');
  }

  const cache = pcdManager.getCache(currentDatabaseId);
  if (!cache) {
    throw error(404, 'Database cache not available');
  }

  const pcdProfiles = await qualityProfileQueries.select(cache);

  return {
    databases,
    currentDatabase,
    qualityProfiles: pcdProfiles.map((profile) => ({ id: profile.id, name: profile.name })),
  };
};
