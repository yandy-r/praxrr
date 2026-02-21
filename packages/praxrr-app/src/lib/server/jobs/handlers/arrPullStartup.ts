import { config } from '$config';
import { logger } from '$logger/logger.ts';
import { jobQueueRegistry } from '../queueRegistry.ts';
import type { JobHandler } from '../queueTypes.ts';
import { runStartupPull, toArrPullStartupRunResult, toJobRunStatus } from '$lib/server/pull/startup/index.ts';

const arrPullStartupHandler: JobHandler = async (_job) => {
	if (!config.pullOnStart) {
		return { status: 'skipped', output: 'Startup pull disabled via PULL_ON_START' };
	}

	try {
		const summary = await runStartupPull({
			maxConcurrency: config.pullOnStartMaxConcurrency ?? undefined,
			timeoutMs: config.pullOnStartTimeoutMs ?? undefined,
		});

		const runResult = toArrPullStartupRunResult(summary);
		const jobStatus = toJobRunStatus(summary.status);

		await logger.info('Startup pull job completed', {
			source: 'ArrPullStartupJob',
			meta: {
				runId: summary.runId,
				status: summary.status,
				jobStatus,
				imported: summary.imported,
				failed: summary.failed,
				instanceCount: summary.instances.length,
			},
		});

		return {
			status: jobStatus,
			output: JSON.stringify(runResult),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await logger.error('Startup pull job failed unexpectedly', {
			source: 'ArrPullStartupJob',
			meta: { error: message },
		});

		return {
			status: 'failure',
			error: message,
		};
	}
};

jobQueueRegistry.register('arr.pull.startup', arrPullStartupHandler);
