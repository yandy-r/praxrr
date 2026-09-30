import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { logger } from '$logger/logger.ts';
import { recoverInterruptedSyncs } from '$lib/server/sync/utils.ts';
import { jobDispatcher } from './dispatcher.ts';
import { scheduleAllJobs } from './schedule.ts';

export async function initializeJobs(): Promise<void> {
  await logger.debug('Initializing job queue', { source: 'JobQueue' });

  const recovered = jobQueueQueries.recoverRunning();
  if (recovered > 0) {
    await logger.info(`Recovered ${recovered} running job(s)`, {
      source: 'JobQueue',
    });
  }

  // Before the dispatcher starts, so no sync can legitimately hold a claim yet.
  await recoverInterruptedSyncs();

  scheduleAllJobs();
  jobDispatcher.start();

  await logger.info('Job queue ready', { source: 'JobQueue' });
}

export {
  scheduleAllJobs,
  scheduleArrSyncForInstance,
  scheduleUpgradeForInstance,
  scheduleRenameForInstance,
  schedulePcdSyncForDatabase,
  scheduleBackupJobs,
  scheduleLogCleanup,
  scheduleDriftCheck,
  scheduleSyncHistoryCleanup,
  scheduleConfigHealthSnapshot,
  scheduleConfigHealthCleanup,
} from './schedule.ts';
