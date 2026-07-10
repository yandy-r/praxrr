/**
 * Canary rollout coordinator (issue #19).
 *
 * Thin orchestration over the existing per-instance sync primitive `executeSyncJob`.
 * A rollout is scoped to exactly one `arr_type` (resolved by `selection.resolveCanary`);
 * the canary and every remaining target live in that cohort only — no sibling fallback.
 *
 * Phase A (`startRollout`) runs the canary sync inline, classifies its outcome from the
 * just-recorded `sync_history` row, and either auto-skips (single eligible target),
 * aborts fail-closed (failed / skipped / partial+abort), or halts at the persisted
 * verification gate (`awaiting_confirmation`) with a live preview of the remaining
 * instances. Phase B is confirmed via `proceedRollout` (enqueues the resumable rollout
 * job) or cancelled via `abortRollout`. Both gate transitions are `state_token`
 * value-guarded so a stale caller cannot double-proceed.
 */

import { FAILURE_COPY } from '$jobs/evidence.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { canaryRolloutQueries } from '$db/queries/canaryRollouts.ts';
import { canarySettingsQueries } from '$db/queries/canarySettings.ts';
import { syncHistoryQueries } from '$db/queries/syncHistory.ts';
import { executeSyncJob } from '$jobs/handlers/arrSync.ts';
import { enqueueJob } from '$jobs/queueService.ts';
import type { JobRunStatus } from '$jobs/queueTypes.ts';
import { logger } from '$logger/logger.ts';
import { sanitizeLogMeta } from '$logger/sanitizer.ts';
import { buildPreviewFailure, classifyPreviewFailure } from '$sync/preview/failureReason.ts';
import type { GeneratePreviewResult } from '$sync/preview/orchestrator.ts';
import { generateInstancePreviews } from '$sync/processor.ts';
import type { SectionType } from '$sync/types.ts';
import {
  CanaryNotFoundError,
  CanaryPreviewUnavailableError,
  CanaryStaleTokenError,
  CanaryStateError,
  CanaryUnresolvedError,
} from './errors.ts';
import { notifyCanaryFailed } from './notify.ts';
import { isCanaryResolutionError, resolveCanary, resolveSyncArrType } from './selection.ts';
import { newStateToken } from './token.ts';
import type {
  CanaryArrType,
  CanaryOutcomeStatus,
  CanaryRemainingPreviewEvidence,
  CanaryRolloutDetail,
  CanaryRolloutStatus,
  CanaryStartInput,
  CanaryStartResult,
  CanaryTarget,
  SyncRunResult,
} from './types.ts';

/** Classified canary outcome plus the linked audit row id (diagnostics source), when present. */
interface CanaryClassification {
  canaryStatus: CanaryOutcomeStatus;
  canarySyncHistoryId: number | null;
}

/** Run one instance through the full sync flow. `null` sections => all configured (empty arg). */
function runCanarySync(instanceId: number, sections: SectionType[] | null): Promise<SyncRunResult> {
  return executeSyncJob(instanceId, sections ?? [], 'manual');
}

/** Conservative map from the primitive's `JobRunStatus` — never upgrades a failure to success. */
function mapJobRunStatus(status: JobRunStatus): CanaryOutcomeStatus {
  switch (status) {
    case 'success':
      return 'success';
    case 'skipped':
      return 'skipped';
    case 'failure':
    case 'cancelled':
      return 'failed';
  }
}

/**
 * Classify the canary outcome precisely. Read the newest `sync_history` row for THIS
 * instance within the `from` window (captured before dispatch) and assert it belongs to
 * the canary before trusting it. When no bounded row exists (history disabled, or a
 * mid-run disable yields `cancelled` with no audit row), fall through to the conservative
 * `JobRunStatus` mapping — never read an older row that could upgrade a fail to success.
 *
 * The canary sync runs inline with `trigger: 'manual'`, so the read is scoped to
 * `trigger: 'manual'` to exclude a concurrently-dispatched `schedule`/`system` sync of the
 * same instance (which could otherwise win the newest-row ordering and mis-classify a
 * failed canary as its success). The residual (a second *manual* sync of the same instance
 * within the sub-second canary window) is implausible and operator-initiated.
 */
function classifyCanaryOutcome(canaryId: number, from: string, result: SyncRunResult): CanaryClassification {
  const rows = syncHistoryQueries.search({ instanceId: canaryId, from, trigger: 'manual' }, { limit: 1, offset: 0 });
  const row = rows[0];
  if (row && row.arrInstanceId === canaryId) {
    return { canaryStatus: row.status, canarySyncHistoryId: row.id };
  }
  return {
    canaryStatus: mapJobRunStatus(result.status),
    canarySyncHistoryId: null,
  };
}

/** Decide the post-canary status: fail-closed on failed/skipped/partial+abort, else gate. */
function decideGateStatus(canaryStatus: CanaryOutcomeStatus, partialPolicy: 'gate' | 'abort'): CanaryRolloutStatus {
  if (canaryStatus === 'failed' || canaryStatus === 'skipped') {
    return 'aborted';
  }
  if (canaryStatus === 'partial' && partialPolicy === 'abort') {
    return 'aborted';
  }
  return 'awaiting_confirmation';
}

/**
 * Diagnostics string persisted as `canary_error` when a canary aborts. The primitive now returns a
 * typed `failureCode` (issue #237), so surface the pre-authored safe copy for it — never raw text.
 */
function abortReason(result: SyncRunResult, canaryStatus: CanaryOutcomeStatus): string {
  if (result.status === 'failure') {
    return FAILURE_COPY[result.failureCode].message;
  }
  return canaryStatus === 'skipped'
    ? 'Canary sync was skipped (all sections gated or unsupported); rollout aborted for review.'
    : 'Canary sync did not pass; rollout aborted.';
}

function hasExactSections(preview: GeneratePreviewResult, sections: readonly SectionType[] | null): boolean {
  return (
    sections === null ||
    sections.length === 0 ||
    (preview.sections.length === sections.length &&
      preview.sections.every((section, index) => section === sections[index]))
  );
}

/**
 * Build durable evidence for the exact persisted remaining cohort. Any missing,
 * disabled, renamed, wrong-Arr, duplicate, extra, or section-failed preview makes the
 * aggregate unavailable; targets are never silently dropped or substituted.
 */
export async function buildRemainingPreviewEvidence(
  arrType: CanaryArrType,
  remaining: readonly CanaryTarget[],
  sections: SectionType[] | null,
  generatePreviews: typeof generateInstancePreviews = generateInstancePreviews
): Promise<CanaryRemainingPreviewEvidence> {
  const generatedAt = new Date().toISOString();
  const enabledById = new Map(arrInstancesQueries.getEnabled().map((instance) => [instance.id, instance]));
  const targetIds = new Set<number>();
  for (const target of remaining) {
    const instance = enabledById.get(target.instanceId);
    if (
      targetIds.has(target.instanceId) ||
      !instance ||
      instance.name !== target.instanceName ||
      resolveSyncArrType(instance.type) !== arrType
    ) {
      return {
        version: 1,
        availability: 'unavailable',
        generatedAt,
        failure: buildPreviewFailure('internalError', arrType),
        partialPreviews: [],
      };
    }
    targetIds.add(target.instanceId);
  }

  try {
    const previews = await generatePreviews(
      remaining.map((target) => ({
        instanceId: target.instanceId,
        sections: sections ?? undefined,
      }))
    );
    const previewIds = new Set<number>();
    const exact =
      previews.length === remaining.length &&
      previews.every((preview) => {
        const target = remaining.find((candidate) => candidate.instanceId === preview.instanceId);
        if (
          !target ||
          previewIds.has(preview.instanceId) ||
          preview.instanceName !== target.instanceName ||
          preview.arrType !== arrType ||
          !hasExactSections(preview, sections)
        ) {
          return false;
        }
        previewIds.add(preview.instanceId);
        return true;
      });
    if (!exact) {
      return {
        version: 1,
        availability: 'unavailable',
        generatedAt,
        failure: buildPreviewFailure('internalError', arrType),
        partialPreviews: [],
      };
    }

    if (previews.some((preview) => preview.sectionOutcomes.some((outcome) => outcome.failure !== null))) {
      return {
        version: 1,
        availability: 'unavailable',
        generatedAt,
        failure: buildPreviewFailure('sectionErrors', arrType),
        partialPreviews: previews,
      };
    }

    return { version: 1, availability: 'available', generatedAt, previews };
  } catch (error) {
    const failure = classifyPreviewFailure(error, arrType);
    await logger.error('Canary remaining-target preview generation failed', {
      source: 'CanaryCoordinator',
      meta: sanitizeLogMeta({
        arrType,
        targetIds: remaining.map((target) => target.instanceId),
        failureCode: failure.code,
        error: error instanceof Error ? error.message : String(error),
      }),
    });
    return {
      version: 1,
      availability: 'unavailable',
      generatedAt,
      failure,
      partialPreviews: [],
    };
  }
}

/** Re-fetch a rollout as detail or fail fast — the row was just written in this call. */
function requireDetail(id: number): CanaryRolloutDetail {
  const detail = canaryRolloutQueries.getById(id);
  if (!detail) {
    throw new CanaryNotFoundError(`Canary rollout ${id} not found`);
  }
  return detail;
}

/**
 * Phase A. Resolve the canary + same-`arr_type` cohort, run the canary sync inline,
 * classify it, and either auto-skip, abort fail-closed, or halt at the gate.
 */
export async function startRollout(input: CanaryStartInput): Promise<CanaryStartResult> {
  const settings = canarySettingsQueries.get();
  const resolution = resolveCanary(input, settings);
  if (isCanaryResolutionError(resolution)) {
    // An explicit canaryInstanceId that references a non-existent instance is a 404
    // (matching the documented contract); every other resolution failure is a 422.
    if (resolution.notFound) {
      throw new CanaryNotFoundError(resolution.error);
    }
    throw new CanaryUnresolvedError(resolution.error);
  }

  const { arrType, canary, remaining, sections, maxBatchSize, partialPolicy, trigger } = resolution;

  // Single eligible target (only the canary) — skip the staged flow, run a normal sync.
  if (remaining.length === 0) {
    const result = await runCanarySync(canary.instanceId, sections);
    return { skipped: true, result };
  }

  const rolloutId = canaryRolloutQueries.insert({
    arrType,
    canaryInstanceId: canary.instanceId,
    canaryInstanceName: canary.instanceName,
    sections,
    maxBatchSize,
    partialPolicy,
    remainingTargets: remaining,
    trigger,
    startedAt: new Date().toISOString(),
    stateToken: newStateToken(),
  });

  // Capture the canary window BEFORE dispatch so classification reads only this run's row.
  const now = new Date().toISOString();
  const result = await runCanarySync(canary.instanceId, sections);
  const { canaryStatus, canarySyncHistoryId } = classifyCanaryOutcome(canary.instanceId, now, result);

  const status = decideGateStatus(canaryStatus, partialPolicy);
  const isAbort = status === 'aborted';
  const remainingPreview = isAbort ? null : await buildRemainingPreviewEvidence(arrType, remaining, sections);

  const recorded = canaryRolloutQueries.recordCanaryOutcome(rolloutId, {
    status,
    canaryStatus,
    canaryOutput: result.output ?? null,
    canaryError: isAbort
      ? abortReason(result, canaryStatus)
      : result.status === 'failure'
        ? FAILURE_COPY[result.failureCode].message
        : null,
    canarySyncHistoryId,
    remainingPreview,
    nextToken: newStateToken(),
    finishedAt: isAbort ? new Date().toISOString() : null,
  });
  if (!recorded) {
    throw new CanaryStateError(`Canary rollout ${rolloutId} changed before its outcome could be recorded`);
  }

  const rollout = requireDetail(rolloutId);

  if (isAbort) {
    // Fail-closed: remaining instances are never dispatched. Notify best-effort.
    notifyCanaryFailed(rollout);
    return { skipped: false, rollout };
  }

  return { skipped: false, rollout };
}

function hasExactAvailableEvidence(rollout: CanaryRolloutDetail): boolean {
  if (rollout.remainingPreview.availability !== 'available') return false;
  const targetById = new Map(rollout.remainingTargets.map((target) => [target.instanceId, target]));
  const ids = new Set<number>();
  return (
    rollout.remainingPreview.previews.length === rollout.remainingTargets.length &&
    rollout.remainingPreview.previews.every((preview) => {
      const target = targetById.get(preview.instanceId);
      if (
        !target ||
        ids.has(preview.instanceId) ||
        preview.instanceName !== target.instanceName ||
        preview.arrType !== rollout.arrType ||
        !hasExactSections(preview, rollout.sections) ||
        preview.sectionOutcomes.some((outcome) => outcome.failure !== null)
      ) {
        return false;
      }
      ids.add(preview.instanceId);
      return true;
    })
  );
}

/**
 * Phase B confirm. Value-guarded transition `awaiting_confirmation` -> `rolling_out` on
 * the caller's `expectedToken`, then enqueue the resumable rollout job. Distinguishes
 * wrong-state (409) from a stale token (422) so routes map cleanly.
 */
export function proceedRollout(id: number, expectedToken: string): CanaryRolloutDetail {
  const rollout = canaryRolloutQueries.getById(id);
  if (!rollout) {
    throw new CanaryNotFoundError(`Canary rollout ${id} not found`);
  }
  if (rollout.status !== 'awaiting_confirmation') {
    throw new CanaryStateError(`Canary rollout ${id} is ${rollout.status}, not awaiting confirmation`);
  }
  if (!hasExactAvailableEvidence(rollout)) {
    const failure =
      rollout.remainingPreview.availability === 'unavailable'
        ? rollout.remainingPreview.failure
        : buildPreviewFailure('internalError', rollout.arrType);
    throw new CanaryPreviewUnavailableError(failure);
  }

  const advanced = canaryRolloutQueries.markRollingOut(id, expectedToken, newStateToken());
  if (!advanced) {
    throw new CanaryStaleTokenError(`Canary rollout ${id} state token is stale; refresh the gate and retry`);
  }

  enqueueJob({
    jobType: 'sync.canary.rollout',
    payload: { rolloutId: id },
    source: 'manual',
    runAt: new Date().toISOString(),
    dedupeKey: `canary.rollout:${id}`,
  });

  return requireDetail(id);
}

/**
 * Phase B cancel. Value-guarded transition `awaiting_confirmation` -> `aborted` on the
 * caller's `expectedToken`. Pure control flow — remaining instances are simply never
 * dispatched.
 */
export function abortRollout(id: number, expectedToken: string): CanaryRolloutDetail {
  const rollout = canaryRolloutQueries.getById(id);
  if (!rollout) {
    throw new CanaryNotFoundError(`Canary rollout ${id} not found`);
  }
  if (rollout.status !== 'awaiting_confirmation') {
    throw new CanaryStateError(`Canary rollout ${id} is ${rollout.status}, not awaiting confirmation`);
  }

  const aborted = canaryRolloutQueries.abort(id, expectedToken, new Date().toISOString());
  if (!aborted) {
    throw new CanaryStaleTokenError(`Canary rollout ${id} state token is stale; refresh the gate and retry`);
  }

  return requireDetail(id);
}
