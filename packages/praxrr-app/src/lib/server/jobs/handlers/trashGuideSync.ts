import { trashGuideSourcesQueries } from '$db/queries/trashGuideSources.ts';
import { logger } from '$logger/logger.ts';
import { trashGuideManager, type TrashGuideSyncResult } from '$trashguide/index.ts';
import { coerceTrashGuideSourceArrType, type TrashGuideSupportedArrType } from '$shared/trashguide/types.ts';
import { calculateNextRunFromMinutes } from '../scheduleUtils.ts';
import { jobQueueRegistry } from '../queueRegistry.ts';
import { buildTrashGuideSyncFailure, isRetryableFailureCode } from '../trashguide/syncFailure.ts';
import type {
  JobHandler,
  JobHandlerResult,
  JobRunStatus,
  TrashGuideSyncCounts,
  TrashGuideSyncFailureCode,
  TrashGuideSyncFailureReason,
  TrashGuideSyncJobPayload,
  TrashGuideSyncRunEvidence
} from '../queueTypes.ts';

const MAX_TRANSIENT_RETRY_ATTEMPTS = 3;

type SyncTrigger = TrashGuideSyncJobPayload['trigger'];

interface SourceIdentity {
  id: number;
  name: string | null;
  arrType: TrashGuideSupportedArrType | null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function readNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePayload(payload: Record<string, unknown>, source: 'manual' | 'schedule' | 'system'): TrashGuideSyncJobPayload | null {
  const sourceId = Number(payload.sourceId);
  if (!Number.isFinite(sourceId)) {
    return null;
  }

  const rawTrigger = payload.trigger;
  let trigger: SyncTrigger;

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

  const runTokenRaw = payload.runToken;
  if (runTokenRaw !== undefined && typeof runTokenRaw !== 'string') {
    return null;
  }

  const sourceNameRaw = payload.sourceName;
  if (sourceNameRaw !== undefined && typeof sourceNameRaw !== 'string') {
    return null;
  }

  return {
    sourceId,
    trigger,
    requestedAt: requestedAtRaw,
    runToken: runTokenRaw,
    sourceName: sourceNameRaw,
    sourceArrType: coerceTrashGuideSourceArrType(payload.sourceArrType) ?? undefined
  };
}

function hasValidSchedule(enabled: boolean, scheduleMinutes: number): boolean {
  return enabled && Number.isFinite(scheduleMinutes) && scheduleMinutes > 0;
}

/**
 * Locale/version-fragile substring probe kept ONLY to decide the scheduled auto-retry (preserving the
 * existing retry semantics). Its boolean result is never transported — the transported failure reason
 * and `retry.retryable` come from the typed {@link TrashGuideSyncFailureCode} instead.
 */
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

function countsFromSyncResult(syncResult: TrashGuideSyncResult): TrashGuideSyncCounts {
  return {
    commitsBehind: syncResult.commitsBehind,
    parsedFiles: syncResult.parsedFiles,
    failedFiles: syncResult.failedFiles,
    activeOperations: syncResult.activeOperations,
    removedEntities: syncResult.removedEntities,
    renamedEntities: syncResult.renamedEntities
  };
}

function getScheduledRescheduleAt(trigger: SyncTrigger, enabled: boolean, scheduleMinutes: number): string | null {
  if (trigger !== 'scheduled' || !hasValidSchedule(enabled, scheduleMinutes)) {
    return null;
  }

  return calculateNextRunFromMinutes(new Date().toISOString(), scheduleMinutes);
}

const trashGuideSyncHandler: JobHandler = async (job) => {
  const requestedAt = readString(job.payload.requestedAt);
  const runToken = readString(job.payload.runToken);
  const triggerFallback: SyncTrigger = job.source === 'schedule' ? 'scheduled' : 'manual';

  // Best-effort identity from the durable payload snapshot; refined once the live source is loaded.
  const identity: SourceIdentity = {
    id: readNumber(job.payload.sourceId) ?? 0,
    name: readString(job.payload.sourceName),
    arrType: coerceTrashGuideSourceArrType(job.payload.sourceArrType)
  };

  function buildEvidence(fields: {
    trigger: SyncTrigger;
    status: JobRunStatus;
    counts: TrashGuideSyncCounts | null;
    failure: TrashGuideSyncFailureReason | null;
    rescheduleAt: string | null;
  }): TrashGuideSyncRunEvidence {
    return {
      schemaVersion: 1,
      runToken,
      source: { id: identity.id, name: identity.name, arrType: identity.arrType },
      trigger: fields.trigger,
      requestedAt,
      status: fields.status,
      counts: fields.counts,
      failure: fields.failure,
      retry: {
        rescheduleAt: fields.rescheduleAt,
        retryable: fields.failure ? isRetryableFailureCode(fields.failure.code) : false
      }
    };
  }

  function finalize(evidence: TrashGuideSyncRunEvidence): JobHandlerResult {
    return {
      status: evidence.status,
      output: JSON.stringify(evidence),
      error: evidence.failure?.message,
      rescheduleAt: evidence.retry.rescheduleAt
    };
  }

  function failureEvidence(
    trigger: SyncTrigger,
    code: TrashGuideSyncFailureCode,
    status: JobRunStatus,
    rescheduleAt: string | null,
    counts: TrashGuideSyncCounts | null = null
  ): JobHandlerResult {
    return finalize(buildEvidence({ trigger, status, counts, failure: buildTrashGuideSyncFailure(code), rescheduleAt }));
  }

  try {
    const payload = parsePayload(job.payload, job.source);
    if (!payload) {
      return failureEvidence(triggerFallback, 'internal', 'failure', null);
    }

    identity.id = payload.sourceId;
    const trigger = payload.trigger;

    const source = trashGuideSourcesQueries.getById(payload.sourceId);
    if (!source) {
      // AC5: keep the run identifiable from the durable snapshot even though the source is gone.
      return failureEvidence(trigger, 'source_missing', 'cancelled', null);
    }

    // Refine identity from the live source (freshest name/arr type).
    identity.name = source.name;
    identity.arrType = coerceTrashGuideSourceArrType(source.arr_type) ?? identity.arrType;

    if (!source.enabled) {
      return failureEvidence(trigger, 'source_disabled', 'cancelled', null);
    }

    const scheduleEnabled = hasValidSchedule(source.enabled, source.sync_strategy);
    if (trigger === 'scheduled') {
      if (!scheduleEnabled) {
        // Benign: the scheduler is disabled for this source; not an operator-facing error.
        return finalize(buildEvidence({ trigger, status: 'cancelled', counts: null, failure: null, rescheduleAt: null }));
      }

      if (source.last_synced_at) {
        const dueAt = calculateNextRunFromMinutes(source.last_synced_at, source.sync_strategy);
        if (Date.now() < new Date(dueAt).getTime()) {
          return finalize(buildEvidence({ trigger, status: 'skipped', counts: null, failure: null, rescheduleAt: dueAt }));
        }
      }
    }

    const scheduledRescheduleAt = getScheduledRescheduleAt(trigger, source.enabled, source.sync_strategy);

    function resolveRunFailure(message: string): JobHandlerResult {
      const transient = isTransientGitOrNetworkError(message);
      const code: TrashGuideSyncFailureCode = transient ? 'network' : 'sync_failed';
      let rescheduleAt = scheduledRescheduleAt;

      if (trigger === 'scheduled' && transient && scheduleEnabled && job.attempts < MAX_TRANSIENT_RETRY_ATTEMPTS) {
        rescheduleAt = calculateRetryAt(job.attempts);
        void logger.warn('TRaSH sync job transient failure, scheduling retry', {
          source: 'TrashGuideSyncJob',
          meta: { jobId: job.id, sourceId: identity.id, attempts: job.attempts, retryAt: rescheduleAt, error: message }
        });
      }

      return failureEvidence(trigger, code, 'failure', rescheduleAt);
    }

    let updates: Awaited<ReturnType<typeof trashGuideManager.checkForUpdates>>;
    try {
      updates = await trashGuideManager.checkForUpdates(payload.sourceId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logger.error('TRaSH sync update check failed', {
        source: 'TrashGuideSyncJob',
        meta: { jobId: job.id, sourceId: payload.sourceId, sourceName: source.name, error: message }
      });
      return resolveRunFailure(message);
    }

    if (!updates.hasUpdates && trigger !== 'manual') {
      trashGuideSourcesQueries.updateSyncMetadata(payload.sourceId, { lastSyncedAt: new Date().toISOString() });
      return finalize(
        buildEvidence({
          trigger,
          status: 'skipped',
          counts: { commitsBehind: 0, parsedFiles: 0, failedFiles: 0, activeOperations: 0, removedEntities: 0, renamedEntities: 0 },
          failure: null,
          rescheduleAt: scheduledRescheduleAt
        })
      );
    }

    if (!source.auto_pull) {
      trashGuideSourcesQueries.updateSyncMetadata(payload.sourceId, { lastSyncedAt: new Date().toISOString() });
      return finalize(
        buildEvidence({
          trigger,
          status: 'success',
          counts: { commitsBehind: updates.commitsBehind, parsedFiles: 0, failedFiles: 0, activeOperations: 0, removedEntities: 0, renamedEntities: 0 },
          failure: null,
          rescheduleAt: scheduledRescheduleAt
        })
      );
    }

    let syncResult: Awaited<ReturnType<typeof trashGuideManager.sync>>;
    try {
      syncResult = await trashGuideManager.sync(payload.sourceId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logger.error('TRaSH source sync failed', {
        source: 'TrashGuideSyncJob',
        meta: { jobId: job.id, sourceId: payload.sourceId, sourceName: source.name, error: message }
      });
      return resolveRunFailure(message);
    }

    if (!syncResult.success) {
      const message = syncResult.error ?? 'TRaSH sync failed';
      await logger.error('TRaSH source sync failed', {
        source: 'TrashGuideSyncJob',
        meta: { jobId: job.id, sourceId: payload.sourceId, sourceName: source.name, error: message }
      });
      return resolveRunFailure(message);
    }

    if (syncResult.parseStatus === 'failed') {
      return failureEvidence(trigger, 'parser_failed', 'failure', scheduledRescheduleAt, countsFromSyncResult(syncResult));
    }

    return finalize(
      buildEvidence({
        trigger,
        status: 'success',
        counts: countsFromSyncResult(syncResult),
        failure: null,
        rescheduleAt: scheduledRescheduleAt
      })
    );
  } catch (error) {
    // Total handler: any unexpected throw becomes typed, safe evidence — the dispatcher never persists
    // a raw exception message. Full diagnostics go only to the sanitized logger boundary.
    const message = error instanceof Error ? error.message : String(error);
    await logger.error('TRaSH sync handler crashed', {
      source: 'TrashGuideSyncJob',
      meta: { jobId: job.id, sourceId: identity.id, error: message }
    });
    return failureEvidence(triggerFallback, 'internal', 'failure', null);
  }
};

jobQueueRegistry.register('trashguide.sync', trashGuideSyncHandler);
