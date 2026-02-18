import { error, fail } from '@sveltejs/kit';
import type { Actions, ServerLoad } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { arrRenameSettingsQueries } from '$db/queries/arrRenameSettings.ts';
import { renameRunsQueries } from '$db/queries/renameRuns.ts';
import { logger } from '$logger/logger.ts';
import { scheduleRenameForInstance } from '$lib/server/jobs/init.ts';
import { enqueueJob } from '$lib/server/jobs/queueService.ts';
import { cancelQueuedRenameJobs } from '$lib/server/jobs/renameHelpers.ts';
import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { buildJobDisplayName } from '$lib/server/jobs/display.ts';
import { isArrAppType, supportsArrWorkflow, ARR_APPS } from '$shared/arr/capabilities.ts';

function getRenameUnsupportedError(instanceType: string): string | null {
  if (!isArrAppType(instanceType)) {
    return `Rename is not supported for unknown instance type: ${instanceType}`;
  }

  if (!supportsArrWorkflow(instanceType, 'rename')) {
    const label = ARR_APPS[instanceType].label;
    return `Rename is not supported for ${label} instances`;
  }

  return null;
}

export const load: ServerLoad = ({ params }) => {
  const id = parseInt(params.id || '', 10);

  if (isNaN(id)) {
    error(404, `Invalid instance ID: ${params.id}`);
  }

  const instance = arrInstancesQueries.getById(id);

  if (!instance) {
    error(404, `Instance not found: ${id}`);
  }

  const settings = arrRenameSettingsQueries.getByInstanceId(id);
  const renameRuns = renameRunsQueries.getByInstanceId(id);

  return {
    instance,
    settings: settings ?? null,
    renameRuns,
  };
};

export const actions: Actions = {
  save: async ({ params, request }) => {
    const id = parseInt(params.id || '', 10);

    if (isNaN(id)) {
      return fail(400, { error: 'Invalid instance ID' });
    }

    const instance = arrInstancesQueries.getById(id);
    if (!instance) {
      return fail(404, { error: 'Instance not found' });
    }

    const unsupportedError = getRenameUnsupportedError(instance.type);
    if (unsupportedError) {
      cancelQueuedRenameJobs(id);
      return fail(400, { error: unsupportedError });
    }

    const formData = await request.formData();

    try {
      const enabled = formData.get('enabled') === 'true';
      const dryRun = formData.get('dryRun') === 'true';
      const renameFolders = formData.get('renameFolders') === 'true';
      const ignoreTag = (formData.get('ignoreTag') as string) || null;
      const schedule = parseInt(formData.get('schedule') as string, 10) || 1440;
      const summaryNotifications = formData.get('summaryNotifications') === 'true';

      const settingsData = {
        enabled,
        dryRun,
        renameFolders,
        ignoreTag,
        schedule,
        summaryNotifications,
      };

      arrRenameSettingsQueries.upsert(id, settingsData);
      scheduleRenameForInstance(id);

      await logger.info(`Rename settings saved for instance "${instance.name}"`, {
        source: 'rename',
        meta: { instanceId: id, instanceName: instance.name },
      });

      await logger.debug('Rename settings details', {
        source: 'rename',
        meta: {
          instanceId: id,
          ...settingsData,
        },
      });

      return { success: true };
    } catch (err) {
      await logger.error('Failed to save rename settings', {
        source: 'rename',
        meta: { instanceId: id, error: err },
      });
      return fail(500, { error: 'Failed to save configuration' });
    }
  },

  update: async ({ params, request }) => {
    const id = parseInt(params.id || '', 10);

    if (isNaN(id)) {
      return fail(400, { error: 'Invalid instance ID' });
    }

    const instance = arrInstancesQueries.getById(id);
    if (!instance) {
      return fail(404, { error: 'Instance not found' });
    }

    const unsupportedError = getRenameUnsupportedError(instance.type);
    if (unsupportedError) {
      cancelQueuedRenameJobs(id);
      return fail(400, { error: unsupportedError });
    }

    const existing = arrRenameSettingsQueries.getByInstanceId(id);
    if (!existing) {
      return fail(404, { error: 'Configuration not found' });
    }

    const formData = await request.formData();

    try {
      const enabled = formData.get('enabled') === 'true';
      const dryRun = formData.get('dryRun') === 'true';
      const renameFolders = formData.get('renameFolders') === 'true';
      const ignoreTag = (formData.get('ignoreTag') as string) || null;
      const schedule = parseInt(formData.get('schedule') as string, 10) || 1440;
      const summaryNotifications = formData.get('summaryNotifications') === 'true';

      const settingsData = {
        enabled,
        dryRun,
        renameFolders,
        ignoreTag,
        schedule,
        summaryNotifications,
      };

      arrRenameSettingsQueries.update(id, settingsData);
      scheduleRenameForInstance(id);

      await logger.info(`Rename settings updated for instance "${instance.name}"`, {
        source: 'rename',
        meta: { instanceId: id, instanceName: instance.name },
      });

      await logger.debug('Rename settings details', {
        source: 'rename',
        meta: {
          instanceId: id,
          ...settingsData,
        },
      });

      return { success: true };
    } catch (err) {
      await logger.error('Failed to update rename settings', {
        source: 'rename',
        meta: { instanceId: id, error: err },
      });
      return fail(500, { error: 'Failed to update configuration' });
    }
  },

  run: async ({ params }) => {
    const id = parseInt(params.id || '', 10);

    if (isNaN(id)) {
      return fail(400, { error: 'Invalid instance ID' });
    }

    const instance = arrInstancesQueries.getById(id);
    if (!instance) {
      return fail(404, { error: 'Instance not found' });
    }

    const unsupportedError = getRenameUnsupportedError(instance.type);
    if (unsupportedError) {
      cancelQueuedRenameJobs(id);
      return fail(400, { error: unsupportedError });
    }

    const settings = arrRenameSettingsQueries.getByInstanceId(id);
    if (!settings) {
      return fail(404, { error: 'No rename configuration found. Save a configuration first.' });
    }

    try {
      const scheduled = jobQueueQueries.getByDedupeKey(`arr.rename:${id}`);
      const warning =
        scheduled && (scheduled.status === 'queued' || scheduled.status === 'running')
          ? 'A rename job is already queued. This run was queued anyway.'
          : undefined;

      const queued = enqueueJob({
        jobType: 'arr.rename',
        runAt: new Date().toISOString(),
        payload: { instanceId: id },
        source: 'manual',
      });

      await logger.info('Manual rename run queued', {
        source: 'rename',
        meta: {
          jobId: queued.id,
          instanceId: id,
          instanceName: instance.name,
          displayName: buildJobDisplayName('arr.rename', { instanceId: id }),
          warning,
        },
      });

      return { success: true, queued: true, warning };
    } catch (err) {
      await logger.error('Manual rename run failed', {
        source: 'rename',
        meta: { instanceId: id, error: err },
      });

      return fail(500, { error: 'Rename run failed. Check logs for details.' });
    }
  },
};
