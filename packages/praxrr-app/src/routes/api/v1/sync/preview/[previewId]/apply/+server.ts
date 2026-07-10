import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import { logger } from '$logger/logger.ts';
import { getSectionsInProgress, executeReviewedSyncJob } from '$lib/server/jobs/handlers/arrSync.ts';
import type { SectionType } from '$lib/server/sync/types.ts';
import { PREVIEW_REQUEST_BODY_LIMIT_BYTES } from '$lib/server/sync/preview/limits.ts';
import {
  previewStore,
  PREVIEW_STATUS_READY,
  PREVIEW_STATUS_APPLIED,
  PREVIEW_STATUS_FAILED,
  evaluatePreviewStaleness,
} from '$lib/server/sync/preview/store.ts';
import { buildPreviewFailure, classifyPreviewFailure } from '$lib/server/sync/preview/failureReason.ts';
import type { SyncPreviewResult, SyncPreviewReviewInvalidationReason } from '$lib/server/sync/preview/types.ts';

type ErrorResponse = components['schemas']['ErrorResponse'];
type SyncPreviewApplyResponse = components['schemas']['SyncPreviewApplyResponse'];
type SyncPreviewApplyErrorResponse = components['schemas']['SyncPreviewApplyErrorResponse'];
type SyncPreviewApplyInvalidatedResponse = components['schemas']['SyncPreviewApplyInvalidatedResponse'];

export interface SyncPreviewApplyDependencies {
  readonly getSectionsInProgress: typeof getSectionsInProgress;
  readonly executeReviewedSyncJob: typeof executeReviewedSyncJob;
  readonly now: () => number;
}

const DEFAULT_DEPENDENCIES: SyncPreviewApplyDependencies = {
  getSectionsInProgress,
  executeReviewedSyncJob,
  now: Date.now,
};

const textEncoder = new TextEncoder();

function parseSections(raw: unknown): SectionType[] | null | undefined {
  if (raw === undefined) {
    return undefined;
  }

  if (!Array.isArray(raw)) {
    return null;
  }

  const sections: SectionType[] = [];
  for (const value of raw) {
    if (
      value === 'qualityProfiles' ||
      value === 'delayProfiles' ||
      value === 'mediaManagement' ||
      value === 'metadataProfiles'
    ) {
      if (!sections.includes(value)) {
        sections.push(value);
      }
    } else {
      return null;
    }
  }

  return sections.length > 0 ? sections : [];
}

function staleWarningMessage(previewAgeMs: number): string {
  const minutes = Math.floor(previewAgeMs / (60 * 1000));
  if (minutes >= 60) {
    return `Preview is ${Math.round(minutes / 60)} hour(s) old.`;
  }
  return `Preview is ${minutes} minute(s) old.`;
}

function getBodyByteLength(rawBody: string): number {
  return textEncoder.encode(rawBody).length;
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

/**
 * POST /api/v1/sync/preview/{previewId}/apply
 *
 * Apply selected sections from a generated preview to the target Arr instance.
 * The request is rejected if the preview is not ready, stale, expired, or invalid for application.
 *
 * Body:
 * - sections: optional explicit list of sections to apply. Defaults to eligible preview sections.
 */
export async function _handleSyncPreviewApplyRequest(
  previewId: string | undefined,
  request: Request,
  dependencies: SyncPreviewApplyDependencies = DEFAULT_DEPENDENCIES
): Promise<Response> {
  if (!previewId) {
    return json({ error: 'previewId is required' } satisfies ErrorResponse, { status: 400 });
  }

  const snapshot = previewStore.get(previewId);
  if (!snapshot) {
    return json({ error: 'Preview not found' } satisfies ErrorResponse, { status: 404 });
  }

  if (snapshot.status !== PREVIEW_STATUS_READY) {
    return json({ error: `Invalid preview state: ${snapshot.status}` } satisfies ErrorResponse, { status: 409 });
  }

  // Any generation failure (hard fail, or the top-level `sectionErrors` aggregate set on a partial
  // `ready` preview) blocks apply — mirrors the prior top-level error gate. Per-section eligibility
  // is enforced separately below via resolveEligibleSections.
  if (snapshot.failure) {
    return json(
      { error: 'Preview had section-generation errors. Regenerate preview before applying.' } satisfies ErrorResponse,
      { status: 409 }
    );
  }

  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const parsedLength = Number.parseInt(contentLength, 10);
    if (Number.isInteger(parsedLength) && parsedLength > PREVIEW_REQUEST_BODY_LIMIT_BYTES) {
      return json({ error: `Request body exceeds ${PREVIEW_REQUEST_BODY_LIMIT_BYTES} bytes` } satisfies ErrorResponse, {
        status: 400,
      });
    }
  }

  let requestBody: { sections?: unknown };
  try {
    const rawBody = await request.text();
    if (getBodyByteLength(rawBody) > PREVIEW_REQUEST_BODY_LIMIT_BYTES) {
      return json({ error: `Request body exceeds ${PREVIEW_REQUEST_BODY_LIMIT_BYTES} bytes` } satisfies ErrorResponse, {
        status: 400,
      });
    }

    if (rawBody.trim().length === 0) {
      requestBody = {};
    } else {
      requestBody = JSON.parse(rawBody) as { sections?: unknown };
    }
  } catch {
    return json({ error: 'Invalid JSON body' } satisfies ErrorResponse, { status: 400 });
  }

  const requestedSections = parseSections(requestBody.sections);
  if (requestedSections === null) {
    return json({ error: 'sections must be an array of valid sync sections' } satisfies ErrorResponse, { status: 400 });
  }

  const eligibleSections = resolveEligibleSections(snapshot);
  const sectionsToApply = requestedSections === undefined ? eligibleSections : requestedSections;
  if (sectionsToApply.length === 0) {
    return json(
      { error: 'No successfully previewed sections available to apply. Regenerate preview.' } satisfies ErrorResponse,
      { status: 400 }
    );
  }

  const unsupportedSections = sectionsToApply.filter((section) => !snapshot.sections.includes(section));
  if (unsupportedSections.length > 0) {
    return json(
      { error: `Invalid sections for this preview: ${unsupportedSections.join(', ')}` } satisfies ErrorResponse,
      { status: 400 }
    );
  }

  const ineligibleSections = sectionsToApply.filter((section) => !eligibleSections.includes(section));
  if (ineligibleSections.length > 0) {
    return json(
      {
        error: `Cannot apply sections with failed preview generation: ${ineligibleSections.join(', ')}`,
      } satisfies ErrorResponse,
      { status: 409 }
    );
  }

  const nowMs = dependencies.now();
  const staleness = evaluatePreviewStaleness(snapshot, nowMs);
  if (staleness.shouldBlock) {
    const failure = buildPreviewFailure('stale', snapshot.arrType);
    previewStore.updateResult(previewId, { status: PREVIEW_STATUS_FAILED, failure }, nowMs);
    return json(
      {
        failure,
        staleWarning: staleWarningMessage(staleness.ageMs),
      } satisfies SyncPreviewApplyErrorResponse,
      { status: 422 }
    );
  }

  const inProgressSections = dependencies.getSectionsInProgress(snapshot.instanceId);
  const blockingSections = sectionsToApply.filter((section) => inProgressSections.includes(section));
  if (blockingSections.length > 0) {
    return json(
      { error: `Cannot apply while sync is running for: ${blockingSections.join(', ')}` } satisfies ErrorResponse,
      { status: 409 }
    );
  }

  const claim = previewStore.claimReadyForApply(previewId, sectionsToApply, nowMs);
  if (!claim.ok) {
    if (claim.reason === 'not_found') {
      return json({ error: 'Preview not found' } satisfies ErrorResponse, { status: 404 });
    }
    if (claim.reason === 'invalid_state') {
      return json({ error: `Invalid preview state: ${claim.status}` } satisfies ErrorResponse, { status: 409 });
    }
    if (claim.reason === 'expired') {
      const failure = buildPreviewFailure('stale', snapshot.arrType);
      return json(
        {
          failure,
          staleWarning: staleWarningMessage(staleness.ageMs),
        } satisfies SyncPreviewApplyErrorResponse,
        { status: 422 }
      );
    }

    previewStore.transition(previewId, PREVIEW_STATUS_FAILED, nowMs);
    return json(invalidatedResponse(claim.reason, [], sectionsToApply, null), { status: 422 });
  }

  const staleWarning = staleness.shouldWarn ? staleWarningMessage(staleness.ageMs) : null;
  try {
    const reviewedResult = await dependencies.executeReviewedSyncJob({
      binding: claim.binding,
      sections: claim.sections,
      previewId: claim.snapshot.id,
      expiresAt: claim.snapshot.expiresAt,
      source: 'manual',
    });

    if (reviewedResult.kind === 'claim_conflict') {
      previewStore.releaseApplyClaim(claim.receipt, dependencies.now());
      return json(
        { error: 'Cannot apply while sync is running for one or more reviewed sections.' } satisfies ErrorResponse,
        { status: 409 }
      );
    }

    if (reviewedResult.kind === 'expired') {
      const failure = buildPreviewFailure('stale', snapshot.arrType);
      previewStore.completeApplyClaim(claim.receipt, { status: PREVIEW_STATUS_FAILED, failure }, dependencies.now());
      return json(
        {
          failure,
          staleWarning,
        } satisfies SyncPreviewApplyErrorResponse,
        { status: 422 }
      );
    }

    if (reviewedResult.kind === 'invalidated') {
      const payload = invalidatedResponse(
        reviewedResult.reason,
        reviewedResult.changedEvidence,
        reviewedResult.changedSections,
        staleWarning
      );
      previewStore.completeApplyClaim(claim.receipt, { status: PREVIEW_STATUS_FAILED }, dependencies.now());
      return json(payload, { status: 422 });
    }

    const result = reviewedResult.result;
    const output = result.output ?? '';
    const success = result.status === 'success' || result.status === 'skipped';

    if (success) {
      previewStore.completeApplyClaim(claim.receipt, { status: PREVIEW_STATUS_APPLIED }, dependencies.now());
      return json({
        success: true,
        results: {
          status: result.status,
          output,
        },
        staleWarning,
        outcomes: result.outcomes,
        syncHistoryId: result.syncHistoryId,
      } satisfies SyncPreviewApplyResponse);
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
    return json(
      {
        success: false,
        results: {
          status: result.status,
          output,
          failure,
        },
        staleWarning,
        outcomes: result.outcomes,
        syncHistoryId: result.syncHistoryId,
      } satisfies SyncPreviewApplyResponse,
      { status: 500 }
    );
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

    return json(
      {
        failure,
        staleWarning,
      } satisfies SyncPreviewApplyErrorResponse,
      { status: 500 }
    );
  }
}

export const POST: RequestHandler = ({ params, request }) => _handleSyncPreviewApplyRequest(params.previewId, request);
