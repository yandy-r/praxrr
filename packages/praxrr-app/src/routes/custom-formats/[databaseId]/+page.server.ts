import { error } from '@sveltejs/kit';
import type { ServerLoad } from '@sveltejs/kit';
import { pcdManager, canWriteToBase } from '$pcd/index.ts';
import * as customFormatQueries from '$pcd/entities/customFormats/index.ts';
import { trashGuideManager } from '$lib/server/trashguide/manager.ts';
import type { SourceRef } from '$shared/sources/types.ts';

function sourceKey(source: SourceRef): string {
  return `${source.type}:${source.id}`;
}

function buildSourceContext(
  databases: ReturnType<typeof pcdManager.getAll>,
  currentDatabase: ReturnType<typeof pcdManager.getAll>[number]
) {
  const allTrashSources = trashGuideManager.listSources();
  const trashSources = allTrashSources.filter((source) => source.entityCounts.customFormats > 0);
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
    id: currentDatabase.id,
    name: currentDatabase.name,
  });

  let filterDisabledReason: string | null = null;
  if (availableSources.length === 0) {
    filterDisabledReason = hasTrashSourceMismatch
      ? 'Linked TRaSH sources do not currently provide custom formats'
      : 'No custom format sources are available';
  } else if (!showAllSourcesTab) {
    filterDisabledReason = hasTrashSourceMismatch
      ? 'Linked TRaSH sources do not currently provide custom formats'
      : 'Source filtering requires at least two sources';
  }

  return {
    availableSources,
    showAllSourcesTab,
    defaultSourceKey,
    filterDisabledReason,
  };
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

  // Get the cache for the database
  const cache = pcdManager.getCache(currentDatabaseId);
  if (!cache) {
    throw error(500, 'Database cache not available');
  }

  // Load custom formats for the current database
  const customFormats = await customFormatQueries.list(cache);
  const sourceContext = buildSourceContext(databases, currentDatabase);

  return {
    databases,
    currentDatabase,
    customFormats,
    canWriteToBase: canWriteToBase(currentDatabaseId),
    sourceContext,
  };
};
