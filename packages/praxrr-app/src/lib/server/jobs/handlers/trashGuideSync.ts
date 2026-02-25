import { trashGuideSourcesQueries } from '$db/queries/trashGuideSources.ts';
import { logger } from '$logger/logger.ts';
import { trashGuideManager, type TrashGuideSyncResult } from '$trashguide/index.ts';
import { calculateNextRunFromMinutes } from '../scheduleUtils.ts';
import { jobQueueRegistry } from '../queueRegistry.ts';
import type { JobHandler, JobHandlerResult, TrashGuideSyncJobPayload } from '../queueTypes.ts';

const MAX_TRANSIENT_RETRY_ATTEMPTS = 3;

function parsePayload(
  payload: Record<string, unknown>,
  source: 'manual' | 'schedule' | 'system'
): TrashGuideSyncJobPayload | null {
  const sourceId = Number(payload.sourceId);
  if (!Number.isFinite(sourceId)) {
    return null;
  }

  const rawTrigger = payload.trigger;
  let trigger: TrashGuideSyncJobPayload['trigger'];

  if (rawTrigger === 'manual' || rawTrigger === 'scheduled') {
    trigger = rawTrigger;
  } else if (rawTrigger === undefined) {
    trigger = source === 'schedule' ? 'scheduled' : 'manual';
  } else {
    return null;
  }

  const requestedAtRaw = payload.requestedAt;
  if (requestedAtRaw !== undefined && typeof requestedAtRaw !== 'string') {
    return null;
  }

  return {
    sourceId,
    trigger,
    requestedAt: requestedAtRaw,
  };
}

function hasValidSchedule(enabled: number, scheduleMinutes: number): boolean {
  return enabled === 1 && Number.isFinite(scheduleMinutes) && scheduleMinutes > 0;
}

function isTransientGitOrNetworkError(message: string): boolean {
  const value = message.toLowerCase();

  if (value.includes('git network failure')) return true;
  if (value.includes('git pull failed')) return true;
  if (value.includes('could not resolve host')) return true;
  if (value.includes('failed to connect')) return true;
  if (value.includes('network is unreachable')) return true;
  if (value.includes('timed out')) return true;
  if (value.includes('tls')) return true;
  if (value.includes('eai_again')) return true;

  return false;
}

function calculateRetryAt(attempt: number): string {
  const delayMinutes = Math.min(15, Math.max(1, 2 ** Math.max(0, attempt - 1)));
  return new Date(Date.now() + delayMinutes * 60_000).toISOString();
}

function buildSyncSummary(syncResult: TrashGuideSyncResult): string {
  return [
    `Synced TRaSH source (${syncResult.commitsBehind} commit(s) behind)`,
    `parsed=${syncResult.parsedFiles}`,
    `failed=${syncResult.failedFiles}`,
    `ops=${syncResult.activeOperations}`,
    `removed=${syncResult.removedEntities}`,
    `renamed=${syncResult.renamedEntities}`,
    `status=${syncResult.parseStatus}`,
  ].join(', ');
}

function getScheduledRescheduleAt(
  trigger: TrashGuideSyncJobPayload['trigger'],
  enabled: number,
  scheduleMinutes: number
): string | null {
  if (trigger !== 'scheduled') {
    return null;
  }

  if (!hasValidSchedule(enabled, scheduleMinutes)) {
    return null;
  }

  return calculateNextRunFromMinutes(new Date().toISOString(), scheduleMinutes);
}

function buildFailureResult(
  jobId: number,
  sourceId: number,
  message: string,
  attempts: number,
  trigger: TrashGuideSyncJobPayload['trigger'],
  enabled: number,
  scheduleMinutes: number
): JobHandlerResult {
  const scheduledRescheduleAt = getScheduledRescheduleAt(trigger, enabled, scheduleMinutes);

  if (
    trigger === 'scheduled' &&
    hasValidSchedule(enabled, scheduleMinutes) &&
    isTransientGitOrNetworkError(message) &&
    attempts < MAX_TRANSIENT_RETRY_ATTEMPTS
  ) {
    const retryAt = calculateRetryAt(attempts);
    void logger.warn('TRaSH sync job transient failure, scheduling retry', {
      source: 'TrashGuideSyncJob',
      meta: {
        jobId,
        sourceId,
        attempts,
        retryAt,
        error: message,
      },
    });

    return {
      status: 'failure',
      error: message,
      rescheduleAt: retryAt,
    };
  }

  return {
    status: 'failure',
    error: message,
    rescheduleAt: scheduledRescheduleAt,
  };
}

const trashGuideSyncHandler: JobHandler = async (job) => {
  const payload = parsePayload(job.payload, job.source);
  if (!payload) {
    return { status: 'failure', error: 'Invalid TRaSH sync payload' };
  }

  const source = trashGuideSourcesQueries.getById(payload.sourceId);
  if (!source) {
    return { status: 'cancelled', output: 'TRaSH source not found' };
  }

  if (source.enabled !== 1) {
    return { status: 'cancelled', output: 'TRaSH source disabled' };
  }

  const scheduleEnabled = hasValidSchedule(source.enabled, source.sync_strategy);
  if (payload.trigger === 'scheduled') {
    if (!scheduleEnabled) {
      return { status: 'cancelled', output: 'TRaSH source schedule is disabled' };
    }

    if (source.last_synced_at) {
      const dueAt = calculateNextRunFromMinutes(source.last_synced_at, source.sync_strategy);
      if (Date.now() < new Date(dueAt).getTime()) {
        return {
          status: 'skipped',
          output: 'TRaSH sync not due',
          rescheduleAt: dueAt,
        };
      }
    }
  }

  const scheduledRescheduleAt = getScheduledRescheduleAt(payload.trigger, source.enabled, source.sync_strategy);

  let updates: Awaited<ReturnType<typeof trashGuideManager.checkForUpdates>>;
  try {
    updates = await trashGuideManager.checkForUpdates(payload.sourceId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logger.error('TRaSH sync update check failed', {
      source: 'TrashGuideSyncJob',
      meta: { jobId: job.id, sourceId: payload.sourceId, sourceName: source.name, error: message },
    });
    return buildFailureResult(
      job.id,
      payload.sourceId,
      message,
      job.attempts,
      payload.trigger,
      source.enabled,
      source.sync_strategy
    );
  }

  if (!updates.hasUpdates) {
    trashGuideSourcesQueries.updateSyncMetadata(payload.sourceId, { lastSyncedAt: new Date().toISOString() });
    return {
      status: 'skipped',
      output: 'No TRaSH guide updates available',
      rescheduleAt: scheduledRescheduleAt,
    };
  }

  if (source.auto_pull !== 1) {
    trashGuideSourcesQueries.updateSyncMetadata(payload.sourceId, { lastSyncedAt: new Date().toISOString() });
    return {
      status: 'success',
      output: `TRaSH guide updates available (${updates.commitsBehind} commit(s), auto-pull disabled)`,
      rescheduleAt: scheduledRescheduleAt,
    };
  }

  const syncResult = await trashGuideManager.sync(payload.sourceId);
  if (!syncResult.success) {
    const message = syncResult.error ?? 'TRaSH sync failed';
    await logger.error('TRaSH source sync failed', {
      source: 'TrashGuideSyncJob',
      meta: { jobId: job.id, sourceId: payload.sourceId, sourceName: source.name, error: message },
    });
    return buildFailureResult(
      job.id,
      payload.sourceId,
      message,
      job.attempts,
      payload.trigger,
      source.enabled,
      source.sync_strategy
    );
  }

  if (syncResult.parseStatus === 'failed') {
    return {
      status: 'failure',
      error: 'TRaSH parser/schema validation failed',
      rescheduleAt: scheduledRescheduleAt,
    };
  }

  return {
    status: 'success',
    output: buildSyncSummary(syncResult),
    rescheduleAt: scheduledRescheduleAt,
  };
};

jobQueueRegistry.register('trashguide.sync', trashGuideSyncHandler);
