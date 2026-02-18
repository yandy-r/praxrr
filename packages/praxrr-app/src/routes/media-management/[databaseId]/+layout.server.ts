import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { pcdManager } from '$pcd/index.ts';
import { canWriteToBase } from '$pcd/index.ts';

export const load: LayoutServerLoad = async ({ params }) => {
  const { databaseId } = params;

  if (!databaseId) {
    throw error(400, 'Missing database ID');
  }

  const databases = pcdManager.getAll();
  const currentDatabaseId = parseInt(databaseId, 10);

  if (isNaN(currentDatabaseId)) {
    throw error(400, 'Invalid database ID');
  }

  const currentDatabase = databases.find((db) => db.id === currentDatabaseId);
  if (!currentDatabase) {
    throw error(404, 'Database not found');
  }

  return {
    databases,
    currentDatabase,
    canWriteToBase: canWriteToBase(currentDatabaseId),
  };
};
