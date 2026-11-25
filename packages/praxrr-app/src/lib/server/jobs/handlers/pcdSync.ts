import { jobQueueRegistry } from '../queueRegistry.ts';
import type { JobHandler } from '../queueTypes.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { pcdManager } from '$pcd/index.ts';
import { calculateNextRunFromMinutes } from '../scheduleUtils.ts';
import { logger } from '$logger/logger.ts';
import { isGitFetchError, type GitFetchFailureKind } from '$utils/git/errors.ts';

/** Pre-authored recovery for a fetch rejected by the remote (revoked/expired token). */
export const PCD_TOKEN_RECOVERY =
  'Update or clear the personal access token in this database’s settings, then re-run the sync.';

/**
 * Map a failed sync to its job failure code. A remote fetch rejected for credentials is a
 * `credential` failure with a token hint; everything else stays `gitNetwork`.
 */
export function pcdSyncFailure(fetchFailureKind: GitFetchFailureKind | undefined): {
  failureCode: 'credential' | 'gitNetwork';
  recovery?: string;
} {
  if (fetchFailureKind === 'auth') {
    return { failureCode: 'credential', recovery: PCD_TOKEN_RECOVERY };
  }
  return { failureCode: 'gitNetwork' };
}

function fetchFailureKindOf(error: unknown): GitFetchFailureKind | undefined {
  return isGitFetchError(error) ? error.kind : undefined;
}

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
    // The manual run owns the per-database slot; hand it back to the recurring schedule when
    // auto-sync is enabled so a "Sync now" never silently ends scheduled syncs.
    const autoRescheduleAt =
      instance.sync_strategy > 0
        ? calculateNextRunFromMinutes(new Date().toISOString(), instance.sync_strategy)
        : undefined;
    const autoRescheduleSource = autoRescheduleAt ? ('schedule' as const) : undefined;

    try {
      const syncResult = await pcdManager.sync(databaseId);
      if (!syncResult.success) {
        await logger.error('Manual database sync job failed', {
          source: 'DbSyncJob',
          meta: { jobId: job.id, databaseId, databaseName: instance.name, error: syncResult.error ?? 'Sync failed' },
        });
        return {
          status: 'failure',
          ...pcdSyncFailure(syncResult.fetchFailureKind),
          rescheduleAt: autoRescheduleAt,
          rescheduleSource: autoRescheduleSource,
        };
      }

      return {
        status: 'success',
        output: `Pulled ${syncResult.commitsBehind} update(s)`,
        rescheduleAt: autoRescheduleAt,
        rescheduleSource: autoRescheduleSource,
      };
    } catch (error) {
      await logger.error('Manual database sync job failed', {
        source: 'DbSyncJob',
        meta: { jobId: job.id, databaseId, databaseName: instance.name, error },
      });
      return {
        status: 'failure',
        ...pcdSyncFailure(fetchFailureKindOf(error)),
        rescheduleAt: autoRescheduleAt,
        rescheduleSource: autoRescheduleSource,
      };
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
    // A previous pull whose post-pull work failed must be finished even without new commits.
    const postPullPending = !updateInfo.hasUpdates && (await pcdManager.hasPendingPostPullWork(databaseId));

    if (!updateInfo.hasUpdates && !postPullPending) {
      databaseInstancesQueries.updateSyncedAt(databaseId);
      return {
        status: 'skipped',
        decision: 'No updates available',
        rescheduleAt,
      };
    }

    if (instance.auto_pull === 1 || postPullPending) {
      const syncResult = await pcdManager.sync(databaseId);
      if (!syncResult.success) {
        await logger.error('Database sync job failed', {
          source: 'DbSyncJob',
          meta: { jobId: job.id, databaseId, databaseName: instance.name, error: syncResult.error ?? 'Sync failed' },
        });
        return { status: 'failure', ...pcdSyncFailure(syncResult.fetchFailureKind), rescheduleAt };
      }

      return {
        status: 'success',
        output: postPullPending ? 'Completed an interrupted sync' : `Pulled ${syncResult.commitsBehind} update(s)`,
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
    return { status: 'failure', ...pcdSyncFailure(fetchFailureKindOf(error)), rescheduleAt };
  }
};

jobQueueRegistry.register('pcd.sync', dbSyncHandler);
