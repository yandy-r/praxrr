import type { ServerLoad } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { isSyncPreviewArrType, type SyncPreviewArrType } from '$sync/preview/types.ts';

interface ConfigHealthInstanceOption {
  id: number;
  name: string;
  type: SyncPreviewArrType;
}

/**
 * Config Health dashboard load.
 *
 * Exposes only the eligible instance picker list (id/name/type) so the page can render its
 * empty state without a fetch — every score, band, and total is fetched client-side against
 * `/api/v1/config-health/summary`. Mirrors the drift dashboard load: credential-adjacent
 * fields are never surfaced, and only enabled sync-capable instances (`radarr|sonarr|lidarr`)
 * are listed — the same eligibility gate the health service uses.
 */
export const load: ServerLoad = () => {
  const instances: ConfigHealthInstanceOption[] = arrInstancesQueries
    .getEnabled()
    .filter((instance) => isSyncPreviewArrType(instance.type))
    .map((instance) => ({
      id: instance.id,
      name: instance.name,
      type: instance.type as SyncPreviewArrType,
    }));

  return { instances };
};
