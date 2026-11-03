import { arrInstancesQueries, type ArrInstance } from '$db/queries/arrInstances.ts';
import { cache, getArrLibraryCachePrefix } from '$cache/cache.ts';
import { cleanupJobsForArrInstance } from '$lib/server/jobs/cleanup.ts';

export const ENV_MANAGED_DELETE_ERROR =
  'Environment-managed instances cannot be deleted. Remove the environment variables and restart.';

export type DeleteArrInstanceResult =
  | { ok: true; instance: ArrInstance }
  | { ok: false; reason: 'not_found' | 'env_managed' | 'delete_failed'; instance?: ArrInstance };

/**
 * Single entry point for deleting an Arr instance from the UI. Env-managed instances are refused
 * before any side effect: the env loader would re-create them on restart with empty configs.
 */
export function deleteArrInstance(id: number): DeleteArrInstanceResult {
  const instance = arrInstancesQueries.getById(id);
  if (!instance) {
    return { ok: false, reason: 'not_found' };
  }

  if ((instance.source ?? 'ui') === 'env') {
    return { ok: false, reason: 'env_managed', instance };
  }

  // Delete the row first: if it fails, the instance's queued jobs stay intact.
  if (!arrInstancesQueries.delete(id)) {
    return { ok: false, reason: 'delete_failed', instance };
  }

  cleanupJobsForArrInstance(id);
  cache.deleteByPrefix(getArrLibraryCachePrefix(id));
  return { ok: true, instance };
}
