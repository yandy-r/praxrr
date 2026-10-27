import { error } from '@sveltejs/kit';
import type { ServerLoad } from '@sveltejs/kit';
import { buildLocallyModifiedLookup, canWriteToBase, pcdManager } from '$pcd/index.ts';
import * as delayProfileQueries from '$pcd/entities/delayProfiles/index.ts';

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

  // Load delay profiles for the current database, flagging rows with local overrides
  const isLocallyModified = buildLocallyModifiedLookup(currentDatabaseId);
  const delayProfiles = (await delayProfileQueries.list(cache)).map((row) => ({
    ...row,
    locallyModified: isLocallyModified('delayProfile', undefined, row.name),
  }));

  return {
    databases,
    currentDatabase,
    delayProfiles,
    canWriteToBase: canWriteToBase(currentDatabaseId),
  };
};
