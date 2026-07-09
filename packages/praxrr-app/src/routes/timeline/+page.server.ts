import type { ServerLoad } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { isSyncPreviewArrType, type SyncPreviewArrType } from '$sync/preview/types.ts';

/** Eligible Arr-instance scope option (id/name/type only — never credentials). */
interface TimelineInstanceOption {
  id: number;
  name: string;
  type: SyncPreviewArrType;
}

/** PCD-database scope option. */
interface TimelineDatabaseOption {
  id: number;
  name: string;
}

/**
 * Timeline dashboard load.
 *
 * Exposes only the two scope pickers (arr instances + PCD databases). Every event, count, and
 * annotation is fetched client-side from `/api/v1/timeline`; nothing credential-adjacent is
 * surfaced. Only enabled sync-capable instances (`radarr|sonarr|lidarr`) are listed — the same
 * eligibility gate the other read dashboards use.
 */
export const load: ServerLoad = () => {
  const instances: TimelineInstanceOption[] = arrInstancesQueries
    .getEnabled()
    .filter((instance) => isSyncPreviewArrType(instance.type))
    .map((instance) => ({ id: instance.id, name: instance.name, type: instance.type as SyncPreviewArrType }));

  const databases: TimelineDatabaseOption[] = databaseInstancesQueries
    .getAll()
    .map((database) => ({ id: database.id, name: database.name }));

  return { instances, databases };
};
