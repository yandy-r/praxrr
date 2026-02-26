import { error } from '@sveltejs/kit';
import type { ServerLoad } from '@sveltejs/kit';
import { pcdManager, canWriteToBase } from '$pcd/index.ts';
import * as qualityProfileQueries from '$pcd/entities/qualityProfiles/index.ts';
import { trashGuideManager } from '$lib/server/trashguide/manager.ts';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import type { SourceRef } from '$shared/sources/types.ts';
import type { QualityProfileTableRow } from '$shared/pcd/display.ts';
import { toSourcedQualityProfileRow, type TrashGuideSourceRef } from '$lib/server/trashguide/displayTransform.ts';
import { isTrashGuideSupportedArrType } from '$lib/server/trashguide/types.ts';

function sourceKey(source: SourceRef): string {
  return `${source.type}:${source.id}`;
}

function isTrashSource(source: SourceRef): source is Extract<SourceRef, { type: 'trash' }> {
  return source.type === 'trash';
}

function buildSourceContext(databases: ReturnType<typeof pcdManager.getAll>, currentDatabaseId: number) {
  const allTrashSources = trashGuideManager.listSources();
  const trashSources = allTrashSources.filter((source) => source.entityCounts.qualityProfiles > 0);
  const hasTrashSourceMismatch = allTrashSources.length > 0 && trashSources.length === 0;

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
  const defaultSourceKey = sourceKey({
    type: 'pcd',
    id: currentDatabaseId,
    name: databases.find((db) => db.id === currentDatabaseId)?.name ?? '',
  });

  let filterDisabledReason: string | null = null;
  if (availableSources.length === 0) {
    filterDisabledReason = hasTrashSourceMismatch
      ? 'Linked TRaSH sources do not currently provide quality profiles'
      : 'No quality profile sources are available';
  } else if (!showAllSourcesTab) {
    filterDisabledReason = hasTrashSourceMismatch
      ? 'Linked TRaSH sources do not currently provide quality profiles'
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
  rows: QualityProfileTableRow[],
  database: ReturnType<typeof pcdManager.getAll>[number]
): QualityProfileTableRow[] {
  return rows.map((row) => ({
    ...row,
    sourceType: 'pcd',
    sourceDatabaseId: database.id,
    sourceDatabaseName: database.name,
  }));
}

function sortRows(rows: QualityProfileTableRow[]): QualityProfileTableRow[] {
  return [...rows].sort((a, b) => {
    const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    if (byName !== 0) return byName;

    const sourceA = a.sourceDatabaseName ?? '';
    const sourceB = b.sourceDatabaseName ?? '';
    const bySource = sourceA.localeCompare(sourceB, undefined, { sensitivity: 'base' });
    if (bySource !== 0) return bySource;

    return a.id - b.id;
  });
}

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

  const sourceContext = buildSourceContext(databases, currentDatabaseId);
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

  const qualityProfiles = sortRows([...pcdRows, ...trashRows]);

  return {
    databases,
    currentDatabase,
    qualityProfiles,
    canWriteToBase: canWriteToBase(currentDatabaseId),
    sourceContext,
  };
};
