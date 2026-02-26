import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { upgradeConfigsQueries } from '$db/queries/upgradeConfigs.ts';
import { arrRenameSettingsQueries } from '$db/queries/arrRenameSettings.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { backupSettingsQueries } from '$db/queries/backupSettings.ts';
import { logSettingsQueries } from '$db/queries/logSettings.ts';
import { calculateNextRun } from '$lib/server/sync/utils.ts';
import { calculateNextRunFromMinutes, calculateNextRunFromSchedule } from './scheduleUtils.ts';
import { jobDispatcher } from './dispatcher.ts';
import { scheduleTrashGuideSyncSources } from './helpers/trashGuideSchedule.ts';

function notify(runAt: string | null): void {
  if (!runAt) return;
  jobDispatcher.notifyJobEnqueued(runAt);
}

/**
 * Schedules or unschedules per-section Arr sync jobs for a single instance
 * based on its current sync configuration. Removes legacy combined `arr.sync` jobs.
 *
 * @param instanceId - The Arr instance ID to schedule syncs for
 */
export function scheduleArrSyncForInstance(instanceId: number): void {
  const status = arrSyncQueries.getSyncConfigStatus(instanceId);

  const schedules = [
    { key: 'qualityProfiles', config: status.qualityProfiles, jobType: 'arr.sync.qualityProfiles' },
    { key: 'delayProfiles', config: status.delayProfiles, jobType: 'arr.sync.delayProfiles' },
    { key: 'mediaManagement', config: status.mediaManagement, jobType: 'arr.sync.mediaManagement' },
    { key: 'metadataProfiles', config: status.metadataProfiles, jobType: 'arr.sync.metadataProfiles' },
  ] as const;

  // Remove legacy combined scheduled jobs
  jobQueueQueries.unscheduleByDedupeKey(`arr.sync:${instanceId}`);

  for (const schedule of schedules) {
    const dedupeKey = `${schedule.jobType}:${instanceId}`;
    if (schedule.config.trigger !== 'schedule') {
      jobQueueQueries.unscheduleByDedupeKey(dedupeKey);
      continue;
    }

    let nextRun = schedule.config.nextRunAt;
    if (!nextRun && schedule.config.cron) {
      nextRun = calculateNextRun(schedule.config.cron) ?? null;
    }

    if (!nextRun) {
      jobQueueQueries.unscheduleByDedupeKey(dedupeKey);
      continue;
    }

    const job = jobQueueQueries.upsertScheduled({
      jobType: schedule.jobType,
      runAt: nextRun,
      payload: { instanceId },
      source: 'schedule',
      dedupeKey,
    });

    notify(job.runAt);
  }
}

/**
 * Schedules or cancels the upgrade job for a single Arr instance
 * based on its upgrade configuration.
 *
 * @param instanceId - The Arr instance ID to schedule upgrades for
 */
export function scheduleUpgradeForInstance(instanceId: number): void {
  const config = upgradeConfigsQueries.getByArrInstanceId(instanceId);
  if (!config || !config.enabled) {
    jobQueueQueries.cancelByDedupeKey(`arr.upgrade:${instanceId}`);
    return;
  }

  const baseRunAt = config.lastRunAt ?? new Date().toISOString();
  const runAt = calculateNextRunFromMinutes(baseRunAt, config.schedule);

  const job = jobQueueQueries.upsertScheduled({
    jobType: 'arr.upgrade',
    runAt,
    payload: { instanceId },
    source: 'schedule',
    dedupeKey: `arr.upgrade:${instanceId}`,
  });

  notify(job.runAt);
}

/**
 * Schedules or cancels the rename job for a single Arr instance
 * based on its rename settings.
 *
 * @param instanceId - The Arr instance ID to schedule renames for
 */
export function scheduleRenameForInstance(instanceId: number): void {
  const settings = arrRenameSettingsQueries.getByInstanceId(instanceId);
  if (!settings || !settings.enabled) {
    jobQueueQueries.cancelByDedupeKey(`arr.rename:${instanceId}`);
    return;
  }

  const baseRunAt = settings.lastRunAt ?? new Date().toISOString();
  const runAt = calculateNextRunFromMinutes(baseRunAt, settings.schedule);

  const job = jobQueueQueries.upsertScheduled({
    jobType: 'arr.rename',
    runAt,
    payload: { instanceId },
    source: 'schedule',
    dedupeKey: `arr.rename:${instanceId}`,
  });

  notify(job.runAt);
}

/**
 * Schedules or unschedules the PCD sync job for a single database instance
 * based on its sync strategy setting.
 *
 * @param databaseId - The database instance ID to schedule PCD sync for
 */
export function schedulePcdSyncForDatabase(databaseId: number): void {
  const instance = databaseInstancesQueries.getById(databaseId);
  if (!instance || instance.enabled === 0 || instance.sync_strategy <= 0) {
    jobQueueQueries.unscheduleByDedupeKey(`pcd.sync:${databaseId}`);
    return;
  }

  const baseRunAt = instance.last_synced_at ?? new Date().toISOString();
  const runAt = calculateNextRunFromMinutes(baseRunAt, instance.sync_strategy);

  const job = jobQueueQueries.upsertScheduled({
    jobType: 'pcd.sync',
    runAt,
    payload: { databaseId },
    source: 'schedule',
    dedupeKey: `pcd.sync:${databaseId}`,
  });

  notify(job.runAt);
}

/**
 * Schedules or cancels backup creation and cleanup jobs
 * based on current backup settings.
 */
export function scheduleBackupJobs(): void {
  const settings = backupSettingsQueries.get();
  if (!settings || settings.enabled !== 1) {
    jobQueueQueries.cancelByDedupeKey('backup.create');
    jobQueueQueries.cancelByDedupeKey('backup.cleanup');
    return;
  }

  const backupRunAt = calculateNextRunFromSchedule(settings.schedule);
  const cleanupRunAt = calculateNextRunFromSchedule('daily');

  const backupJob = jobQueueQueries.upsertScheduled({
    jobType: 'backup.create',
    runAt: backupRunAt,
    payload: {},
    source: 'schedule',
    dedupeKey: 'backup.create',
  });

  const cleanupJob = jobQueueQueries.upsertScheduled({
    jobType: 'backup.cleanup',
    runAt: cleanupRunAt,
    payload: {},
    source: 'schedule',
    dedupeKey: 'backup.cleanup',
  });

  notify(backupJob.runAt);
  notify(cleanupJob.runAt);
}

/**
 * Schedules or cancels the daily log cleanup job
 * based on current log settings.
 */
export function scheduleLogCleanup(): void {
  const settings = logSettingsQueries.get();
  if (!settings || settings.file_logging !== 1) {
    jobQueueQueries.cancelByDedupeKey('logs.cleanup');
    return;
  }

  const runAt = calculateNextRunFromSchedule('daily');
  const job = jobQueueQueries.upsertScheduled({
    jobType: 'logs.cleanup',
    runAt,
    payload: {},
    source: 'schedule',
    dedupeKey: 'logs.cleanup',
  });

  notify(job.runAt);
}

/**
 * Schedules sync jobs for all enabled TRaSH Guide sources and notifies the dispatcher.
 */
export function scheduleTrashGuideSyncJobs(): void {
  const runAts = scheduleTrashGuideSyncSources();
  for (const runAt of runAts) {
    notify(runAt);
  }
}

/**
 * Schedules all recurring jobs for every Arr instance, database, TRaSH Guide source,
 * backup, and log cleanup. Called once at startup and after configuration changes.
 */
export function scheduleAllJobs(): void {
  const arrInstances = arrInstancesQueries.getAll();
  for (const instance of arrInstances) {
    scheduleArrSyncForInstance(instance.id);
    scheduleUpgradeForInstance(instance.id);
    scheduleRenameForInstance(instance.id);
  }

  const databases = databaseInstancesQueries.getAll();
  for (const database of databases) {
    schedulePcdSyncForDatabase(database.id);
  }

  scheduleTrashGuideSyncJobs();
  scheduleBackupJobs();
  scheduleLogCleanup();
}
