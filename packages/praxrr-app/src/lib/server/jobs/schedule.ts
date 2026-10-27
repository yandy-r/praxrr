import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { getPcdSyncDedupeKey } from './helpers/pcdSyncDedupeKey.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { upgradeConfigsQueries } from '$db/queries/upgradeConfigs.ts';
import { arrRenameSettingsQueries } from '$db/queries/arrRenameSettings.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { backupSettingsQueries } from '$db/queries/backupSettings.ts';
import { logSettingsQueries } from '$db/queries/logSettings.ts';
import { driftSettingsQueries } from '$db/queries/driftSettings.ts';
import { syncHistorySettingsQueries } from '$db/queries/syncHistorySettings.ts';
import { configHealthSettingsQueries } from '$db/queries/configHealthSettings.ts';
import { calculateNextRun } from '$lib/server/sync/utils.ts';
import { calculateNextRunFromMinutes, calculateNextRunFromSchedule } from './scheduleUtils.ts';
import { jobDispatcher } from './dispatcher.ts';
import { upsertScheduledJob } from './queueService.ts';
import { publishJobsCancelled } from '$lib/server/events/publish.ts';
import { scheduleTrashGuideSyncSources } from './helpers/trashGuideSchedule.ts';

function notify(runAt: string | null): void {
  if (!runAt) return;
  jobDispatcher.notifyJobEnqueued(runAt);
}

export function scheduleArrSyncForInstance(instanceId: number): void {
  const status = arrSyncQueries.getSyncConfigStatus(instanceId);

  const schedules = [
    { key: 'qualityProfiles', config: status.qualityProfiles, jobType: 'arr.sync.qualityProfiles' },
    { key: 'delayProfiles', config: status.delayProfiles, jobType: 'arr.sync.delayProfiles' },
    { key: 'mediaManagement', config: status.mediaManagement, jobType: 'arr.sync.mediaManagement' },
    { key: 'metadataProfiles', config: status.metadataProfiles, jobType: 'arr.sync.metadataProfiles' },
  ] as const;

  // Remove legacy combined scheduled jobs
  publishJobsCancelled(jobQueueQueries.unscheduleByDedupeKey(`arr.sync:${instanceId}`));

  for (const schedule of schedules) {
    const dedupeKey = `${schedule.jobType}:${instanceId}`;
    if (schedule.config.trigger !== 'schedule') {
      publishJobsCancelled(jobQueueQueries.unscheduleByDedupeKey(dedupeKey));
      continue;
    }

    let nextRun = schedule.config.nextRunAt;
    if (!nextRun && schedule.config.cron) {
      nextRun = calculateNextRun(schedule.config.cron) ?? null;
    }

    if (!nextRun) {
      publishJobsCancelled(jobQueueQueries.unscheduleByDedupeKey(dedupeKey));
      continue;
    }

    upsertScheduledJob({
      jobType: schedule.jobType,
      runAt: nextRun,
      payload: { instanceId },
      source: 'schedule',
      dedupeKey,
    });
  }
}

export function scheduleUpgradeForInstance(instanceId: number): void {
  const config = upgradeConfigsQueries.getByArrInstanceId(instanceId);
  if (!config || !config.enabled) {
    publishJobsCancelled(jobQueueQueries.cancelByDedupeKey(`arr.upgrade:${instanceId}`));
    return;
  }

  const baseRunAt = config.lastRunAt ?? new Date().toISOString();
  const runAt = calculateNextRunFromMinutes(baseRunAt, config.schedule);

  upsertScheduledJob({
    jobType: 'arr.upgrade',
    runAt,
    payload: { instanceId },
    source: 'schedule',
    dedupeKey: `arr.upgrade:${instanceId}`,
  });
}

export function scheduleRenameForInstance(instanceId: number): void {
  const settings = arrRenameSettingsQueries.getByInstanceId(instanceId);
  if (!settings || !settings.enabled) {
    publishJobsCancelled(jobQueueQueries.cancelByDedupeKey(`arr.rename:${instanceId}`));
    return;
  }

  const baseRunAt = settings.lastRunAt ?? new Date().toISOString();
  const runAt = calculateNextRunFromMinutes(baseRunAt, settings.schedule);

  upsertScheduledJob({
    jobType: 'arr.rename',
    runAt,
    payload: { instanceId },
    source: 'schedule',
    dedupeKey: `arr.rename:${instanceId}`,
  });
}

export function schedulePcdSyncForDatabase(databaseId: number): void {
  const instance = databaseInstancesQueries.getById(databaseId);
  if (!instance || instance.enabled === 0 || instance.sync_strategy <= 0) {
    publishJobsCancelled(jobQueueQueries.unscheduleByDedupeKey(getPcdSyncDedupeKey(databaseId)));
    return;
  }

  const baseRunAt = instance.last_synced_at ?? new Date().toISOString();
  const runAt = calculateNextRunFromMinutes(baseRunAt, instance.sync_strategy);

  upsertScheduledJob({
    jobType: 'pcd.sync',
    runAt,
    payload: { databaseId },
    source: 'schedule',
    dedupeKey: getPcdSyncDedupeKey(databaseId),
  });
}

export function scheduleBackupJobs(): void {
  const settings = backupSettingsQueries.get();
  if (!settings || settings.enabled !== 1) {
    publishJobsCancelled(jobQueueQueries.cancelByDedupeKey('backup.create'));
    publishJobsCancelled(jobQueueQueries.cancelByDedupeKey('backup.cleanup'));
    return;
  }

  const backupRunAt = calculateNextRunFromSchedule(settings.schedule);
  const cleanupRunAt = calculateNextRunFromSchedule('daily');

  upsertScheduledJob({
    jobType: 'backup.create',
    runAt: backupRunAt,
    payload: {},
    source: 'schedule',
    dedupeKey: 'backup.create',
  });

  upsertScheduledJob({
    jobType: 'backup.cleanup',
    runAt: cleanupRunAt,
    payload: {},
    source: 'schedule',
    dedupeKey: 'backup.cleanup',
  });
}

export function scheduleLogCleanup(): void {
  const settings = logSettingsQueries.get();
  if (!settings || settings.file_logging !== 1) {
    publishJobsCancelled(jobQueueQueries.cancelByDedupeKey('logs.cleanup'));
    return;
  }

  const runAt = calculateNextRunFromSchedule('daily');
  upsertScheduledJob({
    jobType: 'logs.cleanup',
    runAt,
    payload: {},
    source: 'schedule',
    dedupeKey: 'logs.cleanup',
  });
}

export function scheduleTrashGuideSyncJobs(): void {
  const runAts = scheduleTrashGuideSyncSources();
  for (const runAt of runAts) {
    notify(runAt);
  }
}

export function scheduleDriftCheck(): void {
  const settings = driftSettingsQueries.get();
  if (settings.enabled !== 1) {
    publishJobsCancelled(jobQueueQueries.cancelByDedupeKey('drift.check'));
    // Clear any dangling sweep cursor so a later re-enable starts a clean sweep.
    driftSettingsQueries.resetSweepProgress();
    return;
  }

  // First-ever schedule runs promptly; subsequent runs land one interval after the last sweep.
  const runAt = settings.last_run_at
    ? calculateNextRunFromMinutes(settings.last_run_at, settings.interval_minutes)
    : new Date().toISOString();

  upsertScheduledJob({
    jobType: 'drift.check',
    runAt,
    payload: {},
    source: 'schedule',
    dedupeKey: 'drift.check',
  });
}

export function scheduleSyncHistoryCleanup(): void {
  const settings = syncHistorySettingsQueries.get();
  if (settings.enabled !== 1) {
    publishJobsCancelled(jobQueueQueries.cancelByDedupeKey('sync.history.cleanup'));
    return;
  }

  const runAt = calculateNextRunFromSchedule('daily');
  upsertScheduledJob({
    jobType: 'sync.history.cleanup',
    runAt,
    payload: {},
    source: 'schedule',
    dedupeKey: 'sync.history.cleanup',
  });
}

/**
 * Schedule (or cancel) the recurring config-health snapshot sweep. On disable it cancels the job and
 * clears any dangling sweep cursor so a later re-enable starts a clean sweep (mirrors drift).
 */
export function scheduleConfigHealthSnapshot(): void {
  const settings = configHealthSettingsQueries.get();
  if (settings.enabled !== 1) {
    publishJobsCancelled(jobQueueQueries.cancelByDedupeKey('config-health.snapshot'));
    configHealthSettingsQueries.resetSweepProgress();
    return;
  }

  const runAt = settings.last_run_at
    ? calculateNextRunFromMinutes(settings.last_run_at, settings.interval_minutes)
    : new Date().toISOString();

  upsertScheduledJob({
    jobType: 'config-health.snapshot',
    runAt,
    payload: {},
    source: 'schedule',
    dedupeKey: 'config-health.snapshot',
  });
}

/** Schedule (or cancel) the daily config-health snapshot retention cleanup. */
export function scheduleConfigHealthCleanup(): void {
  const settings = configHealthSettingsQueries.get();
  if (settings.enabled !== 1) {
    publishJobsCancelled(jobQueueQueries.cancelByDedupeKey('config-health.cleanup'));
    return;
  }

  const runAt = calculateNextRunFromSchedule('daily');
  upsertScheduledJob({
    jobType: 'config-health.cleanup',
    runAt,
    payload: {},
    source: 'schedule',
    dedupeKey: 'config-health.cleanup',
  });
}

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
  scheduleDriftCheck();
  scheduleSyncHistoryCleanup();
  scheduleConfigHealthSnapshot();
  scheduleConfigHealthCleanup();
}
