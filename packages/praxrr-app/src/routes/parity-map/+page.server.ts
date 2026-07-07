import type { ServerLoad } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';
import {
  computeProfileCompatibility,
  type ProfileCompatibility,
} from '$pcd/entities/qualityProfiles/compatibility.ts';

/**
 * Cross-Arr Parity Map route load.
 *
 * The static tier (matrix rows + semantic catalog) is imported client-side in
 * +page.svelte for a zero-round-trip render — this load only supplies the
 * DB-dependent tier: the database picker and, when a database is explicitly
 * selected via `?databaseId=`, its per-profile Arr-type compatibility.
 *
 * No auto-resolve of a "primary" database: `profiles` stays null until the
 * caller picks one. Never trust `arr_type = 'all'` — that's handled inside
 * `computeProfileCompatibility` already.
 */
export const load: ServerLoad = async ({ url }) => {
  const databases = pcdManager.getAll().map((database) => ({
    id: database.id,
    name: database.name,
  }));

  const databaseIdParam = url.searchParams.get('databaseId');

  if (databaseIdParam === null) {
    return { databases, selectedDatabaseId: null, profiles: null, error: undefined };
  }

  const selectedDatabaseId = Number.parseInt(databaseIdParam, 10);

  if (Number.isNaN(selectedDatabaseId) || selectedDatabaseId < 0) {
    return {
      databases,
      selectedDatabaseId: null,
      profiles: null,
      error: 'Invalid database ID',
    };
  }

  const selectedDatabase = databases.find((database) => database.id === selectedDatabaseId);
  if (!selectedDatabase) {
    return {
      databases,
      selectedDatabaseId,
      profiles: null,
      error: 'Database not found',
    };
  }

  const cache = pcdManager.getCache(selectedDatabaseId);
  if (!cache?.isBuilt()) {
    return {
      databases,
      selectedDatabaseId,
      profiles: null,
      error: 'Database cache not available',
    };
  }

  const profiles: ProfileCompatibility[] = await computeProfileCompatibility(cache);

  return { databases, selectedDatabaseId, profiles, error: undefined };
};
