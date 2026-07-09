import type { PageServerLoad } from './$types';
import type { PcdSnapshotDetail } from '$pcd/snapshots/types.ts';

/**
 * Snapshots list load.
 *
 * The parent `databases/[id]` layout already validates the database exists (404/400), so this
 * load only fetches the snapshot list for the database via the v1 API. It never throws a
 * SvelteKit error page — an API failure resolves to an inline `loadError` and an empty list so
 * the page can render its own retry/empty affordances (mirrors the sync-history surfaces).
 */
export const load: PageServerLoad = async ({ params, fetch }) => {
  const databaseId = Number.parseInt(params.id ?? '', 10);

  if (!Number.isInteger(databaseId) || databaseId <= 0) {
    return { databaseId: null, snapshots: [] as PcdSnapshotDetail[], total: 0, loadError: 'Invalid database id' };
  }

  try {
    const response = await fetch(`/api/v1/pcd/${databaseId}/snapshots?limit=200`);
    if (!response.ok) {
      return {
        databaseId,
        snapshots: [] as PcdSnapshotDetail[],
        total: 0,
        loadError: `Failed to load snapshots (HTTP ${response.status})`,
      };
    }

    const body = (await response.json()) as { snapshots: PcdSnapshotDetail[]; total: number };
    return { databaseId, snapshots: body.snapshots, total: body.total, loadError: null };
  } catch (error) {
    return {
      databaseId,
      snapshots: [] as PcdSnapshotDetail[],
      total: 0,
      loadError: error instanceof Error ? error.message : 'Failed to load snapshots',
    };
  }
};
