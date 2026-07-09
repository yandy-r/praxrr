import { jobQueueRegistry } from '../queueRegistry.ts';
import type { JobHandler } from '../queueTypes.ts';
import { executeSyncJob } from './arrSync.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { canaryRolloutQueries } from '$db/queries/canaryRollouts.ts';
import { processBatches } from '$sync/processor.ts';
import { notifyCanaryFailed, notifyCanaryPromoted } from '$sync/canary/notify.ts';
import type { CanaryInstanceResult, CanaryTarget } from '$sync/canary/types.ts';
import type { SectionType } from '$sync/types.ts';
import { logger } from '$logger/logger.ts';

/**
 * Canary rollout handler (issue #19).
 *
 * Drives the `rolling_out` phase of a rollout scoped to exactly one `arr_type`
 * (no sibling fallback): it slices the next batch off `remaining_targets` at
 * `batch_cursor`, syncs each via the existing per-instance `executeSyncJob`
 * primitive, and advances the cursor. While targets remain the handler
 * reschedules itself UNCONDITIONALLY (regardless of `job.source`) so the batched
 * rollout resumes across dispatcher runs; on the terminal batch it classifies the
 * rollout, fires the promote/fail notification, and returns the run outcome.
 */

/**
 * Sync one remaining instance. Non-throwing by contract: `processBatches` runs the
 * processor inside `Promise.all`, so a throw would reject the whole batch and lose
 * sibling results. A target disabled/deleted between the gate and rollout records a
 * `skipped` result at the EXACT `instanceId` (no sibling fallback).
 */
async function syncRemainingInstance(
  target: CanaryTarget,
  sections: readonly SectionType[]
): Promise<CanaryInstanceResult> {
  const instance = arrInstancesQueries.getById(target.instanceId);
  if (!instance || instance.enabled !== 1) {
    return {
      instanceId: target.instanceId,
      instanceName: target.instanceName,
      status: 'skipped',
      output: 'Instance no longer enabled; skipped.',
    };
  }

  try {
    const result = await executeSyncJob(target.instanceId, sections, 'manual');
    return {
      instanceId: target.instanceId,
      instanceName: target.instanceName,
      status: result.status,
      output: result.output,
      error: result.error,
    };
  } catch (error) {
    return {
      instanceId: target.instanceId,
      instanceName: target.instanceName,
      status: 'failure',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const canaryRolloutHandler: JobHandler = async (job) => {
  const rolloutId = Number(job.payload.rolloutId);
  const rollout = canaryRolloutQueries.getById(rolloutId);
  if (!rollout) {
    return { status: 'cancelled', output: `Canary rollout ${rolloutId} not found` };
  }
  if (rollout.status !== 'rolling_out') {
    return { status: 'cancelled', output: `Canary rollout ${rolloutId} is ${rollout.status}, not rolling out` };
  }

  const sections: readonly SectionType[] = rollout.sections ?? [];
  const { remainingTargets, batchCursor, maxBatchSize } = rollout;
  const slice = remainingTargets.slice(batchCursor, batchCursor + maxBatchSize);

  const batchResults = await processBatches(slice, (target) => syncRemainingInstance(target, sections), maxBatchSize);

  const accumulatedResults: CanaryInstanceResult[] = [...rollout.rolloutResults, ...batchResults];
  const nextCursor = batchCursor + slice.length;
  canaryRolloutQueries.recordBatchProgress(rolloutId, nextCursor, accumulatedResults);

  // Resumable: reschedule UNCONDITIONALLY while targets remain (no schedule-source guard),
  // yielding the serialized dispatcher between batches. The dispatcher honors `rescheduleAt`
  // for any `job.source`.
  if (nextCursor < remainingTargets.length) {
    return {
      status: 'success',
      output: `Synced ${accumulatedResults.length}/${remainingTargets.length} remaining instance(s); continuing rollout`,
      rescheduleAt: new Date().toISOString(),
    };
  }

  const allOk = accumulatedResults.every((result) => result.status === 'success');
  const finishedAt = new Date().toISOString();
  canaryRolloutQueries.finishRollout(rolloutId, allOk ? 'completed' : 'failed', finishedAt);

  const finished = canaryRolloutQueries.getById(rolloutId) ?? rollout;
  if (allOk) {
    notifyCanaryPromoted(finished);
  } else {
    notifyCanaryFailed(finished);
  }

  await logger.info('Canary rollout finished', {
    source: 'CanaryRolloutJob',
    meta: { rolloutId, status: allOk ? 'completed' : 'failed', synced: accumulatedResults.length },
  });

  return allOk
    ? { status: 'success', output: `Canary rollout completed: ${accumulatedResults.length} instance(s) synced` }
    : { status: 'failure', error: `Canary rollout failed: not all ${remainingTargets.length} remaining instance(s) synced` };
};

jobQueueRegistry.register('sync.canary.rollout', canaryRolloutHandler);
