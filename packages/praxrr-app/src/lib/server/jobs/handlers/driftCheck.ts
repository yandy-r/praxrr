import { jobQueueRegistry } from '../queueRegistry.ts';
import type { JobHandler } from '../queueTypes.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { driftSettingsQueries } from '$db/queries/driftSettings.ts';
import { checkAndPersistInstance } from '$sync/drift/persist.ts';
import { isSyncPreviewArrType } from '$sync/preview/types.ts';
import { processBatches } from '$sync/processor.ts';
import { calculateNextRunFromMinutes } from '../scheduleUtils.ts';
import { logger } from '$logger/logger.ts';

/**
 * Drift check sweep handler.
 *
 * The sweep is CHUNKED across job runs so it can never monopolize the single-flag serialized
 * dispatcher: each invocation processes at most `SWEEP_CHUNK_SIZE` instances (id-ordered,
 * `CONCURRENCY`-bounded) then reschedules itself (`rescheduleAt = now`) to continue, yielding
 * the runner to any other due job between chunks. Sweep progress (cursor + start time) lives
 * in `drift_check_settings`, because the dispatcher's reschedule reuses the same job payload.
 * The terminal chunk reschedules to the next interval; a handler-level fault backs off.
 */
const SWEEP_CHUNK_SIZE = 5;
const CONCURRENCY = 3;
const BACKOFF_BASE_MS = 5 * 60 * 1000; // 5 minutes
const BACKOFF_CAP_MS = 6 * 60 * 60 * 1000; // 6 hours

const driftCheckHandler: JobHandler = async (job) => {
  const settings = driftSettingsQueries.get();
  if (settings.enabled !== 1) {
    return { status: 'cancelled', output: 'Drift detection disabled' };
  }

  const isScheduled = job.source === 'schedule';

  try {
    const sweepStartedAt = settings.sweep_started_at ?? new Date().toISOString();
    const cursor = settings.sweep_started_at ? settings.sweep_cursor : 0;

    const eligible = arrInstancesQueries
      .getEnabled()
      .filter((instance) => isSyncPreviewArrType(instance.type))
      .sort((a, b) => a.id - b.id);

    const chunk = eligible.filter((instance) => instance.id > cursor).slice(0, SWEEP_CHUNK_SIZE);

    // checkAndPersistInstance never throws (returns null on skip/error), so the Promise.all
    // batch inside processBatches is safe.
    await processBatches(chunk, (instance) => checkAndPersistInstance(instance), CONCURRENCY);

    const lastProcessedId = chunk.length > 0 ? chunk[chunk.length - 1].id : cursor;
    const moreRemain = eligible.some((instance) => instance.id > lastProcessedId);

    if (moreRemain && isScheduled) {
      driftSettingsQueries.setSweepProgress(lastProcessedId, sweepStartedAt);
      return {
        status: 'success',
        output: `Checked ${chunk.length} instance(s); continuing sweep`,
        rescheduleAt: new Date().toISOString(),
      };
    }

    if (isScheduled) {
      driftSettingsQueries.markRun(sweepStartedAt);
      return {
        status: 'success',
        output: `Drift sweep complete (${eligible.length} instance(s))`,
        rescheduleAt: calculateNextRunFromMinutes(sweepStartedAt, settings.interval_minutes),
      };
    }

    return { status: 'success', output: `Checked ${chunk.length} instance(s)` };
  } catch (error) {
    const errorCount = settings.error_count + 1;
    const backoffMs = Math.min(BACKOFF_BASE_MS * 2 ** (errorCount - 1), BACKOFF_CAP_MS);
    const backoffUntil = new Date(Date.now() + backoffMs).toISOString();
    driftSettingsQueries.markFailure(errorCount, backoffUntil);

    await logger.error('Drift sweep handler failed', {
      source: 'DriftCheckJob',
      meta: { jobId: job.id, error: error instanceof Error ? error.message : String(error) },
    });

    return {
      status: 'failure',
      error: error instanceof Error ? error.message : String(error),
      rescheduleAt: isScheduled ? backoffUntil : undefined,
    };
  }
};

jobQueueRegistry.register('drift.check', driftCheckHandler);
