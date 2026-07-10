import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { trashGuideSourcesQueries } from '$db/queries/trashGuideSources.ts';
import { parseUTC } from '$shared/utils/dates.ts';
import { calculateNextRunFromMinutes } from '../scheduleUtils.ts';
import { enqueueTrashGuideSourceSync, getTrashGuideSyncDedupeKey } from './trashGuideSyncQueue.ts';

function getSourceRunAt(lastSyncedAt: string | null, scheduleMinutes: number, nowIso: string, nowMs: number): string {
  const nextRunAt = calculateNextRunFromMinutes(lastSyncedAt, scheduleMinutes);
  const nextRunAtMs = parseUTC(nextRunAt)?.getTime() ?? nowMs;

  // Missed schedule windows should enqueue one immediate catch-up run.
  if (nextRunAtMs <= nowMs) {
    return nowIso;
  }

  return nextRunAt;
}

export function scheduleTrashGuideSyncSources(): string[] {
  const now = new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const scheduledRunAts: string[] = [];
  const sources = trashGuideSourcesQueries.getAll();

  for (const source of sources) {
    if (!source.enabled || source.sync_strategy <= 0) {
      jobQueueQueries.unscheduleByDedupeKey(getTrashGuideSyncDedupeKey(source.id));
      continue;
    }

    const runAt = getSourceRunAt(source.last_synced_at, source.sync_strategy, nowIso, nowMs);
    // Route through the shared enqueue builder so the scheduled tick snapshots source identity and
    // preserves any pending manual run's correlation token instead of blind-replacing the slot payload.
    const result = enqueueTrashGuideSourceSync({ sourceId: source.id, trigger: 'scheduled', runAt });

    scheduledRunAts.push(result.view.current?.runAt ?? runAt);
  }

  return scheduledRunAts;
}
