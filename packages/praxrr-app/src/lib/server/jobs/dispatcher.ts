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
const DISPATCHER_RETRY_DELAY_MS = 60_000;

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
    try {
      const next = jobQueueQueries.getNextQueued();
      if (!next) {
        this.stop();
        return;
      }
      this.armWakeAt(new Date(next.runAt).getTime());
    } catch (error) {
      void this.logError('Failed to schedule the next job wake', { error });
      // A transient queue read failure must not leave the dispatcher permanently idle.
      this.armWakeAt(Date.now() + DISPATCHER_RETRY_DELAY_MS);
    }
  }

  private armWakeAt(runAtMs: number): void {
    const delay = Math.min(Math.max(0, runAtMs - Date.now()), MAX_TIMER_DELAY_MS);
    this.nextWakeAt = runAtMs;

    if (this.timerId !== null) {
      clearTimeout(this.timerId);
    }

    // Timers inherit the async context of whoever armed them (e.g. a POST handler's undo action);
    // exit it so background jobs never write under a stale request action.
    this.timerId = setTimeout(() => {
      runOutsideUserOpAction(() => {
        void this.runDueJobs().catch((error) => this.logError('Job dispatcher drain failed unexpectedly', { error }));
      });
    }, delay) as unknown as number;
  }

  private async logError(message: string, meta: Record<string, unknown>): Promise<void> {
    try {
      await logger.error(message, { source: 'JobDispatcher', meta });
    } catch {
      // Logging is best-effort here: recovery must work even when the logger fails.
    }
  }

  private async runDueJobs(): Promise<void> {
    if (this.running) return;
    this.running = true;
    let claimFailed = false;

    try {
      while (true) {
        let job: JobQueueRecord | undefined;
        try {
          job = jobQueueQueries.claimNextDue();
        } catch (error) {
          await this.logError('Failed to claim the next due job', { error });
          claimFailed = true;
          break;
        }
        if (!job) break;
        try {
          publishJobRunning(job);
          await this.executeJob(job);
        } catch (error) {
          await this.logError('Job execution failed unexpectedly', {
            jobId: job.id,
            jobType: job.jobType,
            error,
          });
          try {
            jobQueueQueries.markFinished(job.id, 'failed');
          } catch (error) {
            await this.logError('Failed to mark the job as failed', {
              jobId: job.id,
              jobType: job.jobType,
              error,
            });
          }
        }
      }
    } finally {
      this.running = false;
      if (claimFailed) {
        this.armWakeAt(Date.now() + DISPATCHER_RETRY_DELAY_MS);
      } else {
        this.scheduleNextWake();
      }
    }
  }

  private async markFinishedBestEffort(job: JobQueueRecord, status: JobStatus): Promise<boolean> {
    try {
      jobQueueQueries.markFinished(job.id, status);
      return true;
    } catch (error) {
      await this.logError('Failed to mark the job as finished', {
        jobId: job.id,
        jobType: job.jobType,
        error,
      });
      return false;
    }
  }

  private async executeJob(job: JobQueueRecord): Promise<void> {
    const displayName = buildJobDisplayName(job.jobType, job.payload);

    const handler = jobQueueRegistry.get(job.jobType);
    if (!handler) {
      await this.logError(`Job handler not found for ${job.jobType}`, {
        jobId: job.id,
        jobType: job.jobType,
        displayName,
      });
      await this.markFinishedBestEffort(job, 'failed');
      const finishedAt = new Date().toISOString();
      const runId = jobRunHistoryQueries.create(
        job.id,
        job.jobType,
        'failure',
        job.startedAt ?? finishedAt,
        finishedAt,
        0,
        buildSafeJobEvidence(job, {
          status: 'failure',
          failureCode: 'handlerNotFound',
        })
      );
      publishJobFinished(job, {
        status: 'failed',
        runStatus: 'failure',
        rescheduled: false,
        handedBack: false,
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

    try {
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
    } catch (error) {
      await this.logError('Failed to log a job start', {
        jobId: job.id,
        jobType: job.jobType,
        error,
      });
    }

    let result: JobHandlerResult;
    try {
      // One job run is one undo unit for any user-layer ops it writes.
      result = await withNewUserOpAction(async () => await handler(job));
    } catch (error) {
      // Redaction by construction: the raw exception is logged through the sanitized
      // boundary; only a typed, safe failure code reaches the durable evidence.
      await this.logError(`Job threw an unhandled error: ${job.jobType}`, {
        jobId: job.id,
        jobType: job.jobType,
        displayName,
        error,
      });
      result = { status: 'failure', failureCode: classifyJobFailure(error) };
    }

    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - startMs;
    const evidence = buildSafeJobEvidence(job, result);
    const failureCode = evidence.failure?.code ?? null;
    // A hand-back re-targets the slot at a different source than the one that ran; the run itself
    // is over for its own trigger only after the reschedule succeeds (unlike a canary/chunked
    // continuation, which keeps its source).
    const handedBack = result.rescheduleSource !== undefined && result.rescheduleSource !== job.source;
    // Only rescheduling itself needs the post-handler evidence. All other bookkeeping after the
    // handler returned is independent, best-effort: a failed history insert or log line must never
    // throw away the handler's rescheduleAt or end a recurring schedule (the outer catch otherwise
    // marks the row failed).
    let rescheduled = false;
    let nextRunAt: string | null = null;
    let status: JobStatus = 'failed';

    let runId = 0;
    try {
      runId = jobRunHistoryQueries.create(
        job.id,
        job.jobType,
        result.status,
        startedAt,
        finishedAt,
        durationMs,
        evidence
      );
    } catch (error) {
      // 0 is the "no history row" sentinel also used by publishJobsCancelled (ids start at 1).
      await this.logError('Failed to record the job run history', {
        jobId: job.id,
        jobType: job.jobType,
        error,
      });
    }

    try {
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
    } catch (error) {
      await this.logError('Failed to log a job finish', {
        jobId: job.id,
        jobType: job.jobType,
        error,
      });
    }

    if (result.rescheduleAt) {
      // The next slot must survive a failed history insert; only a failed reschedule itself ends
      // the run, and even then the outer runDueJobs catch is the backstop if marking failed fails.
      try {
        jobQueueQueries.reschedule(job.id, result.rescheduleAt, job.cooldownUntil, {
          payload: result.reschedulePayload,
          source: result.rescheduleSource,
        });
        rescheduled = true;
        nextRunAt = result.rescheduleAt;
        status = 'queued';
      } catch (error) {
        await this.logError('Failed to reschedule the job; marking the run as failed', {
          jobId: job.id,
          jobType: job.jobType,
          error,
        });
        await this.markFinishedBestEffort(job, 'failed');
      }
    } else {
      status =
        result.status === 'success'
          ? 'success'
          : result.status === 'skipped'
            ? 'success'
            : result.status === 'cancelled'
              ? 'cancelled'
              : 'failed';
      if (!(await this.markFinishedBestEffort(job, status))) status = 'failed';
    }

    // publishJobFinished is best-effort by construction; the terminal/rescheduled event always goes
    // out, even after a failed history write.
    publishJobFinished(job, {
      status,
      runStatus: result.status,
      rescheduled,
      handedBack: rescheduled && handedBack,
      nextRunAt,
      runId,
      failureCode,
      durationMs,
      finishedAt,
    });
  }
}

export const jobDispatcher = new JobDispatcher();
