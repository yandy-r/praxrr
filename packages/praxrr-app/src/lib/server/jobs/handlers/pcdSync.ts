import { jobQueueRegistry } from '../queueRegistry.ts';
import type { JobHandler } from '../queueTypes.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { pcdManager } from '$pcd/index.ts';
import { calculateNextRunFromMinutes } from '../scheduleUtils.ts';
import { logger } from '$logger/logger.ts';

const dbSyncHandler: JobHandler = async (job) => {
  const databaseId = Number(job.payload.databaseId);
  if (!Number.isFinite(databaseId)) {
    return { status: 'failure', failureCode: 'invalidPayload' };
  }

  const isManualTrigger = job.source === 'manual';

  const instance = databaseInstancesQueries.getById(databaseId);
  if (!instance || instance.enabled === 0) {
    return { status: 'cancelled', decision: 'Database sync disabled' };
  }

  if (!isManualTrigger && instance.sync_strategy <= 0) {
    return { status: 'cancelled', decision: 'Auto-sync disabled' };
  }

  if (isManualTrigger) {
    try {
      const syncResult = await pcdManager.sync(databaseId);
      if (!syncResult.success) {
        await logger.error('Manual database sync job failed', {
          source: 'DbSyncJob',
          meta: { jobId: job.id, databaseId, databaseName: instance.name, error: syncResult.error ?? 'Sync failed' },
        });
        return { status: 'failure', failureCode: 'gitNetwork' };
      }

      return {
        status: 'success',
        output: `Pulled ${syncResult.commitsBehind} update(s)`,
      };
    } catch (error) {
      await logger.error('Manual database sync job failed', {
        source: 'DbSyncJob',
        meta: { jobId: job.id, databaseId, databaseName: instance.name, error },
      });
      return { status: 'failure', failureCode: 'gitNetwork' };
    }
  }

  const scheduledFromLastRun = calculateNextRunFromMinutes(instance.last_synced_at, instance.sync_strategy);

  // If not due yet, reschedule to nextRunAt
  if (job.source === 'schedule' && instance.last_synced_at) {
    const dueAt = new Date(scheduledFromLastRun).getTime();
    if (Date.now() < dueAt) {
      return {
        status: 'skipped',
        decision: 'Database sync not due',
        rescheduleAt: scheduledFromLastRun,
      };
    }
  }

  const rescheduleAt =
    job.source === 'schedule'
      ? calculateNextRunFromMinutes(new Date().toISOString(), instance.sync_strategy)
      : undefined;

  try {
    const updateInfo = await pcdManager.checkForUpdates(databaseId);

    if (!updateInfo.hasUpdates) {
      databaseInstancesQueries.updateSyncedAt(databaseId);
      return {
        status: 'skipped',
        decision: 'No updates available',
        rescheduleAt,
      };
    }

    if (instance.auto_pull === 1) {
      const syncResult = await pcdManager.sync(databaseId);
      if (!syncResult.success) {
        await logger.error('Database sync job failed', {
          source: 'DbSyncJob',
          meta: { jobId: job.id, databaseId, databaseName: instance.name, error: syncResult.error ?? 'Sync failed' },
        });
        return { status: 'failure', failureCode: 'gitNetwork', rescheduleAt };
      }

      return {
        status: 'success',
        output: `Pulled ${syncResult.commitsBehind} update(s)`,
        rescheduleAt,
      };
    }

    // Auto-pull disabled: just update last_synced_at
    databaseInstancesQueries.updateSyncedAt(databaseId);
    return {
      status: 'success',
      output: 'Updates available (auto-pull disabled)',
      rescheduleAt,
    };
  } catch (error) {
    await logger.error('Database sync job failed', {
      source: 'DbSyncJob',
      meta: { jobId: job.id, databaseId, databaseName: instance.name, error },
    });
    return { status: 'failure', failureCode: 'gitNetwork', rescheduleAt };
  }
};

jobQueueRegistry.register('pcd.sync', dbSyncHandler);
