import type { ServerLoad } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { isSyncPreviewArrType, type SyncPreviewArrType } from '$sync/preview/types.ts';

interface DriftInstanceOption {
  id: number;
  name: string;
  type: SyncPreviewArrType;
}

/**
 * Drift dashboard load.
 *
 * Exposes only the eligible instance picker list (id/name/type) — every drift status,
 * count, and settings value is fetched client-side against `/api/v1/drift/summary` so the
 * dashboard can refresh without a full navigation. Mirrors the resolved-config load:
 * credential-adjacent fields are never surfaced, and only enabled sync-capable instances
 * (`radarr|sonarr|lidarr`) are listed — the same eligibility gate the drift service uses.
 */
export const load: ServerLoad = () => {
  const instances: DriftInstanceOption[] = arrInstancesQueries
    .getEnabled()
    .filter((instance) => isSyncPreviewArrType(instance.type))
    .map((instance) => ({
      id: instance.id,
      name: instance.name,
      type: instance.type as SyncPreviewArrType,
    }));

  return { instances };
};
