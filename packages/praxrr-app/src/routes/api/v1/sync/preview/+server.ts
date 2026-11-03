import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { parseMediaManagementPreviewConfig, parseNamedProfilePreviewConfig } from '$sync/preview/sectionConfigs.ts';
import { SYNC_SECTION_ORDER } from '$sync/mappings.ts';
import { PREVIEW_REQUEST_BODY_LIMIT_BYTES } from '$sync/preview/limits.ts';
import {
  createReviewedPreview,
  type CreateReviewedPreviewOutcome,
  DEFAULT_SYNC_PREVIEW_CREATE_DEPENDENCIES,
  type SyncPreviewCreateDependencies,
} from '$sync/preview/create.ts';
import type { SectionType } from '$sync/types.ts';

export type { SyncPreviewCreateDependencies };

type ErrorResponse = {
  error: string;
};

const textEncoder = new TextEncoder();

type CreateRequestBody = {
  instanceId: number;
  sections?: unknown;
  sectionConfigs?: unknown;
};

type CreatePreviewRequest = {
  instanceId: number;
  sections: SectionType[] | undefined;
  sectionConfigs?: Partial<Record<SectionType, unknown>>;
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

    const section = rawSection as SectionType;
    if (section === 'delayProfiles' || section === 'metadataProfiles') {
      const config = parseNamedProfilePreviewConfig(rawConfig);
      if (!config) throw new Error(`Invalid ${section} section config`);
      parsed[section] = config;
    } else if (section === 'mediaManagement') {
      const config = parseMediaManagementPreviewConfig(rawConfig);
      if (!config) throw new Error('Invalid mediaManagement section config');
      parsed[section] = config;
    } else {
      parsed[section] = rawConfig;
    }
  }

  return parsed;
}

/**
 * Parse the public create body. Only `instanceId`, `sections` and `sectionConfigs` are read; any
 * other key — notably a client-supplied `driftRemediation` — is ignored, because the drift link
 * is server-owned (set only by the drift reconcile endpoint and the auto-remediation job).
 */
function parseCreateRequest(body: unknown): CreatePreviewRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Request body must be an object');
  }

  const { instanceId, sections, sectionConfigs } = body as CreateRequestBody;
  if (typeof instanceId !== 'number' || !Number.isInteger(instanceId) || instanceId <= 0) {
    throw new Error('instanceId is required');
  }

  return {
    instanceId,
    sections: parseSectionOrderValue(sections),
    sectionConfigs: parseSectionConfigs(sectionConfigs),
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

/** Map a {@link createReviewedPreview} outcome to its HTTP response (shared contract). */
function outcomeResponse(outcome: CreateReviewedPreviewOutcome): Response {
  switch (outcome.kind) {
    case 'ok':
      return json(outcome.preview);
    case 'failed':
      return json(outcome.preview, { status: 500 });
    case 'rejected':
      return json({ error: outcome.error } satisfies ErrorResponse, { status: outcome.status });
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
  dependencies: SyncPreviewCreateDependencies = DEFAULT_SYNC_PREVIEW_CREATE_DEPENDENCIES
): Promise<Response> {
  const requestBody = await parseRequestBody(request);
  if (!requestBody.ok) {
    return requestBody.response;
  }

  let requestPayload: CreatePreviewRequest;
  try {
    requestPayload = parseCreateRequest(requestBody.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request body';
    return json({ error: message } satisfies ErrorResponse, { status: 400 });
  }

  const outcome = await createReviewedPreview(
    {
      instanceId: requestPayload.instanceId,
      sections: requestPayload.sections,
      sectionConfigs: requestPayload.sectionConfigs,
    },
    dependencies
  );
  return outcomeResponse(outcome);
}

export const POST: RequestHandler = ({ request }) => _handleSyncPreviewCreateRequest(request);
