import type { ServerLoad } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { canaryRolloutQueries } from '$db/queries/canaryRollouts.ts';
import { canarySettingsQueries } from '$db/queries/canarySettings.ts';
import { isSyncPreviewArrType, type SyncPreviewArrType } from '$sync/preview/types.ts';
import type { CanaryRolloutSummary, CanarySettings } from '$sync/canary/types.ts';

/** Eligible canary-target option (id/name/type only — never credentials). */
interface CanaryInstanceOption {
  id: number;
  name: string;
  type: SyncPreviewArrType;
}

/** Typed shape returned by the canary list load. */
interface CanaryPageData {
  instances: CanaryInstanceOption[];
  rollouts: CanaryRolloutSummary[];
  settings: CanarySettings;
}

const RECENT_LIMIT = 50;

/**
 * Canary list load.
 *
 * Exposes only the eligible instance picker list (id/name/type) — the same
 * sync-preview eligibility gate used by the sync-history and drift surfaces
 * (`radarr|sonarr|lidarr`), never credentials — plus the most recent rollouts and
 * the canary settings singleton so the page can gate its own empty state.
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

  const rollouts = canaryRolloutQueries.listRecent(RECENT_LIMIT, 0);
  const settings = canarySettingsQueries.get();

  const data: CanaryPageData = { instances, rollouts, settings };
  return data;
};
