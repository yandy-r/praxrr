import { error } from '@sveltejs/kit';
import type { ServerLoad } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';
import * as qualityProfileQueries from '$pcd/entities/qualityProfiles/index.ts';
import { isParserHealthy } from '$lib/server/utils/arr/parser/index.ts';
import { trashGuideManager } from '$lib/server/trashguide/manager.ts';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import { toSourcedQualityProfileRow, type TrashGuideSourceRef } from '$lib/server/trashguide/displayTransform.ts';
import { isTrashGuideSupportedArrType } from '$lib/server/trashguide/types.ts';

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
  const trashProfiles = trashGuideManager.listSources().flatMap((source) => {
    if (!isTrashGuideSupportedArrType(source.arrType)) {
      return [];
    }

    const sourceRef: TrashGuideSourceRef = {
      id: source.id,
      name: source.name,
      arrType: source.arrType,
    };

    return trashGuideEntityCacheQueries
      .getBySourceAndType(source.id, 'quality_profile')
      .map((entity) => toSourcedQualityProfileRow(entity, sourceRef))
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .map((row) => ({
        id: row.id,
        name: row.name,
        value: `trash:${source.id}:${encodeURIComponent(row.name)}`,
        displayName: `${row.name} (TRaSH ${source.name})`,
      }));
  });

  const qualityProfiles = [
    ...pcdProfiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      value: `pcd:${encodeURIComponent(profile.name)}`,
      displayName: profile.name,
    })),
    ...trashProfiles,
  ];
  const parserAvailable = await isParserHealthy();

  return {
    databases,
    currentDatabase,
    qualityProfiles,
    parserAvailable,
  };
};
