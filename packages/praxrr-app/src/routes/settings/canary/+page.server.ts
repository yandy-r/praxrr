import type { ServerLoad } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { isSyncPreviewArrType, type SyncPreviewArrType } from '$sync/preview/types.ts';

interface CanaryInstanceOption {
  id: number;
  name: string;
  type: SyncPreviewArrType;
}

/**
 * Canary settings load.
 *
 * Surfaces only the eligible canary-instance picker list (id/name/type). Every settings
 * value (opt-in, default batch size, default partial policy, default canary) is fetched and
 * persisted client-side against `/api/v1/canary/settings`, so the panel re-reads the
 * authoritative server value after each save. Mirrors the drift dashboard load: only enabled
 * sync-capable instances (`radarr|sonarr|lidarr`) are listed — the same eligibility gate the
 * canary coordinator uses — and credential-adjacent fields are never surfaced.
 */
export const load: ServerLoad = () => {
  const instances: CanaryInstanceOption[] = arrInstancesQueries
    .getEnabled()
    .filter((instance) => isSyncPreviewArrType(instance.type))
    .map((instance) => ({
      id: instance.id,
      name: instance.name,
      type: instance.type as SyncPreviewArrType,
    }));

  return { instances };
};
