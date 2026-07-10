import type { ServerLoad } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { isSyncPreviewArrType, type SyncPreviewArrType } from '$sync/preview/types.ts';

interface ConfigHealthInstanceOption {
  id: number;
  name: string;
  type: SyncPreviewArrType;
}

/**
 * Config Health detail load.
 *
 * Validates the `[instanceId]` path param and never throws a SvelteKit error page — an
 * invalid id resolves to an inline `{ error }` (mirrors the drift detail load). The report
 * and trend series are fetched client-side from `/api/v1/config-health/{instanceId}` and
 * `/api/v1/config-health/{instanceId}/trends`, the authoritative sources for existence (404),
 * scoring, and history.
 */
export const load: ServerLoad = ({ params }) => {
  const raw = params.instanceId;
  const instances: ConfigHealthInstanceOption[] = arrInstancesQueries
    .getEnabled()
    .filter((instance) => isSyncPreviewArrType(instance.type))
    .map((instance) => ({
      id: instance.id,
      name: instance.name,
      type: instance.type as SyncPreviewArrType,
    }));

  // Strict digits-only: reject leading-numeric junk like "1e5"/"1abc"/" 1" outright.
  if (!raw || !/^\d+$/.test(raw)) {
    return { instanceId: null, error: 'Invalid instance ID', instances };
  }

  return { instanceId: Number.parseInt(raw, 10), error: undefined, instances };
};
