import { error, type ServerLoad } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';
import type { QualityDefinitionListItem } from '$shared/pcd/display.ts';
import { list } from '$pcd/entities/mediaManagement/quality-definitions/read.ts';

export const load: ServerLoad = async ({ params }) => {
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

  const qualityDefinitionsConfigs: QualityDefinitionListItem[] = await list(cache);

  return {
    qualityDefinitionsConfigs,
  };
};
