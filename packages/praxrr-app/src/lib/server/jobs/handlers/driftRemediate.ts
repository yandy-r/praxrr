/**
 * `drift.remediate` handler — one opt-in auto-remediation attempt (docs/plans/drift-remediation/plan.md §6).
 *
 * Never writes unless every guard holds at handler time:
 *   1. re-evaluate the policy/row/Canary/in-progress state and require `remediate` with the SAME
 *      signature the job was queued for (the "never writes unless drifted" double check);
 *   2. claim the signature (`markAutoAttempt`, value-guarded on the stored signature) before any
 *      I/O — one attempt per signature;
 *   3. create a drift-tagged reviewed preview for the target sections;
 *   4. drop sections whose preview contains managed deletes, then require the preview's own
 *      alerting signature over the remaining sections to equal the stored one (D12);
 *   5. apply through `applyReviewedPreview` (same core as the human apply route), which records
 *      the drift-linked sync history and `last_remediation_*` on the executed path;
 *   6. notify, then re-run the drift check to verify (the attempt claim prevents a loop).
 *
 * A retriable precondition that wrote nothing (preview rejected/failed, a preview whose sections
 * errored so drift could not be compared, apply rejected before the reviewed executor ran, or a
 * throw before apply) RELEASES the claim instead of spending it, sends no failure notification,
 * and lets the next drift refresh re-enqueue. Only a verdict a retry cannot change (every target
 * section has managed deletes, or the preview's signature really differs) or an apply that may
 * have written keeps the claim.
 */

import { jobQueueRegistry } from '../queueRegistry.ts';
import type { JobHandler, JobHandlerResult, JobQueueRecord } from '../queueTypes.ts';
import { arrInstancesQueries, type ArrInstance } from '$db/queries/arrInstances.ts';
import { driftStatusQueries } from '$db/queries/driftStatus.ts';
import { publishDriftRowUpdated } from '$lib/server/events/publish.ts';
import { logger } from '$logger/logger.ts';
import { sectionsIncludeManagedDelete } from '$shared/sync/managedDeletes.ts';
import { syncHistoryQueries } from '$db/queries/syncHistory.ts';
import { aggregateDrift, driftSignature, signatureOfKeys } from '$sync/drift/check.ts';
import { checkAndPersistInstance } from '$sync/drift/persist.ts';
import { evaluateAutoRemediation, notifyDriftRemediation } from '$sync/drift/remediation.ts';
import { alertingKeys } from '$sync/drift/suppression.ts';
import type { DriftEntityChange, DriftRemediationLink, DriftRemediationStatus } from '$sync/drift/types.ts';
import { applyReviewedPreview } from '$sync/preview/apply.ts';
import { createReviewedPreview } from '$sync/preview/create.ts';
import type { GeneratePreviewResult } from '$sync/preview/orchestrator.ts';
import {
  isSyncPreviewArrType,
  type SyncPreviewArrType,
  type SyncPreviewResult,
  type SyncPreviewSection,
} from '$sync/preview/types.ts';

const SOURCE = 'DriftRemediateJob';

export interface DriftRemediateDependencies {
  readonly createReviewedPreview: typeof createReviewedPreview;
  readonly applyReviewedPreview: typeof applyReviewedPreview;
  readonly checkAndPersistInstance: (instance: ArrInstance) => Promise<unknown>;
  readonly now: () => number;
}

const DEFAULT_DEPENDENCIES: DriftRemediateDependencies = {
  createReviewedPreview: (input) => createReviewedPreview(input),
  applyReviewedPreview: (previewId, input) => applyReviewedPreview(previewId, input),
  checkAndPersistInstance: (instance) => checkAndPersistInstance(instance),
  now: () => Date.now(),
};

interface ValidPayload {
  readonly instanceId: number;
  readonly driftSignature: string;
}

function readPayload(job: JobQueueRecord): ValidPayload | null {
  const payload: Record<string, unknown> = job.payload;
  const instanceId = payload.instanceId;
  const signature = payload.driftSignature;
  if (typeof instanceId !== 'number' || !Number.isInteger(instanceId) || instanceId <= 0) return null;
  if (typeof signature !== 'string' || signature.length === 0) return null;
  return { instanceId, driftSignature: signature };
}

/** Adapt a stored preview snapshot to the shape the pure drift aggregator reads. */
function toAggregateInput(preview: SyncPreviewResult): GeneratePreviewResult {
  return {
    instanceId: preview.instanceId,
    instanceName: preview.instanceName,
    arrType: preview.arrType,
    status: preview.status,
    createdAtMs: Date.parse(preview.createdAt),
    sections: [...preview.sections],
    sectionOutcomes: [...preview.sectionOutcomes],
    qualityProfiles: preview.qualityProfiles,
    delayProfiles: preview.delayProfiles,
    mediaManagement: preview.mediaManagement,
    metadataProfiles: preview.metadataProfiles,
    summary: preview.summary,
  };
}

type VerifyResult =
  | { readonly ok: true; readonly sections: SyncPreviewSection[] }
  | { readonly ok: false; readonly reason: 'managed_delete' | 'stale' | 'unverifiable' };

/**
 * D11/D12: exclude sections containing managed deletes (auto never deletes), then require the
 * preview's alerting signature over the remaining sections to match the stored drift restricted
 * to the same sections. A section error (or nothing compared) leaves the comparison
 * `unverifiable` — a transient read failure, not a verdict — while a real mismatch is `stale`.
 */
function verifyPreview(
  preview: SyncPreviewResult,
  sections: readonly SyncPreviewSection[],
  storedChanges: readonly DriftEntityChange[]
): VerifyResult {
  const kept = sections.filter((section) => !sectionsIncludeManagedDelete(preview, [section]));
  if (kept.length === 0) {
    return { ok: false, reason: 'managed_delete' };
  }

  const keptSet = new Set<SyncPreviewSection>(kept);
  const aggregate = aggregateDrift(toAggregateInput(preview), keptSet);
  if (aggregate.anySectionErrored || !aggregate.comparedAny) {
    return { ok: false, reason: 'unverifiable' };
  }

  const previewSignature = driftSignature(aggregate.changes);
  const storedSignature = signatureOfKeys(alertingKeys(storedChanges.filter((change) => keptSet.has(change.section))));
  if (previewSignature === null || previewSignature !== storedSignature) {
    return { ok: false, reason: 'stale' };
  }
  return { ok: true, sections: kept };
}

function recordOutcome(instanceId: number, status: DriftRemediationStatus, signature: string, nowMs: number): void {
  driftStatusQueries.recordRemediation(instanceId, {
    trigger: 'auto',
    status,
    signature,
    at: new Date(nowMs).toISOString(),
    syncHistoryId: null,
  });
  publishDriftRowUpdated(instanceId);
}

/**
 * The run status the reviewed executor stamped into `last_remediation_*` for this attempt, read
 * independently of Sync History (which may be disabled, leaving `syncHistoryId` null). Only a
 * record written after `priorAt` (the stamp before apply) for this signature counts.
 */
function executorRecordedStatus(
  instanceId: number,
  signature: string,
  priorAt: string | null
): DriftRemediationStatus | undefined {
  const record = driftStatusQueries.getById(instanceId)?.lastRemediation;
  if (!record || record.signature !== signature || record.at === null || record.at === priorAt) return undefined;
  return record.status === 'success' || record.status === 'partial' || record.status === 'failed'
    ? record.status
    : undefined;
}

/** Give the attempt back: nothing was written, so the next drift refresh may re-enqueue it. */
function releaseClaim(instanceId: number, signature: string, target: string, reason: string): JobHandlerResult {
  if (driftStatusQueries.releaseAutoAttempt(instanceId, signature)) {
    publishDriftRowUpdated(instanceId);
  }
  return { status: 'cancelled', target, decision: `Deferred, nothing written: ${reason}` };
}

/** Build the handler with injectable preview/apply/re-check seams (tests stub them). */
export function createDriftRemediateHandler(overrides: Partial<DriftRemediateDependencies> = {}): JobHandler {
  const deps: DriftRemediateDependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };

  return async (job): Promise<JobHandlerResult> => {
    const payload = readPayload(job);
    if (!payload) {
      return { status: 'failure', failureCode: 'invalidPayload', decision: 'Malformed drift remediation payload' };
    }

    const instance = arrInstancesQueries.getById(payload.instanceId);
    if (!instance) {
      return { status: 'cancelled', target: null, decision: 'Instance no longer exists' };
    }
    if (!isSyncPreviewArrType(instance.type) || instance.enabled !== 1) {
      return { status: 'cancelled', target: instance.name, decision: 'Instance is disabled or unsupported' };
    }
    const arrType: SyncPreviewArrType = instance.type;

    // 1. Re-validate at handler time; never trust the enqueue-time decision.
    const nowMs = deps.now();
    const { decision, row } = evaluateAutoRemediation(instance, arrType, nowMs);
    if (decision.kind !== 'remediate') {
      const reason = decision.kind === 'skip' ? decision.reason : 'canary_hold';
      return { status: 'cancelled', target: instance.name, decision: `Not remediated: ${reason}` };
    }
    if (!row || row.driftSignature !== payload.driftSignature) {
      return { status: 'cancelled', target: instance.name, decision: 'Not remediated: drift signature changed' };
    }

    // 2. Claim the single attempt for this signature before any I/O. The claim is value-guarded on
    //    the stored signature, so a false result is either a prior attempt or drift that moved on.
    const signature = payload.driftSignature;
    if (!driftStatusQueries.markAutoAttempt(instance.id, signature)) {
      const moved = driftStatusQueries.getById(instance.id)?.driftSignature !== signature;
      return {
        status: 'cancelled',
        target: instance.name,
        decision: moved ? 'Not remediated: drift signature changed' : 'Not remediated: already_attempted',
      };
    }
    publishDriftRowUpdated(instance.id);

    const link: DriftRemediationLink = decision.link;
    const notifyBase = { instanceId: instance.id, instanceName: instance.name, arrType } as const;
    let applyStarted = false;

    try {
      // 3. Drift-tagged reviewed preview for exactly the target sections. Nothing is written yet.
      const created = await deps.createReviewedPreview({
        instanceId: instance.id,
        sections: [...decision.sections],
        driftRemediation: link,
      });
      if (created.kind !== 'ok') {
        const reason = created.kind === 'rejected' ? `preview rejected (HTTP ${created.status})` : 'preview failed';
        return releaseClaim(instance.id, signature, instance.name, reason);
      }

      // 4. Verify before any write. A section error is transient (nothing written), so the claim is
      //    given back; managed deletes or a real signature mismatch cannot change for this
      //    signature on retry, so those spend the attempt.
      const verified = verifyPreview(created.preview, decision.sections, row.changes);
      if (!verified.ok && verified.reason === 'unverifiable') {
        return releaseClaim(instance.id, signature, instance.name, 'preview sections errored; drift unverifiable');
      }
      if (!verified.ok) {
        recordOutcome(instance.id, 'skipped', signature, deps.now());
        return {
          status: 'cancelled',
          target: instance.name,
          decision:
            verified.reason === 'managed_delete'
              ? 'Not remediated: every target section contains managed deletes'
              : 'Not remediated: stale (preview no longer matches stored drift)',
        };
      }

      // 5. Apply through the shared reviewed-apply core (records linked history on execution).
      const priorRemediationAt = driftStatusQueries.getById(instance.id)?.lastRemediation.at ?? null;
      applyStarted = true;
      const applied = await deps.applyReviewedPreview(created.preview.id, {
        sections: [...verified.sections],
        source: 'system',
        principal: null,
      });

      // Every non-500 apply error is a gate before the reviewed executor runs (missing/not-ready
      // preview, section scope, staleness, in-progress claim conflict, invalidated review).
      if (applied.kind === 'error' && applied.httpStatus !== 500) {
        return releaseClaim(instance.id, signature, instance.name, `apply rejected (HTTP ${applied.httpStatus})`);
      }

      let result: JobHandlerResult;
      if (applied.kind === 'applied' && applied.response.success) {
        notifyDriftRemediation({
          ...notifyBase,
          kind: 'applied',
          sections: verified.sections,
          syncHistoryId: applied.response.syncHistoryId,
        });
        result = {
          status: 'success',
          target: instance.name,
          output: `Remediated ${verified.sections.join(', ')}`,
          decision: 'Applied reviewed drift remediation',
        };
      } else if (applied.kind === 'applied') {
        const syncHistoryId = applied.response.syncHistoryId;
        const runStatus =
          executorRecordedStatus(instance.id, signature, priorRemediationAt) ??
          (syncHistoryId !== null ? syncHistoryQueries.getById(syncHistoryId)?.status : undefined);
        if (runStatus === undefined) {
          // Neither the executor's linked record nor a history row exists; never leave it stale.
          recordOutcome(instance.id, 'failed', signature, deps.now());
        }
        const partial = runStatus === 'partial';
        notifyDriftRemediation({
          ...notifyBase,
          kind: partial ? 'partial' : 'failed',
          sections: verified.sections,
          syncHistoryId,
        });
        result = {
          status: 'failure',
          failureCode: 'upstream',
          target: instance.name,
          decision: partial
            ? 'Drift remediation partially applied; some sections failed'
            : 'Drift remediation apply did not succeed',
        };
      } else {
        // HTTP 500 from the apply core: the executor may have started writing, so keep the claim.
        recordOutcome(instance.id, 'failed', signature, deps.now());
        notifyDriftRemediation({ ...notifyBase, kind: 'failed', sections: verified.sections, syncHistoryId: null });
        result = {
          status: 'failure',
          failureCode: 'internalError',
          target: instance.name,
          decision: 'Drift remediation apply failed unexpectedly',
        };
      }

      // 6. Re-verify; the per-signature attempt claim prevents a re-queue loop.
      await deps.checkAndPersistInstance(instance);
      return result;
    } catch (error) {
      await logger.error('Drift auto-remediation failed', {
        source: SOURCE,
        meta: { jobId: job.id, instanceId: instance.id, error: error instanceof Error ? error.message : String(error) },
      });
      try {
        if (!applyStarted) {
          return releaseClaim(instance.id, signature, instance.name, 'unexpected error before apply');
        }
        recordOutcome(instance.id, 'failed', signature, deps.now());
      } catch {
        /* recording is best-effort after a failure */
      }
      notifyDriftRemediation({ ...notifyBase, kind: 'failed', sections: decision.sections, syncHistoryId: null });
      return { status: 'failure', failureCode: 'internalError', target: instance.name };
    }
  };
}

jobQueueRegistry.register('drift.remediate', createDriftRemediateHandler());
