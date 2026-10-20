/**
 * Live refresh for the Arr Sync page: re-runs the page load when job or sync-history events arrive
 * for this instance, and normalizes the per-section sync status returned by the load.
 */
import { subscribeLive } from '$lib/client/events/liveInvalidate.ts';
import { LIVE_DEPENDENCY_KEYS, type LiveEvent } from '$shared/events/types.ts';

export type SectionLiveStatus = 'idle' | 'pending' | 'in_progress' | 'failed';

const SECTION_LIVE_STATUSES: readonly SectionLiveStatus[] = ['idle', 'pending', 'in_progress', 'failed'];

/**
 * Whether a live event should refresh the sync page of `instanceId`. Instance-scoped events must
 * match the instance id exactly. `trashguide.sync` jobs are source-scoped (no instance id) but feed
 * the TRaSH source data this page's load returns, so they always pass; they only trigger a
 * debounced invalidate.
 */
export function isInstanceSyncEvent(e: LiveEvent, instanceId: number): boolean {
  const isJobEvent = e.type === 'job.queued' || e.type === 'job.running' || e.type === 'job.finished';
  if (isJobEvent && e.jobType === 'trashguide.sync') return true;
  return 'instanceId' in e && e.instanceId === instanceId;
}

export function subscribeInstanceSync(instanceId: number): () => void {
  return subscribeLive({
    key: LIVE_DEPENDENCY_KEYS.sync,
    types: ['job.queued', 'job.running', 'job.finished', 'sync.recorded'],
    filter: (e) => isInstanceSyncEvent(e, instanceId),
  });
}

export function toSectionLiveStatus(raw: string | undefined): SectionLiveStatus {
  return SECTION_LIVE_STATUSES.find((status) => status === raw) ?? 'idle';
}
