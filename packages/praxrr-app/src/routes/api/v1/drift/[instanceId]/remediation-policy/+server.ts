import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import { arrInstancesQueries, type ArrInstance } from '$db/queries/arrInstances.ts';
import { driftRemediationPolicyQueries } from '$db/queries/driftRemediationPolicy.ts';
import { publishDriftRowUpdated } from '$lib/server/events/publish.ts';
import { logger } from '$logger/logger.ts';
import type { DriftRemediationMode, DriftRemediationPolicy } from '$sync/drift/types.ts';
import { getUnsupportedSyncSectionReason } from '$sync/mappings.ts';
import { PREVIEW_REQUEST_BODY_LIMIT_BYTES } from '$sync/preview/limits.ts';
import { isSyncPreviewArrType, type SyncPreviewArrType, type SyncPreviewSection } from '$sync/preview/types.ts';

type ErrorResponse = components['schemas']['ErrorResponse'];
type DriftRemediationPolicyResponse = components['schemas']['DriftRemediationPolicy'];

const MODES: readonly DriftRemediationMode[] = ['off', 'notify', 'auto'];
const SECTIONS: readonly SyncPreviewSection[] = [
  'qualityProfiles',
  'delayProfiles',
  'mediaManagement',
  'metadataProfiles',
];
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

type ResolvedInstance =
  { ok: true; instance: ArrInstance; arrType: SyncPreviewArrType } | { ok: false; response: Response };

function resolveInstance(rawId: string | undefined): ResolvedInstance {
  const instanceId = parseInstanceId(rawId);
  if (instanceId === null) {
    return { ok: false, response: errorResponse('Invalid instance id', 400) };
  }
  const instance = arrInstancesQueries.getById(instanceId);
  if (!instance) {
    return { ok: false, response: errorResponse('Instance not found', 404) };
  }
  if (!isSyncPreviewArrType(instance.type)) {
    return { ok: false, response: errorResponse(`Unsupported instance type: ${instance.type}`, 400) };
  }
  return { ok: true, instance, arrType: instance.type };
}

async function readJsonBody(
  request: Request
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const tooLarge = `Request body exceeds ${PREVIEW_REQUEST_BODY_LIMIT_BYTES} bytes`;
  const contentLength = Number.parseInt(request.headers.get('content-length') ?? '', 10);
  if (Number.isInteger(contentLength) && contentLength > PREVIEW_REQUEST_BODY_LIMIT_BYTES) {
    return { ok: false, response: errorResponse(tooLarge, 400) };
  }
  const raw = await request.text();
  if (textEncoder.encode(raw).length > PREVIEW_REQUEST_BODY_LIMIT_BYTES) {
    return { ok: false, response: errorResponse(tooLarge, 400) };
  }
  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, response: errorResponse('Invalid JSON body', 400) };
  }
}

type ValidatedUpdate =
  { ok: true; mode: DriftRemediationMode; allowedSections: SyncPreviewSection[] } | { ok: false; error: string };

/**
 * Validate a policy update against the instance's OWN `arr_type`: every section must be a known
 * sync section supported for that app (no sibling fallback), duplicates are rejected, and `auto`
 * requires a non-empty section list.
 */
export function _validatePolicyUpdate(body: unknown, arrType: SyncPreviewArrType): ValidatedUpdate {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be an object' };
  }
  const { mode, allowedSections } = body as Record<string, unknown>;

  if (typeof mode !== 'string' || !MODES.includes(mode as DriftRemediationMode)) {
    return { ok: false, error: `mode must be one of: ${MODES.join(', ')}` };
  }
  if (!Array.isArray(allowedSections)) {
    return { ok: false, error: 'allowedSections must be an array' };
  }

  const sections: SyncPreviewSection[] = [];
  for (const value of allowedSections) {
    if (typeof value !== 'string' || !SECTIONS.includes(value as SyncPreviewSection)) {
      return { ok: false, error: `Unknown section: ${String(value)}` };
    }
    const section = value as SyncPreviewSection;
    if (sections.includes(section)) {
      return { ok: false, error: `Duplicate section: ${section}` };
    }
    const unsupported = getUnsupportedSyncSectionReason(arrType, section);
    if (unsupported) {
      return { ok: false, error: unsupported };
    }
    sections.push(section);
  }

  if (mode === 'auto' && sections.length === 0) {
    return { ok: false, error: 'auto mode requires at least one allowed section' };
  }

  return { ok: true, mode: mode as DriftRemediationMode, allowedSections: sections };
}

function toResponse(policy: DriftRemediationPolicy): DriftRemediationPolicyResponse {
  return {
    instanceId: policy.instanceId,
    arrType: policy.arrType,
    mode: policy.mode,
    allowedSections: [...policy.allowedSections],
    updatedAt: policy.updatedAt,
  };
}

/**
 * GET /api/v1/drift/{instanceId}/remediation-policy
 *
 * The instance's auto-remediation policy; synthesizes the `off` default when none is stored.
 */
export const GET: RequestHandler = async ({ params }) => {
  const resolved = resolveInstance(params.instanceId);
  if (!resolved.ok) {
    return resolved.response;
  }

  try {
    return json(toResponse(driftRemediationPolicyQueries.get(resolved.instance.id, resolved.arrType)));
  } catch (error) {
    await logger.error('Failed to read drift remediation policy', {
      source: 'DriftRemediationPolicyRoute',
      meta: { instanceId: resolved.instance.id, error: error instanceof Error ? error.message : String(error) },
    });
    return errorResponse('Failed to read drift remediation policy', 500);
  }
};

/**
 * PUT /api/v1/drift/{instanceId}/remediation-policy
 *
 * Replace the instance's auto-remediation policy (admin scope: fail-closed default). Sections are
 * validated against the instance's own `arr_type`; `auto` requires a non-empty section list.
 */
export const PUT: RequestHandler = async ({ params, request }) => {
  const resolved = resolveInstance(params.instanceId);
  if (!resolved.ok) {
    return resolved.response;
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return parsed.response;
  }

  const update = _validatePolicyUpdate(parsed.body, resolved.arrType);
  if (!update.ok) {
    return errorResponse(update.error, 400);
  }

  try {
    const policy = driftRemediationPolicyQueries.upsert({
      instanceId: resolved.instance.id,
      arrType: resolved.arrType,
      mode: update.mode,
      allowedSections: update.allowedSections,
    });
    publishDriftRowUpdated(resolved.instance.id);
    return json(toResponse(policy));
  } catch (error) {
    await logger.error('Failed to update drift remediation policy', {
      source: 'DriftRemediationPolicyRoute',
      meta: { instanceId: resolved.instance.id, error: error instanceof Error ? error.message : String(error) },
    });
    return errorResponse('Failed to update drift remediation policy', 500);
  }
};
