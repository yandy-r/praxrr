import type { ServerLoad } from '@sveltejs/kit';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import { toSourcedQualityProfileRow, type TrashGuideSourceRef } from '$lib/server/trashguide/displayTransform.ts';
import { isTrashGuideSupportedArrType } from '$lib/server/trashguide/types.ts';
import type { QualityProfileTableRow } from '$shared/pcd/display.ts';
import { logger } from '$logger/logger.ts';
import { buildSourceContext, listTrashSourcesSafely, sortRowsByNameAndSource } from '$server/utils/sourceContext.ts';
import { type TrashGuideSourceResponse, trashGuideManager } from '$lib/server/trashguide/manager.ts';

export const load: ServerLoad = async ({ parent }) => {
  const { source } = await parent();

  const allTrashSources = listTrashSourcesSafely<TrashGuideSourceResponse>({
    listSources: () => trashGuideManager.listSources(),
    onDatabaseNotInitialized: (error) => {
      void logger.warn('TRaSH sources not available: database is not initialized', {
        source: 'databases/trash:quality-profiles',
        meta: { error: error.message },
      });
    },
  });
  const supportedTrashSources = allTrashSources.filter((trashSource): trashSource is TrashGuideSourceResponse =>
    isTrashGuideSupportedArrType(trashSource.arrType)
  );
  const sourceContext = buildSourceContext(
    [],
    source,
    supportedTrashSources,
    (trashSource) => trashSource.entityCounts.qualityProfiles,
    (trashSource) => trashSource.name,
    'quality profiles'
  );

  let skippedEntityCount = 0;
  const rows = supportedTrashSources.flatMap((trashSource) => {
    const sourceRef: TrashGuideSourceRef = {
      id: trashSource.id,
      name: trashSource.name,
      arrType: trashSource.arrType,
    };

    return trashGuideEntityCacheQueries.getBySourceAndType(trashSource.id, 'quality_profile').flatMap((cache) => {
      const row = toSourcedQualityProfileRow(cache, sourceRef);
      if (!row) {
        skippedEntityCount += 1;
        return [];
      }

      return [row];
    });
  });

  const qualityProfiles = sortRowsByNameAndSource(rows, (a, b) => {
    const sourceA = a.sourceDatabaseName ?? '';
    const sourceB = b.sourceDatabaseName ?? '';
    const bySource = sourceA.localeCompare(sourceB, undefined, { sensitivity: 'base' });
    if (bySource !== 0) {
      return bySource;
    }

    return a.id - b.id;
  });

  return { qualityProfiles, skippedEntityCount, sourceContext };
};
