/**
 * Allow-list builders for live events. Every event is constructed field by field from its source
 * record so secrets, raw error text and payload blobs can never leak into the stream. Every
 * `publish*` is fire-and-forget: failures are logged and never thrown into the caller.
 *
 * Must not import dispatcher/queueService/record/coordinator/persist — they import this module.
 */
import { logger } from '$logger/logger.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { canaryRolloutQueries } from '$db/queries/canaryRollouts.ts';
import type { UpsertDriftStatusInput } from '$db/queries/driftStatus.ts';
import { buildJobDisplayName } from '$jobs/display.ts';
import type { JobQueueRecord, JobRunStatus, JobStatus } from '$jobs/queueTypes.ts';
import type { JobFailureCode } from '$shared/jobs/evidence.ts';
import type { LiveJobEventBase } from '$shared/events/types.ts';
import { parseUTC, toUTC } from '$shared/utils/dates.ts';
import { isSyncPreviewArrType } from '$sync/preview/types.ts';
import type { SyncHistoryInput } from '$sync/syncHistory/types.ts';
import { eventBus } from './bus.ts';

export interface JobFinishedOutcome {
  status: JobStatus;
  runStatus: JobRunStatus;
  rescheduled: boolean;
  handedBack: boolean;
  nextRunAt: string | null;
  runId: number;
  failureCode: JobFailureCode | null;
  durationMs: number;
  finishedAt: string;
}

/** Mirrors `readId` in `$jobs/display.ts`. */
function readNumericId(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
    return Number(raw);
  }
  return null;
}

function logPublishFailure(type: string, error: unknown): void {
  void logger.error('Live event build failed', {
    source: 'LiveEvents',
    meta: { type, errorName: error instanceof Error ? error.name : typeof error },
  });
}

/**
 * Normalizes SQLite `CURRENT_TIMESTAMP` text (`YYYY-MM-DD HH:MM:SS`, UTC without a zone) to
 * RFC 3339 UTC so clients never parse it as local time. ISO input passes through unchanged.
 */
function rfc3339(timestamp: string): string {
  return toUTC(timestamp) ?? timestamp;
}

/** Shared job fields. `arrType` comes from the instance row only, never from `jobType`. */
function jobBase(job: JobQueueRecord): LiveJobEventBase {
  const instanceId = readNumericId(job.payload.instanceId);
  const instanceType = instanceId !== null ? arrInstancesQueries.getById(instanceId)?.type : undefined;
  return {
    jobId: job.id,
    jobType: job.jobType,
    source: job.source,
    displayName: buildJobDisplayName(job.jobType, job.payload),
    instanceId,
    arrType: instanceType && isSyncPreviewArrType(instanceType) ? instanceType : null,
    databaseId: readNumericId(job.payload.databaseId),
  };
}

/** Test seam for the allow-list assertions. */
export const _jobBase = jobBase;

export function publishJobQueued(job: JobQueueRecord, { onlyIfDue }: { onlyIfDue: boolean }): void {
  try {
    // Matches `listActive`: a future-dated row of any source is not active yet, so it is not announced.
    if (onlyIfDue && (parseUTC(job.runAt)?.getTime() ?? 0) > Date.now()) return;
    if (job.status !== 'queued') return;
    const base = jobBase(job);
    eventBus.publish({
      type: 'job.queued',
      jobId: base.jobId,
      jobType: base.jobType,
      source: base.source,
      displayName: base.displayName,
      instanceId: base.instanceId,
      arrType: base.arrType,
      databaseId: base.databaseId,
      runAt: rfc3339(job.runAt),
    });
  } catch (error) {
    logPublishFailure('job.queued', error);
  }
}

export function publishJobRunning(job: JobQueueRecord): void {
  try {
    const base = jobBase(job);
    eventBus.publish({
      type: 'job.running',
      jobId: base.jobId,
      jobType: base.jobType,
      source: base.source,
      displayName: base.displayName,
      instanceId: base.instanceId,
      arrType: base.arrType,
      databaseId: base.databaseId,
      startedAt: job.startedAt ? rfc3339(job.startedAt) : new Date().toISOString(),
    });
  } catch (error) {
    logPublishFailure('job.running', error);
  }
}

export function publishJobFinished(job: JobQueueRecord, outcome: JobFinishedOutcome): void {
  try {
    const base = jobBase(job);
    eventBus.publish({
      type: 'job.finished',
      jobId: base.jobId,
      jobType: base.jobType,
      source: base.source,
      displayName: base.displayName,
      instanceId: base.instanceId,
      arrType: base.arrType,
      databaseId: base.databaseId,
      status: outcome.status,
      runStatus: outcome.runStatus,
      rescheduled: outcome.rescheduled,
      handedBack: outcome.handedBack,
      nextRunAt: toUTC(outcome.nextRunAt),
      runId: outcome.runId,
      failureCode: outcome.failureCode,
      durationMs: outcome.durationMs,
      finishedAt: rfc3339(outcome.finishedAt),
    });
  } catch (error) {
    logPublishFailure('job.finished', error);
  }
}

/**
 * Cancellation outside the dispatcher (dedupe-key cancel, unschedule, instance/database cleanup):
 * publishes `job.finished` with status/runStatus `cancelled` so other tabs drop the stale active job.
 * No run history row exists, so `runId` is `0` (history ids start at 1) and `durationMs` is `0`.
 * Callers pass the rows they read before the DB write; each row is built and published independently.
 */
export function publishJobsCancelled(jobs: readonly JobQueueRecord[]): void {
  const finishedAt = new Date().toISOString();
  for (const job of jobs) {
    publishJobFinished(
      { ...job, status: 'cancelled' },
      {
        status: 'cancelled',
        runStatus: 'cancelled',
        rescheduled: false,
        handedBack: false,
        nextRunAt: null,
        runId: 0,
        failureCode: null,
        durationMs: 0,
        finishedAt,
      }
    );
  }
}

export function publishSyncRecorded(syncHistoryId: number, input: SyncHistoryInput): void {
  try {
    eventBus.publish({
      type: 'sync.recorded',
      syncHistoryId,
      jobId: input.jobId,
      instanceId: input.arrInstanceId,
      arrType: input.arrType,
      status: input.status,
      trigger: input.trigger,
      finishedAt: input.finishedAt ? rfc3339(input.finishedAt) : new Date().toISOString(),
    });
  } catch (error) {
    logPublishFailure('sync.recorded', error);
  }
}

/** Never reads or emits `stateToken`, `canaryError` or `canaryOutput`. */
export function publishCanaryUpdated(rolloutId: number): void {
  try {
    const rollout = canaryRolloutQueries.getById(rolloutId);
    if (!rollout) return;
    eventBus.publish({
      type: 'canary.updated',
      rolloutId: rollout.id,
      arrType: rollout.arrType,
      status: rollout.status,
      canaryStatus: rollout.canaryStatus,
      completedCount: rollout.rolloutResults.length,
      remainingCount: Math.max(0, rollout.remainingTargets.length - rollout.rolloutResults.length),
    });
  } catch (error) {
    logPublishFailure('canary.updated', error);
  }
}

/** Never emits `reason` text or `changes`. */
export function publishDriftUpdated(input: UpsertDriftStatusInput): void {
  try {
    if (!isSyncPreviewArrType(input.arrType)) return;
    eventBus.publish({
      type: 'drift.updated',
      instanceId: input.arrInstanceId,
      arrType: input.arrType,
      status: input.status,
      driftedCount: input.driftedCount,
      missingCount: input.missingCount,
      unmanagedCount: input.unmanagedCount,
      pruneCount: input.changes.filter((change) => change.category === 'prune').length,
      checkedAt: rfc3339(input.checkedAt),
    });
  } catch (error) {
    logPublishFailure('drift.updated', error);
  }
}
