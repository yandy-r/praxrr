import { jobQueueRegistry } from '../queueRegistry.ts';
import type { JobHandler } from '../queueTypes.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { configHealthSettingsQueries } from '$db/queries/configHealthSettings.ts';
import { recomputeAndPersistInstance } from '$lib/server/health/recompute.ts';
import { isSyncPreviewArrType } from '$sync/preview/types.ts';
import { processBatches } from '$sync/processor.ts';
import { calculateNextRunFromMinutes } from '../scheduleUtils.ts';
import { logger } from '$logger/logger.ts';

/**
 * Config health snapshot sweep handler.
 *
 * Mirrors the drift sweep: CHUNKED across job runs (at most `SWEEP_CHUNK_SIZE` instances,
 * `CONCURRENCY`-bounded, id-ordered) so it never monopolizes the serialized dispatcher, with sweep
 * progress persisted in `config_health_settings`. Each eligible instance is scored live and its
 * report appended to `config_health_snapshots` for the trend series. The terminal chunk reschedules
 * to the next interval; a handler-level fault backs off exponentially.
 */
const SWEEP_CHUNK_SIZE = 5;
const CONCURRENCY = 3;
const BACKOFF_BASE_MS = 5 * 60 * 1000; // 5 minutes
const BACKOFF_CAP_MS = 6 * 60 * 60 * 1000; // 6 hours

const configHealthSnapshotHandler: JobHandler = async (job) => {
  const settings = configHealthSettingsQueries.get();
  if (settings.enabled !== 1) {
    return { status: 'cancelled', output: 'Config health scoring disabled' };
  }

  const isScheduled = job.source === 'schedule';

  try {
    const sweepStartedAt = settings.sweep_started_at ?? new Date().toISOString();
    const cursor = settings.sweep_started_at ? settings.sweep_cursor : 0;

    const eligible = arrInstancesQueries
      .getEnabled()
      .filter((instance) => isSyncPreviewArrType(instance.type))
      .sort((a, b) => a.id - b.id);

    if (eligible.length === 0) {
      if (isScheduled) {
        configHealthSettingsQueries.markRun(sweepStartedAt);
      }
      return {
        status: 'skipped',
        output: 'No sync-capable instances to snapshot',
        rescheduleAt: isScheduled ? calculateNextRunFromMinutes(sweepStartedAt, settings.interval_minutes) : undefined,
      };
    }

    const chunk = eligible.filter((instance) => instance.id > cursor).slice(0, SWEEP_CHUNK_SIZE);
    // Both the sweep and the on-demand recompute route funnel through the one score+persist path so
    // they can never diverge. `recomputeAndPersistInstance` never throws (safe under the Promise.all
    // batch) and self-logs insert failures. An `in_flight` outcome (a concurrent manual recompute for
    // the same instance) is intentionally ignored: the concurrent manual call is persisting that
    // instance's trend point, so the sweep need not. If that manual insert happens to fail, the
    // instance is simply re-scored on the next sweep — the same self-healing the sweep already relies
    // on for its own transient insert failures.
    await processBatches(chunk, (instance) => recomputeAndPersistInstance(instance), CONCURRENCY);

    const lastProcessedId = chunk.length > 0 ? chunk[chunk.length - 1].id : cursor;
    const moreRemain = eligible.some((instance) => instance.id > lastProcessedId);

    if (moreRemain && isScheduled) {
      configHealthSettingsQueries.setSweepProgress(lastProcessedId, sweepStartedAt);
      return {
        status: 'success',
        output: `Snapshotted ${chunk.length} instance(s); continuing sweep`,
        rescheduleAt: new Date().toISOString(),
      };
    }

    if (isScheduled) {
      configHealthSettingsQueries.markRun(sweepStartedAt);
      return {
        status: 'success',
        output: `Config health sweep complete (${eligible.length} instance(s))`,
        rescheduleAt: calculateNextRunFromMinutes(sweepStartedAt, settings.interval_minutes),
      };
    }

    return { status: 'success', output: `Snapshotted ${chunk.length} instance(s)` };
  } catch (error) {
    const errorCount = settings.error_count + 1;
    const backoffMs = Math.min(BACKOFF_BASE_MS * 2 ** (errorCount - 1), BACKOFF_CAP_MS);
    const backoffUntil = new Date(Date.now() + backoffMs).toISOString();
    configHealthSettingsQueries.markFailure(errorCount, backoffUntil);

    await logger.error('Config health snapshot sweep failed', {
      source: 'ConfigHealthSnapshotJob',
      meta: { jobId: job.id, error: error instanceof Error ? error.message : String(error) },
    });

    return {
      status: 'failure',
      error: error instanceof Error ? error.message : String(error),
      rescheduleAt: isScheduled ? backoffUntil : undefined,
    };
  }
};

jobQueueRegistry.register('config-health.snapshot', configHealthSnapshotHandler);
