import { error, type ServerLoad } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';
import { list } from '$pcd/entities/mediaManagement/quality-definitions/read.ts';
import { trashGuideManager } from '$lib/server/trashguide/manager.ts';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import type { SourceRef } from '$shared/sources/types.ts';
import type { SourcedQualityDefinitionListItem } from '$shared/pcd/display.ts';
import {
  toSourcedQualityDefinitionListItem,
  type TrashGuideSourceRef,
} from '$lib/server/trashguide/displayTransform.ts';
import { isTrashGuideSupportedArrType } from '$lib/server/trashguide/types.ts';

function sourceKey(source: SourceRef): string {
  return `${source.type}:${source.id}`;
}

function isTrashSource(source: SourceRef): source is Extract<SourceRef, { type: 'trash' }> {
  return source.type === 'trash';
}

function buildSourceContext(databases: ReturnType<typeof pcdManager.getAll>, currentDatabaseId: number) {
  const allTrashSources = trashGuideManager.listSources();
  const trashSources = allTrashSources.filter((source) => source.entityCounts.qualitySizes > 0);
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
      name: source.name,
      arrType: source.arrType,
    })),
  ];

  const showAllSourcesTab = availableSources.length >= 2;
  const defaultSourceKey = currentDatabase
    ? sourceKey({
        type: 'pcd',
        id: currentDatabaseId,
        name: currentDatabase.name,
      })
    : availableSources[0]
      ? sourceKey(availableSources[0])
      : 'all';

  let filterDisabledReason: string | null = null;
  if (availableSources.length === 0) {
    filterDisabledReason = hasTrashSourceMismatch
      ? 'Linked TRaSH sources do not currently provide quality definitions'
      : 'No quality definitions sources are available';
  } else if (!showAllSourcesTab) {
    filterDisabledReason = hasTrashSourceMismatch
      ? 'Linked TRaSH sources do not currently provide quality definitions'
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
): SourcedQualityDefinitionListItem[] {
  return items.map((item) => ({
    ...item,
    sourceType: 'pcd',
    sourceDatabaseId: database.id,
    sourceDatabaseName: database.name,
  }));
}

function sortRows(rows: SourcedQualityDefinitionListItem[]): SourcedQualityDefinitionListItem[] {
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

  const databases = pcdManager.getAll();
  const sourceContext = buildSourceContext(databases, currentDatabaseId);
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

  const qualityDefinitionsConfigs = sortRows([...pcdRows, ...trashRows]);

  return {
    qualityDefinitionsConfigs,
    sourceContext,
  };
};
