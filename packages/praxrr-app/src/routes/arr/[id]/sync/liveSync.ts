/**
 * Live refresh for the Arr Sync page: re-runs the page load when job or sync-history events arrive
 * for this instance, and normalizes the per-section sync status returned by the load.
 */
import { subscribeLive } from '$lib/client/events/liveInvalidate.ts';
import { LIVE_DEPENDENCY_KEYS, SYNC_FAMILY_JOB_TYPES, type LiveEvent } from '$shared/events/types.ts';

export type SectionLiveStatus = 'idle' | 'pending' | 'in_progress' | 'failed';

const SECTION_LIVE_STATUSES: readonly SectionLiveStatus[] = ['idle', 'pending', 'in_progress', 'failed'];

/**
 * Whether a live event should refresh the sync page of `instanceId`. Only sync-family job events
 * qualify (upgrade, rename, drift checks and other instance jobs never change the page's data).
 * Instance-scoped events must match the instance id exactly. `trashguide.sync` jobs are
 * source-scoped (no instance id) but feed the TRaSH source data the page's load returns, so they
 * always pass; they only trigger a debounced invalidate.
 */
export function isInstanceSyncEvent(e: LiveEvent, instanceId: number): boolean {
  if (e.type === 'job.queued' || e.type === 'job.running' || e.type === 'job.finished') {
    if (!SYNC_FAMILY_JOB_TYPES.includes(e.jobType)) return false;
    return e.jobType === 'trashguide.sync' || e.instanceId === instanceId;
  }
  return e.type === 'sync.recorded' && e.instanceId === instanceId;
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
