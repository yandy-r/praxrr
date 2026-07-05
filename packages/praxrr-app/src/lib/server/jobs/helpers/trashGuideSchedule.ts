import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { trashGuideSourcesQueries } from '$db/queries/trashGuideSources.ts';
import { parseUTC } from '$shared/utils/dates.ts';
import { calculateNextRunFromMinutes } from '../scheduleUtils.ts';

const TRASHGUIDE_SYNC_DEDUPE_PREFIX = 'trashguide.sync:';

function getTrashGuideSyncDedupeKey(sourceId: number): string {
  return `${TRASHGUIDE_SYNC_DEDUPE_PREFIX}${sourceId}`;
}

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
    const dedupeKey = getTrashGuideSyncDedupeKey(source.id);

    if (!source.enabled || source.sync_strategy <= 0) {
      jobQueueQueries.unscheduleByDedupeKey(dedupeKey);
      continue;
    }

    const runAt = getSourceRunAt(source.last_synced_at, source.sync_strategy, nowIso, nowMs);
    const job = jobQueueQueries.upsertScheduled({
      jobType: 'trashguide.sync',
      runAt,
      payload: {
        sourceId: source.id,
        trigger: 'scheduled',
        requestedAt: nowIso,
      },
      source: 'schedule',
      dedupeKey,
    });

    scheduledRunAts.push(job.runAt);
  }

  return scheduledRunAts;
}
