import type { ServerLoad } from '@sveltejs/kit';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import { toSourcedNamingListItem, type TrashGuideSourceRef } from '$lib/server/trashguide/displayTransform.ts';
import { isTrashGuideSupportedArrType } from '$lib/server/trashguide/types.ts';
import type { SourcedNamingListItem } from '$shared/pcd/display.ts';
import { logger } from '$logger/logger.ts';
import { type TrashGuideSourceResponse, trashGuideManager } from '$lib/server/trashguide/manager.ts';
import { buildSourceContext, listTrashSourcesSafely, sortRowsByNameAndSource } from '$server/utils/sourceContext.ts';

export const load: ServerLoad = async ({ parent }) => {
  const { source } = await parent();

  const allTrashSources = listTrashSourcesSafely<TrashGuideSourceResponse>({
    listSources: () => trashGuideManager.listSources(),
    onDatabaseNotInitialized: (error) => {
      void logger.warn('TRaSH sources not available: database is not initialized', {
        source: 'databases/trash:naming',
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
    (trashSource) => trashSource.entityCounts.naming,
    (trashSource) => trashSource.name,
    'naming configs'
  );

  const rows = supportedTrashSources.flatMap((trashSource) => {
    const sourceRef: TrashGuideSourceRef = {
      id: trashSource.id,
      name: trashSource.name,
      arrType: trashSource.arrType,
    };

    return trashGuideEntityCacheQueries
      .getBySourceAndType(trashSource.id, 'naming')
      .map((cache) => toSourcedNamingListItem(cache, sourceRef))
      .filter((row): row is SourcedNamingListItem => row !== null);
  });

  const namingConfigs = sortRowsByNameAndSource(rows, (a, b) => {
    const sourceA = a.sourceDatabaseName ?? '';
    const sourceB = b.sourceDatabaseName ?? '';
    return sourceA.localeCompare(sourceB, undefined, { sensitivity: 'base' });
  });

  return { namingConfigs, sourceContext };
};
