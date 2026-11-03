import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import { driftStatusQueries } from '$db/queries/driftStatus.ts';
import { logger } from '$logger/logger.ts';
import { resolveReconcilableSections } from '$sync/drift/responses.ts';
import type { DriftRemediationLink } from '$sync/drift/types.ts';
import {
  createReviewedPreview,
  DEFAULT_SYNC_PREVIEW_CREATE_DEPENDENCIES,
  type SyncPreviewCreateDependencies,
} from '$sync/preview/create.ts';
import { PREVIEW_REQUEST_BODY_LIMIT_BYTES } from '$sync/preview/limits.ts';
import { isSyncPreviewArrType, type SyncPreviewSection } from '$sync/preview/types.ts';
import { SYNC_SECTION_ORDER } from '$sync/mappings.ts';

type ErrorResponse = components['schemas']['ErrorResponse'];

const textEncoder = new TextEncoder();

function parseInstanceId(raw: string | undefined): number | null {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

function errorResponse(error: string, status: number): Response {
  return json({ error } satisfies ErrorResponse, { status });
}

/** Read an optional JSON body under the preview byte cap. Empty body ⇒ `{}`. */
async function readBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const tooLarge = `Request body exceeds ${PREVIEW_REQUEST_BODY_LIMIT_BYTES} bytes`;
  const contentLength = Number.parseInt(request.headers.get('content-length') ?? '', 10);
  if (Number.isInteger(contentLength) && contentLength > PREVIEW_REQUEST_BODY_LIMIT_BYTES) {
    return { ok: false, response: errorResponse(tooLarge, 400) };
  }

  const rawBody = await request.text();
  if (textEncoder.encode(rawBody).length > PREVIEW_REQUEST_BODY_LIMIT_BYTES) {
    return { ok: false, response: errorResponse(tooLarge, 400) };
  }
  if (rawBody.trim().length === 0) {
    return { ok: true, body: {} };
  }
  try {
    return { ok: true, body: JSON.parse(rawBody) };
  } catch {
    return { ok: false, response: errorResponse('Invalid JSON body', 400) };
  }
}

/**
 * Parse the optional `sections` narrowing. Returns the de-duplicated request list, `undefined`
 * when absent, or an error message. Unknown keys (e.g. a client `driftRemediation`) are ignored.
 */
function parseRequestedSections(body: unknown): SyncPreviewSection[] | undefined | string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Request body must be an object';
  }
  if (!('sections' in body) || body.sections === undefined) {
    return undefined;
  }
  const raw = body.sections;
  if (!Array.isArray(raw) || raw.length === 0) {
    return 'sections must be a non-empty array when provided';
  }
  const known = new Set<string>(SYNC_SECTION_ORDER);
  const sections: SyncPreviewSection[] = [];
  for (const value of raw) {
    if (typeof value !== 'string' || !known.has(value)) {
      return `Invalid section: ${String(value)}`;
    }
    const section = value as SyncPreviewSection;
    if (!sections.includes(section)) {
      sections.push(section);
    }
  }
  return sections;
}

/**
 * POST /api/v1/drift/{instanceId}/reconcile
 *
 * Builds a drift-tagged reviewed preview limited to the instance's drifted sections: sections with
 * drift/missing changes in the stored row ∩ configured ∩ version-available. The optional `sections`
 * body narrows that set and never widens it. The preview carries a server-owned
 * `driftRemediation` link; applying it through `POST /sync/preview/{id}/apply` records linked
 * sync history. Dry run — no Arr writes.
 */
export async function _handleDriftReconcileRequest(
  rawInstanceId: string | undefined,
  request: Request,
  dependencies: SyncPreviewCreateDependencies = DEFAULT_SYNC_PREVIEW_CREATE_DEPENDENCIES
): Promise<Response> {
  const instanceId = parseInstanceId(rawInstanceId);
  if (instanceId === null) {
    return errorResponse('Invalid instance id', 400);
  }

  const instance = dependencies.getInstanceById(instanceId);
  if (!instance) {
    return errorResponse('Instance not found', 404);
  }
  if (!isSyncPreviewArrType(instance.type)) {
    return errorResponse(`Unsupported instance type: ${instance.type}`, 400);
  }
  if (!instance.enabled) {
    return errorResponse('Instance is disabled', 400);
  }

  const parsedBody = await readBody(request);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }
  const requestedSections = parseRequestedSections(parsedBody.body);
  if (typeof requestedSections === 'string') {
    return errorResponse(requestedSections, 400);
  }

  try {
    const row = driftStatusQueries.getById(instanceId);
    if (!row || row.status !== 'drifted' || row.driftSignature === null) {
      return errorResponse('Instance is not drifted; nothing to reconcile', 409);
    }
    if (row.contentCheckedAt === null) {
      return errorResponse('Stored drift content is stale; refresh the drift check before reconciling', 409);
    }
    // Cross-Arr guard: the stored row must describe this instance's Arr type exactly.
    if (row.arrType !== instance.type) {
      return errorResponse('Stored drift content does not match the instance type; refresh the drift check', 409);
    }

    const reconcilable = resolveReconcilableSections(instance, row);
    if (reconcilable.length === 0) {
      return errorResponse('No drifted sections are configured and available to reconcile', 409);
    }

    let sections = reconcilable;
    if (requestedSections !== undefined) {
      const notDrifted = requestedSections.filter((section) => !reconcilable.includes(section));
      if (notDrifted.length > 0) {
        return errorResponse(`Sections are not drifted or not reconcilable: ${notDrifted.join(', ')}`, 400);
      }
      // Keep canonical sync order; the request only removes sections.
      sections = reconcilable.filter((section) => requestedSections.includes(section));
    }

    const link: DriftRemediationLink = {
      instanceId: instance.id,
      driftSignature: row.driftSignature,
      driftDetectedAt: row.driftDetectedAt,
      trigger: 'reconcile',
    };

    const outcome = await createReviewedPreview(
      { instanceId: instance.id, sections: [...sections], driftRemediation: link },
      dependencies
    );
    switch (outcome.kind) {
      case 'ok':
        return json(outcome.preview);
      case 'failed':
        return json(outcome.preview, { status: 500 });
      case 'rejected':
        return errorResponse(outcome.error, outcome.status);
    }
  } catch (error) {
    await logger.error('Failed to create drift reconcile preview', {
      source: 'DriftReconcileRoute',
      meta: { instanceId, error: error instanceof Error ? error.message : String(error) },
    });
    return errorResponse('Failed to create reconcile preview', 500);
  }
}

export const POST: RequestHandler = ({ params, request }) => _handleDriftReconcileRequest(params.instanceId, request);
