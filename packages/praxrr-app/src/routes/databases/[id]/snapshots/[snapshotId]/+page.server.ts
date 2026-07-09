import type { PageServerLoad } from './$types';

/**
 * Snapshot detail load.
 *
 * The parent `databases/[id]` layout already validates the database. This load only validates
 * the `[snapshotId]` path param (strict digits-only) and never throws a SvelteKit error page —
 * an invalid id resolves to an inline `error`. The full detail and rollback preview are fetched
 * client-side (mirrors the sync-history detail surface), which own existence (404) and the
 * reconstructable/degrade cases.
 */
export const load: PageServerLoad = ({ params }) => {
  const databaseId = Number.parseInt(params.id ?? '', 10);
  const rawSnapshotId = params.snapshotId ?? '';

  if (!Number.isInteger(databaseId) || databaseId <= 0) {
    return { databaseId: null, snapshotId: null, error: 'Invalid database id' };
  }

  if (!/^\d+$/.test(rawSnapshotId)) {
    return { databaseId, snapshotId: null, error: 'Invalid snapshot id' };
  }

  return { databaseId, snapshotId: Number(rawSnapshotId), error: null };
};
