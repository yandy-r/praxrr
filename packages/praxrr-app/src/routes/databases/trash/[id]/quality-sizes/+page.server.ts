import type { ServerLoad } from '@sveltejs/kit';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import {
  toSourcedQualityDefinitionListItem,
  type TrashGuideSourceRef,
} from '$lib/server/trashguide/displayTransform.ts';
import { isTrashGuideSupportedArrType } from '$lib/server/trashguide/types.ts';
import type { SourcedQualityDefinitionListItem } from '$shared/pcd/display.ts';
import { logger } from '$logger/logger.ts';
import { type TrashGuideSourceResponse, trashGuideManager } from '$lib/server/trashguide/manager.ts';
import { buildSourceContext, listTrashSourcesSafely, sortRowsByNameAndSource } from '$server/utils/sourceContext.ts';

export const load: ServerLoad = async ({ parent }) => {
  const { source } = await parent();

  const allTrashSources = listTrashSourcesSafely<TrashGuideSourceResponse>({
    listSources: () => trashGuideManager.listSources(),
    onDatabaseNotInitialized: (error) => {
      void logger.warn('TRaSH sources not available: database is not initialized', {
        source: 'databases/trash:quality-sizes',
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
    (trashSource) => trashSource.entityCounts.qualitySizes,
    (trashSource) => trashSource.name,
    'quality sizes'
  );

  const qualitySizes = supportedTrashSources.flatMap((trashSource) => {
    const sourceRef: TrashGuideSourceRef = {
      id: trashSource.id,
      name: trashSource.name,
      arrType: trashSource.arrType,
    };

    return trashGuideEntityCacheQueries
      .getBySourceAndType(trashSource.id, 'quality_size')
      .map((cache) => toSourcedQualityDefinitionListItem(cache, sourceRef))
      .filter((row): row is SourcedQualityDefinitionListItem => row !== null);
  });
  const sorted = sortRowsByNameAndSource(qualitySizes, (a, b) => {
    const sourceA = a.sourceDatabaseName ?? '';
    const sourceB = b.sourceDatabaseName ?? '';
    return sourceA.localeCompare(sourceB, undefined, { sensitivity: 'base' });
  });

  return { qualitySizes: sorted, sourceContext };
};
