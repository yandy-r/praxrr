import { jobQueueRegistry } from '../queueRegistry.ts';
import type { JobHandler } from '../queueTypes.ts';
import { configHealthSnapshotsQueries } from '$db/queries/configHealthSnapshots.ts';
import { configHealthSettingsQueries } from '$db/queries/configHealthSettings.ts';
import { calculateNextRunFromSchedule } from '../scheduleUtils.ts';
import { logger } from '$logger/logger.ts';

/**
 * Config health snapshot retention handler. Prunes the append-only `config_health_snapshots` table
 * by age first, then caps the remaining rows to `retention_max_entries`. Mirrors the sync-history
 * cleanup — `rescheduleAt` (only when scheduled) is what makes it recur daily; a manual "Run now"
 * must not self-perpetuate.
 */
const configHealthCleanupHandler: JobHandler = async (job) => {
  const settings = configHealthSettingsQueries.get();
  if (settings.enabled !== 1) {
    return { status: 'cancelled', decision: 'Config health scoring disabled' };
  }

  const nextRun = calculateNextRunFromSchedule('daily');
  const rescheduleAt = job.source === 'schedule' ? nextRun : undefined;

  try {
    const byAge = configHealthSnapshotsQueries.pruneOlderThan(settings.retention_days);
    const byCount = configHealthSnapshotsQueries.pruneBeyondMaxEntries(settings.retention_max_entries);
    const total = byAge + byCount;
    const output = `Pruned ${byAge} (age) + ${byCount} (cap) config health snapshot(s)`;

    if (total === 0) {
      return { status: 'skipped', decision: 'No config health snapshots to prune', rescheduleAt };
    }

    return { status: 'success', output, rescheduleAt };
  } catch (error) {
    await logger.error('Config health cleanup failed', {
      source: 'ConfigHealthCleanupJob',
      meta: { jobId: job.id, error },
    });
    return { status: 'failure', failureCode: 'database', rescheduleAt };
  }
};

jobQueueRegistry.register('config-health.cleanup', configHealthCleanupHandler);
