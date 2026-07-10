import { jobQueueRegistry } from '../queueRegistry.ts';
import type { JobHandler } from '../queueTypes.ts';
import { arrRenameSettingsQueries } from '$db/queries/arrRenameSettings.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { cancelQueuedRenameJobs } from '../renameHelpers.ts';
import { processRenameConfig } from '$lib/server/rename/processor.ts';
import { calculateNextRunFromMinutes } from '../scheduleUtils.ts';
import { logger } from '$logger/logger.ts';
import { classifyJobFailure } from '../evidence.ts';
import { isArrAppType, supportsArrWorkflow, ARR_APPS } from '$shared/arr/capabilities.ts';

const renameRunHandler: JobHandler = async (job) => {
  const instanceId = Number(job.payload.instanceId);
  if (!Number.isFinite(instanceId)) {
    return { status: 'failure', failureCode: 'invalidPayload' };
  }

  const instance = arrInstancesQueries.getById(instanceId);
  if (!instance) {
    return { status: 'failure', failureCode: 'targetNotFound' };
  }

  if (!isArrAppType(instance.type)) {
    try {
      cancelQueuedRenameJobs(instanceId);
    } catch {
      // Best-effort cleanup for unsupported types; continue with explicit unsupported output.
    }
    await logger.debug('Rename job skipped: unknown instance type', {
      source: 'RenameJob',
      meta: { jobId: job.id, instanceId, instanceType: instance.type },
    });
    return { status: 'skipped', decision: 'Rename not supported for this instance type' };
  }

  if (!supportsArrWorkflow(instance.type, 'rename')) {
    try {
      cancelQueuedRenameJobs(instanceId);
    } catch {
      // Best-effort cleanup for unsupported types; continue with explicit unsupported output.
    }
    const label = ARR_APPS[instance.type].label;
    return { status: 'skipped', decision: `Rename is not supported for ${label} instances` };
  }

  const settings = arrRenameSettingsQueries.getByInstanceId(instanceId);
  if (!settings || !settings.enabled) {
    return { status: 'cancelled', decision: 'Rename config disabled' };
  }

  try {
    const log = await processRenameConfig(settings, instance, job.source === 'manual');

    arrRenameSettingsQueries.updateLastRun(instanceId);

    const nextRunAt = calculateNextRunFromMinutes(new Date().toISOString(), settings.schedule);
    const rescheduleAt = job.source === 'schedule' ? nextRunAt : undefined;
    const output = settings.dryRun
      ? `${log.results.filesNeedingRename} files would be renamed`
      : `${log.results.filesRenamed}/${log.results.filesNeedingRename} files renamed`;

    if (log.status === 'failed') {
      await logger.error('Rename job reported processing errors', {
        source: 'RenameJob',
        meta: { jobId: job.id, instanceId, instanceName: instance.name, results: log.results },
      });
      return { status: 'failure', failureCode: 'upstream', output, rescheduleAt };
    }

    const status = log.results.filesNeedingRename === 0 ? 'skipped' : 'success';
    return { status, output, rescheduleAt };
  } catch (error) {
    await logger.error('Rename job failed', {
      source: 'RenameJob',
      meta: { jobId: job.id, instanceId, instanceName: instance.name, error },
    });
    return { status: 'failure', failureCode: classifyJobFailure(error) };
  }
};

jobQueueRegistry.register('arr.rename', renameRunHandler);
