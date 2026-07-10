import { jobQueueRegistry } from '../queueRegistry.ts';
import type { JobHandler } from '../queueTypes.ts';
import { syncHistoryQueries } from '$db/queries/syncHistory.ts';
import { syncHistorySettingsQueries } from '$db/queries/syncHistorySettings.ts';
import { calculateNextRunFromSchedule } from '../scheduleUtils.ts';
import { logger } from '$logger/logger.ts';

/**
 * Sync history retention handler. Prunes the append-only `sync_history` table by
 * age first, then caps the remaining rows to `retention_max_entries`. Mirrors
 * `logsCleanup` — `rescheduleAt` (only when scheduled) is what makes it recur
 * daily; a manual "Run now" must not self-perpetuate.
 */
const syncHistoryCleanupHandler: JobHandler = async (job) => {
  const settings = syncHistorySettingsQueries.get();
  if (settings.enabled !== 1) {
    return { status: 'cancelled', decision: 'Sync history disabled' };
  }

  const nextRun = calculateNextRunFromSchedule('daily');
  const rescheduleAt = job.source === 'schedule' ? nextRun : undefined;

  try {
    const byAge = syncHistoryQueries.pruneOlderThan(settings.retention_days);
    const byCount = syncHistoryQueries.pruneBeyondMaxEntries(settings.retention_max_entries);
    const total = byAge + byCount;
    const output = `Pruned ${byAge} (age) + ${byCount} (cap) sync history row(s)`;

    if (total === 0) {
      return { status: 'skipped', decision: 'No sync history rows to prune', rescheduleAt };
    }

    return { status: 'success', output, rescheduleAt };
  } catch (error) {
    await logger.error('Sync history cleanup failed', {
      source: 'SyncHistoryCleanupJob',
      meta: { jobId: job.id, error },
    });
    return { status: 'failure', failureCode: 'database', rescheduleAt };
  }
};

jobQueueRegistry.register('sync.history.cleanup', syncHistoryCleanupHandler);
