import { jobQueueRegistry } from '../queueRegistry.ts';
import type { JobHandler } from '../queueTypes.ts';
import { backupSettingsQueries } from '$db/queries/backupSettings.ts';
import { config } from '$config';
import { createBackup } from '../logic/createBackup.ts';
import { calculateNextRunFromSchedule } from '../scheduleUtils.ts';
import { logger } from '$logger/logger.ts';

const backupCreateHandler: JobHandler = async (job) => {
  const settings = backupSettingsQueries.get();
  if (!settings || settings.enabled !== 1) {
    return { status: 'cancelled', decision: 'Backups disabled' };
  }

  const sourceDir = config.paths.data;
  const backupsDir = config.paths.backups;

  try {
    const result = await createBackup(sourceDir, backupsDir);
    if (!result.success) {
      await logger.error('Backup creation failed', {
        source: 'BackupCreateJob',
        meta: { jobId: job.id, error: result.error ?? 'Backup failed' },
      });
      return { status: 'failure', failureCode: 'filesystem' };
    }

    const sizeInMB = ((result.sizeBytes ?? 0) / (1024 * 1024)).toFixed(2);
    const output = `Backup created: ${result.filename} (${sizeInMB} MB)`;
    const nextRun = calculateNextRunFromSchedule(settings.schedule);
    return {
      status: 'success',
      output,
      rescheduleAt: job.source === 'schedule' ? nextRun : undefined,
    };
  } catch (error) {
    await logger.error('Backup creation failed', {
      source: 'BackupCreateJob',
      meta: { jobId: job.id, error },
    });
    return { status: 'failure', failureCode: 'filesystem' };
  }
};

jobQueueRegistry.register('backup.create', backupCreateHandler);
