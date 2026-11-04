/**
 * Reviewed sync preview apply core.
 *
 * Shared by `POST /api/v1/sync/preview/{previewId}/apply` and the `drift.remediate` job so a human
 * apply and an auto-remediation take the exact same claim, staleness, managed-delete, and
 * invalidation path. HTTP body parsing stays in the route; this core receives typed input.
 *
 * The drift link written to sync history always comes from the stored snapshot
 * (`snapshot.driftRemediation`), never from caller input.
 */

import type { components } from '$api/v1.d.ts';
import type { AuthPrincipal } from '$auth/principal.ts';
import { logger } from '$logger/logger.ts';
import { executeReviewedSyncJob, getSectionsInProgress } from '$jobs/handlers/arrSync.ts';
import { hasScope } from '$shared/auth/apiTokenScopes.ts';
import { sectionsIncludeManagedDelete } from '$shared/sync/managedDeletes.ts';
import type { SectionType } from '$sync/types.ts';
import { buildPreviewFailure, classifyPreviewFailure } from './failureReason.ts';
import {
  evaluatePreviewStaleness,
  PREVIEW_STATUS_APPLIED,
  PREVIEW_STATUS_FAILED,
  PREVIEW_STATUS_READY,
  previewStore,
} from './store.ts';
import type { SyncPreviewResult, SyncPreviewReviewInvalidationReason } from './types.ts';

type ErrorResponse = components['schemas']['ErrorResponse'];
type ScopeForbiddenResponse = components['schemas']['ScopeForbiddenResponse'];
type SyncPreviewApplyResponse = components['schemas']['SyncPreviewApplyResponse'];
type SyncPreviewApplyErrorResponse = components['schemas']['SyncPreviewApplyErrorResponse'];
type SyncPreviewApplyInvalidatedResponse = components['schemas']['SyncPreviewApplyInvalidatedResponse'];

export interface SyncPreviewApplyDependencies {
  readonly getSectionsInProgress: typeof getSectionsInProgress;
  readonly executeReviewedSyncJob: typeof executeReviewedSyncJob;
  readonly now: () => number;
}

export const DEFAULT_SYNC_PREVIEW_APPLY_DEPENDENCIES: SyncPreviewApplyDependencies = {
  getSectionsInProgress,
  executeReviewedSyncJob,
  now: Date.now,
};

export interface ApplyReviewedPreviewInput {
  /** Explicit, validated sections to apply; undefined applies every eligible section. */
  readonly sections?: SectionType[];
  readonly source: 'manual' | 'system';
  /** Token principals without `admin` cannot apply managed deletes; null/session pass. */
  readonly principal: AuthPrincipal | null;
}

export type ApplyReviewedPreviewErrorBody =
  ErrorResponse | ScopeForbiddenResponse | SyncPreviewApplyErrorResponse | SyncPreviewApplyInvalidatedResponse;

export type ApplyReviewedPreviewOutcome =
  | { readonly kind: 'applied'; readonly response: SyncPreviewApplyResponse; readonly httpStatus: 200 | 500 }
  | {
      readonly kind: 'error';
      readonly httpStatus: 400 | 403 | 404 | 409 | 422 | 500;
      readonly body: ApplyReviewedPreviewErrorBody;
    };

function errorOutcome(
  httpStatus: 400 | 403 | 404 | 409 | 422 | 500,
  body: ApplyReviewedPreviewErrorBody
): ApplyReviewedPreviewOutcome {
  return { kind: 'error', httpStatus, body };
}

function staleWarningMessage(previewAgeMs: number): string {
  const minutes = Math.floor(previewAgeMs / (60 * 1000));
  if (minutes >= 60) {
    return `Preview is ${Math.round(minutes / 60)} hour(s) old.`;
  }
  return `Preview is ${minutes} minute(s) old.`;
}

function resolveEligibleSections(snapshot: SyncPreviewResult): SectionType[] {
  if (snapshot.sectionOutcomes.length === 0) {
    // Backward-compat fallback for snapshots created before section outcomes were persisted.
    return snapshot.failure ? [] : [...snapshot.sections];
  }

  const successful = new Set<SectionType>();
  for (const outcome of snapshot.sectionOutcomes) {
    if (outcome.failure === null && outcome.skipped === false) {
      successful.add(outcome.section);
    }
  }

  return snapshot.sections.filter((section) => successful.has(section));
}

function invalidationMessage(reason: SyncPreviewReviewInvalidationReason): string {
  switch (reason) {
    case 'pcd_drift':
      return 'Desired PCD data or reviewed configuration changed. Nothing was applied. Generate and review a new preview.';
    case 'arr_drift':
      return 'Live Arr configuration changed. Nothing was applied. Generate and review a new preview.';
    case 'pcd_and_arr_drift':
      return 'Desired PCD data and live Arr configuration changed. Nothing was applied. Generate and review a new preview.';
    case 'scope_drift':
      return 'The reviewed target or section scope changed. Nothing was applied. Generate and review a new preview.';
    case 'unverifiable_review':
      return 'The reviewed preview could not be verified safely. Nothing was applied. Generate and review a new preview.';
  }
}

function invalidatedResponse(
  reason: SyncPreviewReviewInvalidationReason,
  changedEvidence: readonly ('pcd' | 'arr')[],
  changedSections: readonly SectionType[],
  staleWarning: string | null
): SyncPreviewApplyInvalidatedResponse {
  return {
    error: invalidationMessage(reason),
    code: reason,
    changedEvidence: [...changedEvidence],
    changedSections: [...changedSections],
    regenerateRequired: true,
    staleWarning,
  };
}

type ApplySnapshotGate =
  | { readonly ok: true; readonly snapshot: SyncPreviewResult }
  | { readonly ok: false; readonly outcome: ApplyReviewedPreviewOutcome };

/**
 * Snapshot gates that run before any request body is read: existence, `ready` state, and no
 * generation failure. Exposed so the HTTP route keeps its historical check order (404/409 before
 * body validation); {@link applyReviewedPreview} re-runs it on the current snapshot.
 */
export function checkApplyPreviewSnapshot(previewId: string): ApplySnapshotGate {
  const snapshot = previewStore.get(previewId);
  if (!snapshot) {
    return { ok: false, outcome: errorOutcome(404, { error: 'Preview not found' }) };
  }

  if (snapshot.status !== PREVIEW_STATUS_READY) {
    return { ok: false, outcome: errorOutcome(409, { error: `Invalid preview state: ${snapshot.status}` }) };
  }

  // Any generation failure (hard fail, or the top-level `sectionErrors` aggregate set on a partial
  // `ready` preview) blocks apply. Per-section eligibility is enforced in applyReviewedPreview.
  if (snapshot.failure) {
    return {
      ok: false,
      outcome: errorOutcome(409, {
        error: 'Preview had section-generation errors. Regenerate preview before applying.',
      }),
    };
  }

  return { ok: true, snapshot };
}

/**
 * Apply selected sections from a stored reviewed preview.
 *
 * Rejects previews that are not ready, had generation errors, are stale/expired, or whose
 * reviewed evidence no longer matches. Executes through `executeReviewedSyncJob`, forwarding the
 * snapshot's server-owned drift link so the sync history row is linked to the drift event.
 */
export async function applyReviewedPreview(
  previewId: string,
  input: ApplyReviewedPreviewInput,
  dependencies: SyncPreviewApplyDependencies = DEFAULT_SYNC_PREVIEW_APPLY_DEPENDENCIES
): Promise<ApplyReviewedPreviewOutcome> {
  const gate = checkApplyPreviewSnapshot(previewId);
  if (!gate.ok) {
    return gate.outcome;
  }
  const snapshot = gate.snapshot;

  const eligibleSections = resolveEligibleSections(snapshot);
  const sectionsToApply = input.sections === undefined ? eligibleSections : input.sections;
  if (sectionsToApply.length === 0) {
    return errorOutcome(400, { error: 'No successfully previewed sections available to apply. Regenerate preview.' });
  }

  const unsupportedSections = sectionsToApply.filter((section) => !snapshot.sections.includes(section));
  if (unsupportedSections.length > 0) {
    return errorOutcome(400, { error: `Invalid sections for this preview: ${unsupportedSections.join(', ')}` });
  }

  const ineligibleSections = sectionsToApply.filter((section) => !eligibleSections.includes(section));
  if (ineligibleSections.length > 0) {
    return errorOutcome(409, {
      error: `Cannot apply sections with failed preview generation: ${ineligibleSections.join(', ')}`,
    });
  }

  const nowMs = dependencies.now();
  const staleness = evaluatePreviewStaleness(snapshot, nowMs);
  if (staleness.shouldBlock) {
    const failure = buildPreviewFailure('stale', snapshot.arrType);
    previewStore.updateResult(previewId, { status: PREVIEW_STATUS_FAILED, failure }, nowMs);
    return errorOutcome(422, { failure, staleWarning: staleWarningMessage(staleness.ageMs) });
  }

  const principal = input.principal;
  if (
    principal?.kind === 'token' &&
    sectionsIncludeManagedDelete(snapshot, sectionsToApply) &&
    !hasScope(principal.scopes, 'admin')
  ) {
    return errorOutcome(403, { error: 'Forbidden', requiredScope: 'admin' });
  }

  const inProgressSections = dependencies.getSectionsInProgress(snapshot.instanceId);
  const blockingSections = sectionsToApply.filter((section) => inProgressSections.includes(section));
  if (blockingSections.length > 0) {
    return errorOutcome(409, { error: `Cannot apply while sync is running for: ${blockingSections.join(', ')}` });
  }

  const claim = previewStore.claimReadyForApply(previewId, sectionsToApply, nowMs);
  if (!claim.ok) {
    if (claim.reason === 'not_found') {
      return errorOutcome(404, { error: 'Preview not found' });
    }
    if (claim.reason === 'invalid_state') {
      return errorOutcome(409, { error: `Invalid preview state: ${claim.status}` });
    }
    if (claim.reason === 'expired') {
      const failure = buildPreviewFailure('stale', snapshot.arrType);
      return errorOutcome(422, { failure, staleWarning: staleWarningMessage(staleness.ageMs) });
    }

    previewStore.transition(previewId, PREVIEW_STATUS_FAILED, nowMs);
    return errorOutcome(422, invalidatedResponse(claim.reason, [], sectionsToApply, null));
  }

  const staleWarning = staleness.shouldWarn ? staleWarningMessage(staleness.ageMs) : null;
  const driftLink = claim.snapshot.driftRemediation ?? null;
  try {
    const reviewedResult = await dependencies.executeReviewedSyncJob({
      binding: claim.binding,
      sections: claim.sections,
      previewId: claim.snapshot.id,
      expiresAt: claim.snapshot.expiresAt,
      source: input.source,
      ...(driftLink ? { driftLink } : {}),
    });

    if (reviewedResult.kind === 'claim_conflict') {
      previewStore.releaseApplyClaim(claim.receipt, dependencies.now());
      return errorOutcome(409, { error: 'Cannot apply while sync is running for one or more reviewed sections.' });
    }

    if (reviewedResult.kind === 'expired') {
      const failure = buildPreviewFailure('stale', snapshot.arrType);
      previewStore.completeApplyClaim(claim.receipt, { status: PREVIEW_STATUS_FAILED, failure }, dependencies.now());
      return errorOutcome(422, { failure, staleWarning });
    }

    if (reviewedResult.kind === 'invalidated') {
      const payload = invalidatedResponse(
        reviewedResult.reason,
        reviewedResult.changedEvidence,
        reviewedResult.changedSections,
        staleWarning
      );
      previewStore.completeApplyClaim(claim.receipt, { status: PREVIEW_STATUS_FAILED }, dependencies.now());
      return errorOutcome(422, payload);
    }

    const result = reviewedResult.result;
    const output = result.output ?? '';
    const success = result.status === 'success' || result.status === 'skipped';

    if (success) {
      previewStore.completeApplyClaim(claim.receipt, { status: PREVIEW_STATUS_APPLIED }, dependencies.now());
      return {
        kind: 'applied',
        httpStatus: 200,
        response: {
          success: true,
          results: {
            status: result.status,
            output,
          },
          staleWarning,
          outcomes: result.outcomes,
          syncHistoryId: result.syncHistoryId,
        },
      };
    }

    // The aggregate job error string is opaque and may carry raw Arr/exception text, so it is
    // never reclassified by substring nor transported. Surface a typed `executionFailed` reason;
    // the granular, already-sanitized per-entity `outcomes[].reason` (#232) carry the detail.
    const failure = buildPreviewFailure('executionFailed', snapshot.arrType);
    previewStore.completeApplyClaim(claim.receipt, { status: PREVIEW_STATUS_FAILED, failure }, dependencies.now());
    await logger.error('Sync preview apply run reported failure', {
      source: 'SyncPreviewApply',
      meta: {
        previewId,
        instanceId: snapshot.instanceId,
        status: result.status,
        failureCode: failure.code,
        jobFailureCode: result.status === 'failure' ? result.failureCode : null,
      },
    });
    // Surface confirmed outcomes on the failure branch too — partial/failed/skipped outcomes must
    // never be dropped just because the run's terminal status is failure (issue #232, Gap 5).
    return {
      kind: 'applied',
      httpStatus: 500,
      response: {
        success: false,
        results: {
          status: result.status,
          output,
          failure,
        },
        staleWarning,
        outcomes: result.outcomes,
        syncHistoryId: result.syncHistoryId,
      },
    };
  } catch (error) {
    // Classify by error TYPE only; the raw message stays out of the response and the stored
    // snapshot, and is recorded solely on the sanitized logger boundary below.
    const failure = classifyPreviewFailure(error, snapshot.arrType);
    previewStore.completeApplyClaim(claim.receipt, { status: PREVIEW_STATUS_FAILED, failure }, dependencies.now());
    await logger.error('Sync preview apply raised an unexpected error', {
      source: 'SyncPreviewApply',
      meta: {
        previewId,
        instanceId: snapshot.instanceId,
        failureCode: failure.code,
        error: error instanceof Error ? error.message : String(error),
      },
    });

    return errorOutcome(500, { failure, staleWarning });
  }
}
