import { error } from '@sveltejs/kit';
import type { ServerLoad } from '@sveltejs/kit';
import { pcdManager, canWriteToBase } from '$pcd/index.ts';
import * as qualityProfileQueries from '$pcd/entities/qualityProfiles/index.ts';
import { trashGuideManager } from '$lib/server/trashguide/manager.ts';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import type { QualityProfileTableRow } from '$shared/pcd/display.ts';
import { toSourcedQualityProfileRow, type TrashGuideSourceRef } from '$lib/server/trashguide/displayTransform.ts';
import { isTrashGuideSupportedArrType } from '$lib/server/trashguide/types.ts';
import {
  buildSourceContext,
  isTrashSource,
  sortRowsByNameAndSource,
  withPcdSource,
} from '$server/utils/sourceContext.ts';

export const load: ServerLoad = async ({ params }) => {
  const { databaseId } = params;

  // Validate params exist
  if (!databaseId) {
    throw error(400, 'Missing database ID');
  }

  // Get all databases for tabs
  const databases = pcdManager.getAll();

  // Parse and validate the database ID
  const currentDatabaseId = parseInt(databaseId, 10);
  if (isNaN(currentDatabaseId)) {
    throw error(400, 'Invalid database ID');
  }

  // Get the current database instance
  const currentDatabase = databases.find((db) => db.id === currentDatabaseId);

  if (!currentDatabase) {
    throw error(404, 'Database not found');
  }

  if (!pcdManager.getCache(currentDatabaseId)) {
    throw error(500, 'Database cache not available');
  }

  const sourceContext = buildSourceContext(
    databases,
    currentDatabase,
    trashGuideManager.listSources(),
    (source) => source.entityCounts.qualityProfiles,
    (source) => source.name,
    'quality profiles'
  );
  const pcdRows = (
    await Promise.all(
      databases.map(async (database) => {
        const cache = pcdManager.getCache(database.id);
        if (!cache) {
          return [] as QualityProfileTableRow[];
        }

        const rows = await qualityProfileQueries.list(cache);
        return withPcdSource(rows, database);
      })
    )
  ).flat();

  const trashRows = sourceContext.availableSources.filter(isTrashSource).flatMap((source) => {
    if (!isTrashGuideSupportedArrType(source.arrType)) {
      return [] as QualityProfileTableRow[];
    }

    const sourceRef: TrashGuideSourceRef = {
      id: source.id,
      name: source.name,
      arrType: source.arrType,
    };

    return trashGuideEntityCacheQueries
      .getBySourceAndType(source.id, 'quality_profile')
      .map((entity) => toSourcedQualityProfileRow(entity, sourceRef))
      .filter((row): row is QualityProfileTableRow => row !== null);
  });

  const qualityProfiles = sortRowsByNameAndSource([...pcdRows, ...trashRows], (a, b) => {
    const sourceA = a.sourceDatabaseName ?? '';
    const sourceB = b.sourceDatabaseName ?? '';
    const bySource = sourceA.localeCompare(sourceB, undefined, { sensitivity: 'base' });
    if (bySource !== 0) return bySource;

    return a.id - b.id;
  });

  return {
    databases,
    currentDatabase,
    qualityProfiles,
    canWriteToBase: canWriteToBase(currentDatabaseId),
    sourceContext,
  };
};
