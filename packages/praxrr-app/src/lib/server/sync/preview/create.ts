/**
 * Reviewed sync preview creation core.
 *
 * Shared by `POST /api/v1/sync/preview`, the drift reconcile endpoint and the
 * `drift.remediate` job so every reviewed preview is generated, bound and stored the same way.
 * HTTP parsing (body caps, JSON, section/config validation) stays in the route; this core
 * receives already-typed input and returns a discriminated outcome the callers map.
 */

import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { type ArrInstanceReviewClient, getArrInstanceReviewClient } from '$arr/arrInstanceClients.ts';
import { logger } from '$logger/logger.ts';
import { isPluginsEnabled, pluginHost } from '$server/plugins/index.ts';
import { buildCapabilityInput } from '$server/plugins/hostContext.ts';
import { uuid } from '$shared/utils/uuid.ts';
import type { DriftRemediationLink } from '$sync/drift/types.ts';
import type { SectionType } from '$sync/types.ts';
import {
  generatePreview,
  type GeneratePreviewInput,
  type GeneratePreviewReviewOptions,
  type GeneratePreviewWithReviewContextResult,
} from './orchestrator.ts';
import { buildPreviewFailure, classifyPreviewFailure } from './failureReason.ts';
import { buildSyncPreviewReviewBinding, syncPreviewReviewTarget } from './reviewBinding.ts';
import {
  PREVIEW_CREATE_RATE_LIMIT_MAX_REQUESTS,
  PREVIEW_CREATE_RATE_LIMIT_WINDOW_MS,
  PREVIEW_MAX_SNAPSHOTS,
  registerPreviewCreateAttempt,
} from './limits.ts';
import { PREVIEW_STATUS_FAILED, PREVIEW_STATUS_GENERATING, previewStore } from './store.ts';
import { isSyncPreviewArrType, type SyncPreviewResult, type SyncPreviewSummary } from './types.ts';

/**
 * Injectable dependencies for preview creation. Defaults call through dynamically so tests that
 * reassign `arrInstancesQueries.getById` keep working.
 */
export interface SyncPreviewCreateDependencies {
  readonly generatePreview: (
    input: GeneratePreviewInput,
    options: GeneratePreviewReviewOptions
  ) => Promise<GeneratePreviewWithReviewContextResult>;
  readonly getInstanceById: typeof arrInstancesQueries.getById;
  readonly getReviewClient: typeof getArrInstanceReviewClient;
  readonly now: () => number;
}

export const DEFAULT_SYNC_PREVIEW_CREATE_DEPENDENCIES: SyncPreviewCreateDependencies = {
  generatePreview,
  getInstanceById: (id: number) => arrInstancesQueries.getById(id),
  getReviewClient: getArrInstanceReviewClient,
  now: Date.now,
};

export interface CreateReviewedPreviewInput {
  readonly instanceId: number;
  /** Ordered, validated sections; empty/undefined previews every configured section. */
  readonly sections?: SectionType[];
  readonly sectionConfigs?: Partial<Record<SectionType, unknown>>;
  /** Server-owned drift link; only the drift reconcile route and auto job may set it. */
  readonly driftRemediation?: DriftRemediationLink;
}

export type CreateReviewedPreviewOutcome =
  /** Stored `ready` snapshot (reviewed, or non-applicable when nothing could be compared). */
  | { readonly kind: 'ok'; readonly preview: SyncPreviewResult }
  /** Stored `failed` snapshot with a typed, safe failure (HTTP 500 shape). */
  | { readonly kind: 'failed'; readonly preview: SyncPreviewResult }
  /** Nothing usable was stored; `status` is the HTTP status the route returns. */
  | { readonly kind: 'rejected'; readonly status: 400 | 404 | 429 | 500; readonly error: string };

function createInitialSummary(): SyncPreviewSummary {
  return {
    totalCreates: 0,
    totalUpdates: 0,
    totalDeletes: 0,
    totalUnchanged: 0,
  };
}

const PERSIST_FAILURE: CreateReviewedPreviewOutcome = {
  kind: 'rejected',
  status: 500,
  error: 'Failed to persist preview result',
};

/**
 * Generate, review-bind and store a sync preview for one Arr instance.
 *
 * Never performs Arr writes. Instance gates (missing/unsupported/disabled), store capacity and
 * the per-instance rate limit are enforced here so every caller shares them.
 */
export async function createReviewedPreview(
  input: CreateReviewedPreviewInput,
  dependencies: SyncPreviewCreateDependencies = DEFAULT_SYNC_PREVIEW_CREATE_DEPENDENCIES
): Promise<CreateReviewedPreviewOutcome> {
  const instance = dependencies.getInstanceById(input.instanceId);
  if (!instance) {
    return { kind: 'rejected', status: 404, error: 'Instance not found' };
  }

  if (!isSyncPreviewArrType(instance.type)) {
    return { kind: 'rejected', status: 400, error: `Unsupported instance type: ${instance.type}` };
  }

  if (!instance.enabled) {
    return { kind: 'rejected', status: 400, error: 'Instance is disabled' };
  }

  if (input.driftRemediation && input.driftRemediation.instanceId !== instance.id) {
    return { kind: 'rejected', status: 400, error: 'Drift remediation link does not match the instance' };
  }

  const arrType = instance.type;
  const nowMs = dependencies.now();
  previewStore.cleanup(nowMs);
  if (previewStore.getSize() >= PREVIEW_MAX_SNAPSHOTS) {
    return {
      kind: 'rejected',
      status: 429,
      error: `Preview store is at capacity (${PREVIEW_MAX_SNAPSHOTS}). Retry after previews expire.`,
    };
  }

  if (!registerPreviewCreateAttempt(input.instanceId, nowMs)) {
    const windowSeconds = Math.floor(PREVIEW_CREATE_RATE_LIMIT_WINDOW_MS / 1000);
    return {
      kind: 'rejected',
      status: 429,
      error: `Too many preview requests. Limit is ${PREVIEW_CREATE_RATE_LIMIT_MAX_REQUESTS} per ${windowSeconds} seconds.`,
    };
  }

  let storedPreview = previewStore.create(
    {
      id: `preview_${input.instanceId}_${Date.now()}_${uuid()}`,
      instanceId: input.instanceId,
      instanceName: instance.name,
      arrType,
      status: PREVIEW_STATUS_GENERATING,
      failure: null,
      sections: input.sections ?? [],
      sectionOutcomes: [],
      qualityProfiles: null,
      delayProfiles: null,
      mediaManagement: null,
      metadataProfiles: null,
      summary: createInitialSummary(),
      driftRemediation: input.driftRemediation ?? null,
    },
    nowMs
  );

  await logger.info('Generating sync preview', {
    source: 'SyncPreview',
    meta: {
      previewId: storedPreview.id,
      instanceId: input.instanceId,
      instanceName: instance.name,
      instanceType: instance.type,
      driftRemediationTrigger: input.driftRemediation?.trigger ?? null,
    },
  });

  const requestedSections = input.sections?.length ? input.sections : undefined;

  let reviewClient: ArrInstanceReviewClient | null = null;
  try {
    reviewClient = await dependencies.getReviewClient(instance.type, instance);
    const { preview: generated, reviewContext } = await dependencies.generatePreview(
      {
        instance,
        sections: requestedSections,
        sectionConfigs: input.sectionConfigs,
        nowMs,
      },
      { captureReviewContext: true, client: reviewClient.client }
    );

    if (isPluginsEnabled()) {
      try {
        await pluginHost.notifyObservers('sync.previewComputed.observe', () =>
          buildCapabilityInput('read:sync-preview', generated)
        );
      } catch (error) {
        await logger.warn('sync.previewComputed.observe dispatch failed at call-site', {
          source: 'Plugins',
          meta: { previewId: storedPreview.id, instanceId: input.instanceId, error: String(error) },
        });
      }
    }

    // Preserve successful-section evidence: a partial generation stays `ready` (successful
    // sections keep their diffs) but carries a typed top-level `sectionErrors` reason so apply
    // requires a clean regenerate — mirroring the prior top-level error-count gate, without raw text.
    const hasFailedSection = generated.sectionOutcomes.some((outcome) => outcome.failure !== null);
    const topLevelFailure = hasFailedSection ? buildPreviewFailure('sectionErrors', arrType) : null;

    const eligibleSections = generated.sections.filter((section) =>
      generated.sectionOutcomes.some(
        (outcome) => outcome.section === section && outcome.failure === null && !outcome.skipped
      )
    );
    const generationPatch = {
      sections: generated.sections,
      sectionOutcomes: generated.sectionOutcomes,
      qualityProfiles: generated.qualityProfiles,
      delayProfiles: generated.delayProfiles,
      mediaManagement: generated.mediaManagement,
      metadataProfiles: generated.metadataProfiles,
      summary: generated.summary,
      failure: topLevelFailure,
      instanceName: generated.instanceName,
    };

    if (eligibleSections.length === 0 && hasFailedSection) {
      const failedPreview = previewStore.updateResult(storedPreview.id, {
        ...generationPatch,
        status: PREVIEW_STATUS_FAILED,
      });
      return failedPreview ? { kind: 'failed', preview: failedPreview } : PERSIST_FAILURE;
    }

    let completed: SyncPreviewResult | null;
    if (eligibleSections.length === 0) {
      completed = previewStore.completeNonApplicableGeneration(storedPreview.id, generationPatch);
    } else {
      const binding = await buildSyncPreviewReviewBinding({
        instanceId: generated.instanceId,
        arrType: generated.arrType,
        target: syncPreviewReviewTarget(instance, reviewClient.credentialIdentity),
        sections: eligibleSections,
        sectionConfigs: reviewContext.sectionConfigs,
        evidence: reviewContext.evidence,
      });

      completed = previewStore.completeGeneration(storedPreview.id, generationPatch, binding);
    }

    if (!completed) {
      return PERSIST_FAILURE;
    }
    storedPreview = completed;
    return { kind: 'ok', preview: storedPreview };
  } catch (error) {
    // Classify by error TYPE only; the raw message never reaches the response or the
    // stored snapshot — it is recorded solely on the sanitized logger boundary below.
    const failure = classifyPreviewFailure(error, arrType);

    const failedPreview = previewStore.updateResult(storedPreview.id, {
      status: PREVIEW_STATUS_FAILED,
      failure,
    });

    await logger.error('Failed to generate sync preview', {
      source: 'SyncPreview',
      meta: {
        previewId: storedPreview.id,
        instanceId: input.instanceId,
        instanceName: instance.name,
        failureCode: failure.code,
        error: error instanceof Error ? error.message : String(error),
      },
    });

    // The failed snapshot (status 'failed' + typed, safe failure) — never raw text.
    return {
      kind: 'failed',
      preview: failedPreview ?? { ...storedPreview, status: PREVIEW_STATUS_FAILED, failure },
    };
  } finally {
    reviewClient?.client.close();
  }
}
