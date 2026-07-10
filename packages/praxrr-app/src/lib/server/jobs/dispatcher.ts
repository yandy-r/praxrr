import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { jobRunHistoryQueries } from '$db/queries/jobRunHistory.ts';
import { buildJobDisplayName } from './display.ts';
import { buildSafeJobEvidence, classifyJobFailure } from './evidence.ts';
import { jobQueueRegistry } from './queueRegistry.ts';
import type { JobHandlerResult, JobQueueRecord, JobStatus } from './queueTypes.ts';
import { logger } from '$logger/logger.ts';
import './handlers/index.ts';

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
    const delay = Math.max(0, runAtMs - Date.now());
    this.nextWakeAt = runAtMs;

    if (this.timerId !== null) {
      clearTimeout(this.timerId);
    }

    this.timerId = setTimeout(() => {
      void this.runDueJobs();
    }, delay) as unknown as number;
  }

  private async runDueJobs(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      while (true) {
        const job = jobQueueQueries.claimNextDue();
        if (!job) break;
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
      jobRunHistoryQueries.create(
        job.id,
        job.jobType,
        'failure',
        job.startedAt ?? new Date().toISOString(),
        new Date().toISOString(),
        0,
        buildSafeJobEvidence(job, { status: 'failure', failureCode: 'handlerNotFound' })
      );
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
      result = await handler(job);
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

    jobRunHistoryQueries.create(job.id, job.jobType, result.status, startedAt, finishedAt, durationMs, evidence);

    await logger.debug(`Job finished: ${job.jobType} (${result.status})`, {
      source: 'JobDispatcher',
      meta: {
        jobId: job.id,
        jobType: job.jobType,
        displayName,
        status: result.status,
        durationMs,
        rescheduleAt: result.rescheduleAt ?? null,
        failureCode: evidence.failure?.code ?? null,
      },
    });

    if (result.rescheduleAt) {
      jobQueueQueries.reschedule(job.id, result.rescheduleAt, job.cooldownUntil);
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
  }
}

export const jobDispatcher = new JobDispatcher();
