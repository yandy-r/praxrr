import { error, type ServerLoad } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';
import { list } from '$pcd/entities/mediaManagement/quality-definitions/read.ts';
import { trashGuideManager } from '$lib/server/trashguide/manager.ts';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import type { SourcedQualityDefinitionListItem } from '$shared/pcd/display.ts';
import {
  toSourcedQualityDefinitionListItem,
  type TrashGuideSourceRef,
} from '$lib/server/trashguide/displayTransform.ts';
import { isTrashGuideSupportedArrType } from '$lib/server/trashguide/types.ts';
import { getTrashSourceDisplayName } from '$shared/arr/displayName.ts';
import { logger } from '$logger/logger.ts';
import {
  buildSourceContext,
  isTrashSource,
  listTrashSourcesSafely,
  resolveDatabases,
  sortRowsByNameAndSource,
  withPcdSource,
} from '$server/utils/sourceContext.ts';

export const load: ServerLoad = async ({ params }) => {
  const { databaseId } = params;

  if (!databaseId) {
    throw error(400, 'Missing database ID');
  }

  const currentDatabaseId = parseInt(databaseId, 10);
  if (isNaN(currentDatabaseId)) {
    throw error(400, 'Invalid database ID');
  }

  if (!pcdManager.getCache(currentDatabaseId)) {
    throw error(500, 'Database cache not available');
  }

  const databases = resolveDatabases({
    resolveDatabases: () => pcdManager.getAll(),
    onDatabaseNotInitialized: (error) => {
      void logger.error('Cannot resolve PCD databases for quality definitions page', {
        source: 'media-management:quality-definitions',
        meta: {
          currentDatabaseId,
          reason: error.message,
        },
      });
    },
  });
  const allTrashSources = listTrashSourcesSafely({
    listSources: () => trashGuideManager.listSources(),
    onDatabaseNotInitialized: (error) => {
      void logger.warn('TRaSH sources not available: database is not initialized', {
        source: 'media-management:quality-definitions',
        meta: { error: error.message },
      });
    },
  });
  const sourceContext = buildSourceContext(
    databases,
    databases.find((database) => database.id === currentDatabaseId),
    allTrashSources,
    (source) => source.entityCounts.qualitySizes,
    (source) => getTrashSourceDisplayName(source.arrType),
    'quality definitions'
  );
  const pcdRows = (
    await Promise.all(
      databases.map(async (database) => {
        const cache = pcdManager.getCache(database.id);
        if (!cache) {
          return [] as SourcedQualityDefinitionListItem[];
        }

        const rows = await list(cache);
        return withPcdSource(rows, database);
      })
    )
  ).flat();

  const trashRows = sourceContext.availableSources.filter(isTrashSource).flatMap((source) => {
    if (!isTrashGuideSupportedArrType(source.arrType)) {
      return [] as SourcedQualityDefinitionListItem[];
    }

    const sourceRef: TrashGuideSourceRef = {
      id: source.id,
      name: source.name,
      arrType: source.arrType,
    };

    return trashGuideEntityCacheQueries
      .getBySourceAndType(source.id, 'quality_size')
      .map((entity) => toSourcedQualityDefinitionListItem(entity, sourceRef))
      .filter((row): row is SourcedQualityDefinitionListItem => row !== null);
  });

  const qualityDefinitionsConfigs = sortRowsByNameAndSource([...pcdRows, ...trashRows], (a, b) => {
    const byType = a.arr_type.localeCompare(b.arr_type, undefined, { sensitivity: 'base' });
    if (byType !== 0) return byType;

    const sourceA = a.sourceDatabaseName ?? '';
    const sourceB = b.sourceDatabaseName ?? '';
    return sourceA.localeCompare(sourceB, undefined, { sensitivity: 'base' });
  });

  return {
    qualityDefinitionsConfigs,
    sourceContext,
  };
};
