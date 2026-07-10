import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { configHealthNotificationStateQueries } from '$db/queries/configHealthNotificationState.ts';
import { configHealthSettingsQueries } from '$db/queries/configHealthSettings.ts';
import { configHealthSnapshotsQueries } from '$db/queries/configHealthSnapshots.ts';
import {
  assessHealthDegradation,
  buildHealthDegradedNotification,
  type HealthDegradedEvent,
} from '$lib/server/health/degradation.ts';
import { scoreInstance as scoreInstanceDefault } from '$lib/server/health/service.ts';
import { logger } from '$logger/logger.ts';
import { notify } from '$notifications/builder.ts';
import { NotificationTypes } from '$notifications/types.ts';
import type { HealthReport } from '$shared/health/types.ts';
import { isSyncPreviewArrType } from '$sync/preview/types.ts';
import { processBatches } from '$sync/processor.ts';
import { jobQueueRegistry } from '../queueRegistry.ts';
import type { JobHandler } from '../queueTypes.ts';
import { calculateNextRunFromMinutes } from '../scheduleUtils.ts';

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

export interface ConfigHealthSnapshotInstanceDeps {
  readonly scoreInstance: (instanceId: number) => Promise<HealthReport | null>;
  readonly sendHealthDegraded: (event: HealthDegradedEvent) => Promise<void>;
}

async function sendHealthDegradedDefault(event: HealthDegradedEvent): Promise<void> {
  const projection = buildHealthDegradedNotification(event);
  await notify(NotificationTypes.HEALTH_DEGRADED)
    .generic(projection.title, projection.message)
    .discord((discord) => discord.embed(projection.embed))
    .send();
}

async function logSnapshotError(message: string, instanceId: number, error: unknown): Promise<void> {
  try {
    await logger.error(message, {
      source: 'ConfigHealthSnapshotJob',
      meta: {
        instanceId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  } catch {
    // Snapshot persistence and batch progress must not depend on secondary logging.
  }
}

/**
 * Score + persist one instance, then evaluate its adjacent persisted edge for notification.
 *
 * The successful insert is the primary-operation boundary. Everything after it is separately
 * guarded so assessment, state, rendering, manager, provider, history, and logging failures cannot
 * escape into sibling instances or sweep progress.
 */
export async function snapshotInstance(
  instanceId: number,
  deps: Partial<ConfigHealthSnapshotInstanceDeps> = {}
): Promise<void> {
  const scoreInstance = deps.scoreInstance ?? scoreInstanceDefault;
  const sendHealthDegraded = deps.sendHealthDegraded ?? sendHealthDegradedDefault;
  let currentSnapshotId: number;
  let report: HealthReport;

  try {
    const scored = await scoreInstance(instanceId);
    if (!scored) return;
    report = scored;
    currentSnapshotId = configHealthSnapshotsQueries.insert(report);
  } catch (error) {
    await logSnapshotError('Config health snapshot failed for instance', instanceId, error);
    return;
  }

  try {
    const previous = configHealthSnapshotsQueries.getPrevious(instanceId, currentSnapshotId);
    const current = {
      id: currentSnapshotId,
      arrInstanceId: report.instanceId,
      instanceName: report.instanceName,
      arrType: report.arrType,
      engineVersion: report.engineVersion,
      overallScore: report.overall.score,
      band: report.overall.band,
      criteriaScores: report.overall.criteria,
      generatedAt: report.generatedAt,
    };
    const assessment = await assessHealthDegradation(previous, current);

    if (assessment.kind === 'recovery') {
      configHealthNotificationStateQueries.clear(instanceId);
      return;
    }
    if (assessment.kind !== 'degradation') return;

    const { event } = assessment;
    if (!configHealthNotificationStateQueries.claim(instanceId, event.signature, event.generatedAt)) return;
    await sendHealthDegraded(event);
  } catch (error) {
    await logSnapshotError('Config health snapshot notification failed for instance', instanceId, error);
  }
}

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
    await processBatches(chunk, (instance) => snapshotInstance(instance.id), CONCURRENCY);

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

    return {
      status: 'success',
      output: `Snapshotted ${chunk.length} instance(s)`,
    };
  } catch (error) {
    const errorCount = settings.error_count + 1;
    const backoffMs = Math.min(BACKOFF_BASE_MS * 2 ** (errorCount - 1), BACKOFF_CAP_MS);
    const backoffUntil = new Date(Date.now() + backoffMs).toISOString();
    configHealthSettingsQueries.markFailure(errorCount, backoffUntil);

    await logger.error('Config health snapshot sweep failed', {
      source: 'ConfigHealthSnapshotJob',
      meta: {
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      },
    });

    return {
      status: 'failure',
      error: error instanceof Error ? error.message : String(error),
      rescheduleAt: isScheduled ? backoffUntil : undefined,
    };
  }
};

jobQueueRegistry.register('config-health.snapshot', configHealthSnapshotHandler);
