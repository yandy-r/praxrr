import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { logger } from '$logger/logger.ts';
import { previewStore } from '$sync/preview/store.ts';
import { PREVIEW_STATUS_FAILED, PREVIEW_STATUS_GENERATING } from '$sync/preview/store.ts';
import {
  generatePreview,
  type GeneratePreviewInput,
  type GeneratePreviewReviewOptions,
  type GeneratePreviewWithReviewContextResult,
} from '$sync/preview/orchestrator.ts';
import { buildPreviewFailure, classifyPreviewFailure } from '$sync/preview/failureReason.ts';
import { buildSyncPreviewReviewBinding } from '$sync/preview/reviewBinding.ts';
import { SYNC_SECTION_ORDER } from '$sync/mappings.ts';
import {
  PREVIEW_CREATE_RATE_LIMIT_MAX_REQUESTS,
  PREVIEW_CREATE_RATE_LIMIT_WINDOW_MS,
  PREVIEW_MAX_SNAPSHOTS,
  PREVIEW_REQUEST_BODY_LIMIT_BYTES,
  registerPreviewCreateAttempt,
} from '$sync/preview/limits.ts';
import type { SectionType } from '$sync/types.ts';
import type { SyncPreviewArrType, SyncPreviewResult, SyncPreviewSummary } from '$sync/preview/types.ts';
import { isSyncPreviewArrType } from '$sync/preview/types.ts';
import { uuid } from '$shared/utils/uuid.ts';

type ErrorResponse = {
  error: string;
};

const textEncoder = new TextEncoder();

type CreateRequestBody = {
  instanceId: number;
  sections?: unknown;
  sectionConfigs?: unknown;
};

type CreatePreviewResult = {
  previewId: string;
  instanceId: number;
  instanceName: string;
  arrType: SyncPreviewArrType;
  sections: SectionType[] | undefined;
  sectionConfigs?: Partial<Record<SectionType, unknown>>;
};

/**
 * Injectable dependencies for the create handler. Mirrors the apply route's DI pattern so
 * tests can force secret-shaped / free-form generation failures without monkeypatching an
 * immutable ESM binding. Defaults call through dynamically so the existing tests that
 * reassign `arrInstancesQueries.getById` keep working.
 */
export interface SyncPreviewCreateDependencies {
  readonly generatePreview: (
    input: GeneratePreviewInput,
    options: GeneratePreviewReviewOptions
  ) => Promise<GeneratePreviewWithReviewContextResult>;
  readonly getInstanceById: typeof arrInstancesQueries.getById;
  readonly now: () => number;
}

const DEFAULT_CREATE_DEPENDENCIES: SyncPreviewCreateDependencies = {
  generatePreview,
  getInstanceById: (id: number) => arrInstancesQueries.getById(id),
  now: Date.now,
};

function parseSectionOrderValue(rawSections: unknown): SectionType[] | undefined {
  if (rawSections === undefined) {
    return undefined;
  }

  if (!Array.isArray(rawSections)) {
    throw new Error('sections must be an array when provided');
  }

  const validSections = new Set<SectionType>(SYNC_SECTION_ORDER);
  const nextSections: SectionType[] = [];
  const seen = new Set<SectionType>();

  for (const rawSection of rawSections) {
    if (typeof rawSection !== 'string') {
      throw new Error(`Invalid section value: ${String(rawSection)}`);
    }

    if (!validSections.has(rawSection as SectionType)) {
      throw new Error(`Invalid section: ${rawSection}`);
    }

    const section = rawSection as SectionType;
    if (seen.has(section)) {
      continue;
    }

    seen.add(section);
    nextSections.push(section);
  }

  return nextSections;
}

function parseSectionConfigs(rawSectionConfigs: unknown): Partial<Record<SectionType, unknown>> | undefined {
  if (rawSectionConfigs === undefined) {
    return undefined;
  }

  if (rawSectionConfigs === null || typeof rawSectionConfigs !== 'object' || Array.isArray(rawSectionConfigs)) {
    throw new Error('sectionConfigs must be an object when provided');
  }

  const validSections = new Set<SectionType>(SYNC_SECTION_ORDER);
  const sectionConfigMap: Record<string, unknown> = rawSectionConfigs as Record<string, unknown>;
  const parsed: Partial<Record<SectionType, unknown>> = {};

  for (const [rawSection, rawConfig] of Object.entries(sectionConfigMap)) {
    if (!validSections.has(rawSection as SectionType)) {
      throw new Error(`Invalid section config key: ${rawSection}`);
    }

    parsed[rawSection as SectionType] = rawConfig;
  }

  return parsed;
}

function parseCreateRequest(body: unknown): CreatePreviewResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Request body must be an object');
  }

  const { instanceId, sections, sectionConfigs } = body as CreateRequestBody;
  if (typeof instanceId !== 'number' || !Number.isInteger(instanceId) || instanceId <= 0) {
    throw new Error('instanceId is required');
  }

  return {
    previewId: `preview_${instanceId}_${Date.now()}_${uuid()}`,
    instanceId,
    instanceName: '',
    arrType: 'radarr',
    sections: parseSectionOrderValue(sections),
    sectionConfigs: parseSectionConfigs(sectionConfigs),
  };
}

function createInitialSummary(): SyncPreviewSummary {
  return {
    totalCreates: 0,
    totalUpdates: 0,
    totalDeletes: 0,
    totalUnchanged: 0,
  };
}

function createInitialPreview(request: CreatePreviewResult): SyncPreviewResult {
  return {
    id: request.previewId,
    instanceId: request.instanceId,
    instanceName: request.instanceName,
    arrType: request.arrType,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    status: PREVIEW_STATUS_GENERATING,
    failure: null,
    sections: request.sections ?? [],
    sectionOutcomes: [],
    qualityProfiles: null,
    delayProfiles: null,
    mediaManagement: null,
    metadataProfiles: null,
    summary: createInitialSummary(),
  };
}

function getBodyByteLength(rawBody: string): number {
  return textEncoder.encode(rawBody).length;
}

async function parseRequestBody(
  request: Request
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const parsedLength = Number.parseInt(contentLength, 10);
    if (Number.isInteger(parsedLength) && parsedLength > PREVIEW_REQUEST_BODY_LIMIT_BYTES) {
      return {
        ok: false,
        response: json(
          {
            error: `Request body exceeds ${PREVIEW_REQUEST_BODY_LIMIT_BYTES} bytes`,
          } satisfies ErrorResponse,
          { status: 400 }
        ),
      };
    }
  }

  const rawBody = await request.text();
  if (getBodyByteLength(rawBody) > PREVIEW_REQUEST_BODY_LIMIT_BYTES) {
    return {
      ok: false,
      response: json(
        {
          error: `Request body exceeds ${PREVIEW_REQUEST_BODY_LIMIT_BYTES} bytes`,
        } satisfies ErrorResponse,
        { status: 400 }
      ),
    };
  }

  try {
    return {
      ok: true,
      body: JSON.parse(rawBody),
    };
  } catch {
    return {
      ok: false,
      response: json({ error: 'Invalid JSON body' } satisfies ErrorResponse, { status: 400 }),
    };
  }
}

/**
 * POST /api/v1/sync/preview
 *
 * Generate a sync preview for a selected Arr instance.
 * Accepts optional section selection and section-specific config overrides.
 *
 * Body:
 * - instanceId: Arr instance ID (required)
 * - sections: optional ordered list of sync sections to preview
 * - sectionConfigs: optional config overrides per section
 */
export async function _handleSyncPreviewCreateRequest(
  request: Request,
  dependencies: SyncPreviewCreateDependencies = DEFAULT_CREATE_DEPENDENCIES
): Promise<Response> {
  const requestBody = await parseRequestBody(request);
  if (!requestBody.ok) {
    return requestBody.response;
  }

  let requestPayload: CreatePreviewResult;
  try {
    requestPayload = parseCreateRequest(requestBody.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request body';
    return json({ error: message } satisfies ErrorResponse, { status: 400 });
  }

  const instance = dependencies.getInstanceById(requestPayload.instanceId);
  if (!instance) {
    return json({ error: 'Instance not found' } satisfies ErrorResponse, { status: 404 });
  }

  if (!isSyncPreviewArrType(instance.type)) {
    return json({ error: `Unsupported instance type: ${instance.type}` } satisfies ErrorResponse, { status: 400 });
  }

  if (!instance.enabled) {
    return json({ error: 'Instance is disabled' } satisfies ErrorResponse, { status: 400 });
  }

  const nowMs = dependencies.now();
  previewStore.cleanup(nowMs);
  if (previewStore.getSize() >= PREVIEW_MAX_SNAPSHOTS) {
    return json(
      {
        error: `Preview store is at capacity (${PREVIEW_MAX_SNAPSHOTS}). Retry after previews expire.`,
      } satisfies ErrorResponse,
      { status: 429 }
    );
  }

  const isRateLimited = !registerPreviewCreateAttempt(requestPayload.instanceId, nowMs);
  if (isRateLimited) {
    const windowSeconds = Math.floor(PREVIEW_CREATE_RATE_LIMIT_WINDOW_MS / 1000);
    return json(
      {
        error: `Too many preview requests. Limit is ${PREVIEW_CREATE_RATE_LIMIT_MAX_REQUESTS} per ${windowSeconds} seconds.`,
      } satisfies ErrorResponse,
      { status: 429 }
    );
  }

  requestPayload = {
    ...requestPayload,
    instanceName: instance.name,
    arrType: instance.type,
  };

  const initialPreview = createInitialPreview(requestPayload);
  let storedPreview = previewStore.create(initialPreview, nowMs);

  await logger.info('Generating sync preview', {
    source: 'SyncPreview',
    meta: {
      previewId: storedPreview.id,
      instanceId: requestPayload.instanceId,
      instanceName: requestPayload.instanceName,
      instanceType: instance.type,
    },
  });

  const requestedSections = requestPayload.sections?.length ? requestPayload.sections : undefined;

  try {
    const { preview: generated, reviewContext } = await dependencies.generatePreview(
      {
        instance,
        sections: requestedSections,
        sectionConfigs: requestPayload.sectionConfigs,
        nowMs,
      },
      { captureReviewContext: true }
    );

    // Preserve successful-section evidence: a partial generation stays `ready` (successful
    // sections keep their diffs) but carries a typed top-level `sectionErrors` reason so apply
    // requires a clean regenerate — mirroring the prior top-level error-count gate, without raw text.
    const hasFailedSection = generated.sectionOutcomes.some((outcome) => outcome.failure !== null);
    const topLevelFailure = hasFailedSection ? buildPreviewFailure('sectionErrors', requestPayload.arrType) : null;

    const eligibleSections = generated.sections.filter((section) =>
      generated.sectionOutcomes.some(
        (outcome) => outcome.section === section && outcome.failure === null && !outcome.skipped
      )
    );
    const binding = await buildSyncPreviewReviewBinding({
      instanceId: generated.instanceId,
      arrType: generated.arrType,
      sections: eligibleSections,
      sectionConfigs: reviewContext.sectionConfigs,
      evidence: reviewContext.evidence,
    });

    storedPreview = previewStore.completeGeneration(
      storedPreview.id,
      {
        sections: generated.sections,
        sectionOutcomes: generated.sectionOutcomes,
        qualityProfiles: generated.qualityProfiles,
        delayProfiles: generated.delayProfiles,
        mediaManagement: generated.mediaManagement,
        metadataProfiles: generated.metadataProfiles,
        summary: generated.summary,
        failure: topLevelFailure,
        instanceName: generated.instanceName,
      },
      binding
    )!;

    if (!storedPreview) {
      return json({ error: 'Failed to persist preview result' } satisfies ErrorResponse, { status: 500 });
    }

    return json(storedPreview);
  } catch (error) {
    // Classify by error TYPE only; the raw message never reaches the response or the
    // stored snapshot — it is recorded solely on the sanitized logger boundary below.
    const failure = classifyPreviewFailure(error, requestPayload.arrType);

    const failedPreview = previewStore.updateResult(storedPreview.id, {
      status: PREVIEW_STATUS_FAILED,
      failure,
    });

    await logger.error('Failed to generate sync preview', {
      source: 'SyncPreview',
      meta: {
        previewId: storedPreview.id,
        instanceId: requestPayload.instanceId,
        instanceName: requestPayload.instanceName,
        failureCode: failure.code,
        error: error instanceof Error ? error.message : String(error),
      },
    });

    // Return the failed snapshot (status 'failed' + typed, safe failure) — never raw text.
    return json(failedPreview ?? { ...storedPreview, status: PREVIEW_STATUS_FAILED, failure }, { status: 500 });
  }
}

export const POST: RequestHandler = ({ request }) => _handleSyncPreviewCreateRequest(request);
