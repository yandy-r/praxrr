import { config } from '$config';
import { logger } from '$logger/logger.ts';
import { startupPullQueries } from '$db/queries/startupPull.ts';
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

    try {
      const instancesFailed = summary.instances.filter((i) => i.status === 'failure').length;
      startupPullQueries.insertRun({
        id: summary.runId,
        status: summary.status,
        startedAt: summary.startedAt,
        finishedAt: summary.finishedAt,
        imported: summary.imported,
        skippedDefault: summary.skippedDefault,
        skippedNoMatch: summary.skippedNoMatch,
        conflicted: summary.conflicted,
        failed: summary.failed,
        instancesTotal: summary.instances.length,
        instancesFailed,
      });

      for (const instance of summary.instances) {
        startupPullQueries.insertInstanceOutcome({
          runId: summary.runId,
          instanceId: instance.instanceId,
          instanceName: instance.instanceName,
          arrType: instance.arrType,
          status: instance.status,
          imported: instance.imported,
          skippedDefault: instance.skippedDefault,
          skippedNoMatch: instance.skippedNoMatch,
          conflicted: instance.conflicted,
          failed: instance.failed,
        });
      }
    } catch (persistError) {
      const persistMessage = persistError instanceof Error ? persistError.message : String(persistError);
      await logger.error('Failed to persist startup pull run results', {
        source: 'ArrPullStartupJob',
        meta: {
          runId: summary.runId,
          error: persistMessage,
          stack: persistError instanceof Error ? persistError.stack : undefined,
        },
      });
    }

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
      meta: { error: message, stack: error instanceof Error ? error.stack : undefined },
    });

    return {
      status: 'failure',
      error: message,
    };
  }
};

jobQueueRegistry.register('arr.pull.startup', arrPullStartupHandler);
