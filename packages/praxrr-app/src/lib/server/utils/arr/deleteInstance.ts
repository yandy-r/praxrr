import { arrInstancesQueries, type ArrInstance } from '$db/queries/arrInstances.ts';
import { cache, getArrLibraryCachePrefix } from '$cache/cache.ts';
import { cleanupJobsForArrInstance } from '$lib/server/jobs/cleanup.ts';
import { isEnvInstanceDeclared } from '$arr/envInstances.ts';

export const ENV_MANAGED_DELETE_ERROR =
  'This instance is managed by environment variables. Remove its variables and restart, then delete it.';

export type DeleteArrInstanceResult =
  | { ok: true; instance: ArrInstance }
  | { ok: false; reason: 'not_found' | 'env_managed' | 'delete_failed'; instance?: ArrInstance };

/**
 * Whether the UI may delete this instance. Env-sourced instances still declared by the current
 * environment are protected: the env loader would re-create them on restart with empty configs.
 * Env rows whose variables were removed (left disabled by reconciliation) may be deleted.
 */
export async function canDeleteArrInstance(instance: ArrInstance): Promise<boolean> {
  if ((instance.source ?? 'ui') !== 'env') {
    return true;
  }
  return !(await isEnvInstanceDeclared(instance));
}

/**
 * Single entry point for deleting an Arr instance from the UI. Protected env-managed instances
 * are refused before any side effect.
 */
export async function deleteArrInstance(id: number): Promise<DeleteArrInstanceResult> {
  const instance = arrInstancesQueries.getById(id);
  if (!instance) {
    return { ok: false, reason: 'not_found' };
  }

  if (!(await canDeleteArrInstance(instance))) {
    return { ok: false, reason: 'env_managed', instance };
  }

  // Jobs first, while the row still exists: their cancel events resolve the instance name/type.
  cleanupJobsForArrInstance(id);
  if (!arrInstancesQueries.delete(id)) {
    return { ok: false, reason: 'delete_failed', instance };
  }

  cache.deleteByPrefix(getArrLibraryCachePrefix(id));
  return { ok: true, instance };
}
