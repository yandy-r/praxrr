import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { jobRunHistoryQueries } from '$db/queries/jobRunHistory.ts';
import { buildJobDisplayName } from './display.ts';
import { buildSafeJobEvidence, classifyJobFailure } from './evidence.ts';
import { jobQueueRegistry } from './queueRegistry.ts';
import type { JobHandlerResult, JobQueueRecord, JobStatus } from './queueTypes.ts';
import { logger } from '$logger/logger.ts';
import { runOutsideUserOpAction, withNewUserOpAction } from '$pcd/ops/actionContext.ts';
import { publishJobFinished, publishJobRunning } from '$lib/server/events/publish.ts';
import './handlers/index.ts';

/**
 * setTimeout stores its delay as a signed 32-bit int; anything larger (> ~24.8 days, reachable
 * at MAX_SCHEDULE_INTERVAL_MINUTES) overflows and fires after ~1 ms, hot-looping the dispatcher.
 * Waking at the cap is safe: runDueJobs finds nothing due and reschedules the next wake.
 */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

class JobDispatcher {
  private timerId: number | null = null;
  private nextWakeAt: number | null = null;
  private running = false;

  start(): void {
    this.scheduleNextWake();
  }

  stop(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.nextWakeAt = null;
  }

  notifyJobEnqueued(runAt: string): void {
    const runAtMs = new Date(runAt).getTime();
    if (this.nextWakeAt === null || runAtMs < this.nextWakeAt) {
      this.scheduleNextWake();
    }
  }

  private scheduleNextWake(): void {
    const next = jobQueueQueries.getNextQueued();
    if (!next) {
      this.stop();
      return;
    }

    const runAtMs = new Date(next.runAt).getTime();
    const delay = Math.min(Math.max(0, runAtMs - Date.now()), MAX_TIMER_DELAY_MS);
    this.nextWakeAt = runAtMs;

    if (this.timerId !== null) {
      clearTimeout(this.timerId);
    }

    // Timers inherit the async context of whoever armed them (e.g. a POST handler's undo action);
    // exit it so background jobs never write under a stale request action.
    this.timerId = setTimeout(() => {
      runOutsideUserOpAction(() => void this.runDueJobs());
    }, delay) as unknown as number;
  }

  private async runDueJobs(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      while (true) {
        const job = jobQueueQueries.claimNextDue();
        if (!job) break;
        publishJobRunning(job);
        await this.executeJob(job);
      }
    } finally {
      this.running = false;
      this.scheduleNextWake();
    }
  }

  private async executeJob(job: JobQueueRecord): Promise<void> {
    const displayName = buildJobDisplayName(job.jobType, job.payload);

    const handler = jobQueueRegistry.get(job.jobType);
    if (!handler) {
      await logger.error(`Job handler not found for ${job.jobType}`, {
        source: 'JobDispatcher',
        meta: { jobId: job.id, jobType: job.jobType, displayName },
      });
      jobQueueQueries.markFinished(job.id, 'failed');
      const finishedAt = new Date().toISOString();
      const runId = jobRunHistoryQueries.create(
        job.id,
        job.jobType,
        'failure',
        job.startedAt ?? finishedAt,
        finishedAt,
        0,
        buildSafeJobEvidence(job, { status: 'failure', failureCode: 'handlerNotFound' })
      );
      publishJobFinished(job, {
        status: 'failed',
        runStatus: 'failure',
        rescheduled: false,
        nextRunAt: null,
        runId,
        failureCode: 'handlerNotFound',
        durationMs: 0,
        finishedAt,
      });
      return;
    }

    const startedAt = job.startedAt ?? new Date().toISOString();
    const startMs = Date.now();

    await logger.debug(`Job started: ${job.jobType}`, {
      source: 'JobDispatcher',
      meta: {
        jobId: job.id,
        jobType: job.jobType,
        displayName,
        sourceType: job.source,
        runAt: job.runAt,
      },
    });

    let result: JobHandlerResult;
    try {
      // One job run is one undo unit for any user-layer ops it writes.
      result = await withNewUserOpAction(async () => await handler(job));
    } catch (error) {
      // Redaction by construction: the raw exception is logged through the sanitized
      // boundary; only a typed, safe failure code reaches the durable evidence.
      await logger.error(`Job threw an unhandled error: ${job.jobType}`, {
        source: 'JobDispatcher',
        meta: { jobId: job.id, jobType: job.jobType, displayName, error },
      });
      result = { status: 'failure', failureCode: classifyJobFailure(error) };
    }

    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - startMs;
    const evidence = buildSafeJobEvidence(job, result);

    const runId = jobRunHistoryQueries.create(
      job.id,
      job.jobType,
      result.status,
      startedAt,
      finishedAt,
      durationMs,
      evidence
    );
    const failureCode = evidence.failure?.code ?? null;

    await logger.debug(`Job finished: ${job.jobType} (${result.status})`, {
      source: 'JobDispatcher',
      meta: {
        jobId: job.id,
        jobType: job.jobType,
        displayName,
        status: result.status,
        durationMs,
        rescheduleAt: result.rescheduleAt ?? null,
        failureCode,
      },
    });

    if (result.rescheduleAt) {
      jobQueueQueries.reschedule(job.id, result.rescheduleAt, job.cooldownUntil);
      publishJobFinished(job, {
        status: 'queued',
        runStatus: result.status,
        rescheduled: true,
        nextRunAt: result.rescheduleAt,
        runId,
        failureCode,
        durationMs,
        finishedAt,
      });
      return;
    }

    const status: JobStatus =
      result.status === 'success'
        ? 'success'
        : result.status === 'skipped'
          ? 'success'
          : result.status === 'cancelled'
            ? 'cancelled'
            : 'failed';

    jobQueueQueries.markFinished(job.id, status);
    publishJobFinished(job, {
      status,
      runStatus: result.status,
      rescheduled: false,
      nextRunAt: null,
      runId,
      failureCode,
      durationMs,
      finishedAt,
    });
  }
}

export const jobDispatcher = new JobDispatcher();
