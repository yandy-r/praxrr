import { error } from '@sveltejs/kit';
import type { ServerLoad } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';
import type { SourcedNamingListItem } from '$shared/pcd/display.ts';
import { list } from '$pcd/entities/mediaManagement/naming/read.ts';
import { trashGuideManager } from '$lib/server/trashguide/manager.ts';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import type { SourceRef } from '$shared/sources/types.ts';
import { toSourcedNamingListItem, type TrashGuideSourceRef } from '$lib/server/trashguide/displayTransform.ts';
import { isTrashGuideSupportedArrType } from '$lib/server/trashguide/types.ts';
import { getTrashSourceDisplayName } from '$shared/arr/displayName.ts';
import { DatabaseNotInitializedError } from '$db/db.ts';
import { logger } from '$logger/logger.ts';

function sourceKey(source: SourceRef): string {
  return `${source.type}:${source.id}`;
}

function isTrashSource(source: SourceRef): source is Extract<SourceRef, { type: 'trash' }> {
  return source.type === 'trash';
}

function listTrashSourcesSafely(): ReturnType<typeof trashGuideManager.listSources> {
  try {
    return trashGuideManager.listSources();
  } catch (error) {
    if (error instanceof DatabaseNotInitializedError) {
      void logger.warn('TRaSH sources not available: database is not initialized', {
        source: 'media-management:naming',
        meta: { error: error.message },
      });
      return [];
    }

    throw error;
  }
}

function resolveDatabases(currentDatabaseId: number): ReturnType<typeof pcdManager.getAll> {
  try {
    return pcdManager.getAll();
  } catch (error) {
    if (error instanceof DatabaseNotInitializedError) {
      void logger.error('Cannot resolve PCD databases for naming page', {
        source: 'media-management:naming',
        meta: {
          currentDatabaseId,
          reason: error.message,
        },
      });
    }

    throw error;
  }
}

function buildSourceContext(databases: ReturnType<typeof pcdManager.getAll>, currentDatabaseId: number) {
  const allTrashSources = listTrashSourcesSafely();
  const trashSources = allTrashSources.filter((source) => source.entityCounts.naming > 0);
  const hasTrashSourceMismatch = allTrashSources.length > 0 && trashSources.length === 0;
  const currentDatabase = databases.find((database) => database.id === currentDatabaseId);

  const availableSources: SourceRef[] = [
    ...databases.map((database) => ({
      type: 'pcd' as const,
      id: database.id,
      name: database.name,
    })),
    ...trashSources.map((source) => ({
      type: 'trash' as const,
      id: source.id,
      name: getTrashSourceDisplayName(source.arrType),
      arrType: source.arrType,
    })),
  ];

  const showAllSourcesTab = availableSources.length >= 2;
  const defaultSourceKey = currentDatabase
    ? sourceKey({
        type: 'pcd',
        id: currentDatabase.id,
        name: currentDatabase.name,
      })
    : availableSources[0]
      ? sourceKey(availableSources[0])
      : 'all';

  let filterDisabledReason: string | null = null;
  if (availableSources.length === 0) {
    filterDisabledReason = hasTrashSourceMismatch
      ? 'Linked TRaSH sources do not currently provide naming configs'
      : 'No naming config sources are available';
  } else if (!showAllSourcesTab) {
    filterDisabledReason = hasTrashSourceMismatch
      ? 'Linked TRaSH sources do not currently provide naming configs'
      : 'Source filtering requires at least two sources';
  }

  return {
    availableSources,
    showAllSourcesTab,
    defaultSourceKey,
    filterDisabledReason,
  };
}

function withPcdSource(
  items: Awaited<ReturnType<typeof list>>,
  database: ReturnType<typeof pcdManager.getAll>[number]
): SourcedNamingListItem[] {
  return items.map((item) => ({
    ...item,
    sourceType: 'pcd',
    sourceDatabaseId: database.id,
    sourceDatabaseName: database.name,
  }));
}

function sortRows(rows: SourcedNamingListItem[]): SourcedNamingListItem[] {
  return [...rows].sort((a, b) => {
    const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    if (byName !== 0) return byName;

    const byType = a.arr_type.localeCompare(b.arr_type, undefined, { sensitivity: 'base' });
    if (byType !== 0) return byType;

    const sourceA = a.sourceDatabaseName ?? '';
    const sourceB = b.sourceDatabaseName ?? '';
    return sourceA.localeCompare(sourceB, undefined, { sensitivity: 'base' });
  });
}

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

  const databases = resolveDatabases(currentDatabaseId);
  const sourceContext = buildSourceContext(databases, currentDatabaseId);
  const pcdRows = (
    await Promise.all(
      databases.map(async (database) => {
        const cache = pcdManager.getCache(database.id);
        if (!cache) {
          return [] as SourcedNamingListItem[];
        }

        const rows = await list(cache);
        return withPcdSource(rows, database);
      })
    )
  ).flat();

  const trashRows = sourceContext.availableSources.filter(isTrashSource).flatMap((source) => {
    if (!isTrashGuideSupportedArrType(source.arrType)) {
      return [] as SourcedNamingListItem[];
    }

    const sourceRef: TrashGuideSourceRef = {
      id: source.id,
      name: source.name,
      arrType: source.arrType,
    };

    return trashGuideEntityCacheQueries
      .getBySourceAndType(source.id, 'naming')
      .map((entity) => toSourcedNamingListItem(entity, sourceRef))
      .filter((row): row is SourcedNamingListItem => row !== null);
  });

  const namingConfigs = sortRows([...pcdRows, ...trashRows]);

  return {
    namingConfigs,
    sourceContext,
  };
};
