/**
 * Live refresh for the Arr Sync page: re-runs the page load when job or sync-history events arrive
 * for this instance, and normalizes the per-section sync status returned by the load.
 */
import { subscribeLive } from '$lib/client/events/liveInvalidate.ts';
import { LIVE_DEPENDENCY_KEYS } from '$shared/events/types.ts';

export type SectionLiveStatus = 'idle' | 'pending' | 'in_progress' | 'failed';

const SECTION_LIVE_STATUSES: readonly SectionLiveStatus[] = ['idle', 'pending', 'in_progress', 'failed'];

export function subscribeInstanceSync(instanceId: number): () => void {
  return subscribeLive({
    key: LIVE_DEPENDENCY_KEYS.sync,
    types: ['job.queued', 'job.running', 'job.finished', 'sync.recorded'],
    filter: (e) => 'instanceId' in e && e.instanceId === instanceId,
  });
}

export function toSectionLiveStatus(raw: string | undefined): SectionLiveStatus {
  return SECTION_LIVE_STATUSES.find((status) => status === raw) ?? 'idle';
}
