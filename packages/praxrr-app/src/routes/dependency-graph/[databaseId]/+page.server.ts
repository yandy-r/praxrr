import type { ServerLoad } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';

/**
 * Dependency Graph route load.
 *
 * Mirrors the resolved-config load pattern (validate -> inline `{ error? }` in data, never
 * throw a SvelteKit error page). The graph itself is fetched client-side in +page.svelte
 * against `/api/v1/pcd/{databaseId}/graph`; this load only supplies the database picker and
 * validates the selected database is usable.
 */
export const load: ServerLoad = ({ params }) => {
  const databases = pcdManager.getAll().map((database) => ({
    id: database.id,
    name: database.name,
  }));

  const databaseIdParam = params.databaseId;

  // Strict digits-only: reject leading-numeric junk like "1e5"/"1abc"/" 1" outright.
  if (!databaseIdParam || !/^\d+$/.test(databaseIdParam)) {
    return {
      databases,
      selectedDatabaseId: null,
      error: 'Invalid database ID',
    };
  }

  const selectedDatabaseId = Number.parseInt(databaseIdParam, 10);

  const selectedDatabase = databases.find((database) => database.id === selectedDatabaseId);
  if (!selectedDatabase) {
    return {
      databases,
      selectedDatabaseId,
      error: 'Database not found',
    };
  }

  const cache = pcdManager.getCache(selectedDatabaseId);
  if (!cache?.isBuilt()) {
    return {
      databases,
      selectedDatabaseId,
      error: 'Database cache not available',
    };
  }

  return { databases, selectedDatabaseId, error: undefined };
};
