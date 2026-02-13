import { jobQueueRegistry } from '../queueRegistry.ts';
import type { JobHandler } from '../queueTypes.ts';
import { arrRenameSettingsQueries } from '$db/queries/arrRenameSettings.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { processRenameConfig } from '$lib/server/rename/processor.ts';
import { calculateNextRunFromMinutes } from '../scheduleUtils.ts';
import { logger } from '$logger/logger.ts';
import { isArrAppType, supportsArrWorkflow, ARR_APPS } from '$shared/arr/capabilities.ts';

function cancelQueuedRenameJobs(instanceId: number): void {
	try {
		jobQueueQueries.cancelByDedupeKey(`arr.rename:${instanceId}`);

		const queuedRenameJobs = jobQueueQueries
			.listByJobTypes(['arr.rename'])
			.filter((job) => job.status === 'queued' && Number(job.payload.instanceId) === instanceId);

		for (const job of queuedRenameJobs) {
			jobQueueQueries.setStatus(job.id, 'cancelled');
		}
	} catch {
		// Best-effort cleanup for unsupported types; continue with explicit unsupported output.
	}
}

const renameRunHandler: JobHandler = async (job) => {
	const instanceId = Number(job.payload.instanceId);
	if (!Number.isFinite(instanceId)) {
		return { status: 'failure', error: 'Invalid instance ID' };
	}

	const instance = arrInstancesQueries.getById(instanceId);
	if (!instance) {
		return { status: 'failure', error: 'Arr instance not found' };
	}

	if (!isArrAppType(instance.type)) {
		cancelQueuedRenameJobs(instanceId);
		return { status: 'skipped', output: `Rename is not supported for unknown instance type: ${instance.type}` };
	}

	if (!supportsArrWorkflow(instance.type, 'rename')) {
		cancelQueuedRenameJobs(instanceId);
		const label = ARR_APPS[instance.type].label;
		return { status: 'skipped', output: `Rename is not supported for ${label} instances` };
	}

	const settings = arrRenameSettingsQueries.getByInstanceId(instanceId);
	if (!settings || !settings.enabled) {
		return { status: 'cancelled', output: 'Rename config disabled' };
	}

	try {
		const log = await processRenameConfig(settings, instance, job.source === 'manual');

		arrRenameSettingsQueries.updateLastRun(instanceId);

		const nextRunAt = calculateNextRunFromMinutes(new Date().toISOString(), settings.schedule);
		const output = settings.dryRun
			? `${log.results.filesNeedingRename} files would be renamed`
			: `${log.results.filesRenamed}/${log.results.filesNeedingRename} files renamed`;

		const status =
			log.status === 'failed'
				? 'failure'
				: log.results.filesNeedingRename === 0
					? 'skipped'
					: 'success';
		return {
			status,
			output,
			rescheduleAt: job.source === 'schedule' ? nextRunAt : undefined
		};
	} catch (error) {
		await logger.error('Rename job failed', {
			source: 'RenameJob',
			meta: { jobId: job.id, instanceId, instanceName: instance.name, error }
		});
		return {
			status: 'failure',
			error: error instanceof Error ? error.message : String(error)
		};
	}
};

jobQueueRegistry.register('arr.rename', renameRunHandler);
