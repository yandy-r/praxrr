import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import type { AuthPrincipal } from '$auth/principal.ts';
import type { SectionType } from '$lib/server/sync/types.ts';
import { PREVIEW_REQUEST_BODY_LIMIT_BYTES } from '$lib/server/sync/preview/limits.ts';
import {
  applyReviewedPreview,
  type ApplyReviewedPreviewOutcome,
  checkApplyPreviewSnapshot,
  DEFAULT_SYNC_PREVIEW_APPLY_DEPENDENCIES,
  type SyncPreviewApplyDependencies,
} from '$lib/server/sync/preview/apply.ts';

export type { SyncPreviewApplyDependencies };

type ErrorResponse = components['schemas']['ErrorResponse'];

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

function getBodyByteLength(rawBody: string): number {
  return textEncoder.encode(rawBody).length;
}

function outcomeResponse(outcome: ApplyReviewedPreviewOutcome): Response {
  if (outcome.kind === 'applied') {
    return json(outcome.response, { status: outcome.httpStatus });
  }
  return json(outcome.body, { status: outcome.httpStatus });
}

/**
 * POST /api/v1/sync/preview/{previewId}/apply
 *
 * Apply selected sections from a generated preview to the target Arr instance.
 * The request is rejected if the preview is not ready, stale, expired, or invalid for application.
 * A drift-tagged preview (from the drift reconcile endpoint) records its server-owned drift link
 * on the resulting sync history row; the link is never read from this request body.
 *
 * Body:
 * - sections: optional explicit list of sections to apply. Defaults to eligible preview sections.
 */
export async function _handleSyncPreviewApplyRequest(
  previewId: string | undefined,
  request: Request,
  dependencies: SyncPreviewApplyDependencies = DEFAULT_SYNC_PREVIEW_APPLY_DEPENDENCIES,
  principal: AuthPrincipal | null = null
): Promise<Response> {
  if (!previewId) {
    return json({ error: 'previewId is required' } satisfies ErrorResponse, { status: 400 });
  }

  // Snapshot gates (404 / not-ready / generation errors) precede body validation.
  const gate = checkApplyPreviewSnapshot(previewId);
  if (!gate.ok) {
    return outcomeResponse(gate.outcome);
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

  const outcome = await applyReviewedPreview(
    previewId,
    { sections: requestedSections, source: 'manual', principal },
    dependencies
  );
  return outcomeResponse(outcome);
}

function principalFromLocals(locals: object | null | undefined): AuthPrincipal | null {
  if (locals == null || !('principal' in locals)) return null;
  const principal = (locals as { principal?: AuthPrincipal | null }).principal;
  return principal ?? null;
}

export const POST: RequestHandler = ({ params, request, locals }) =>
  _handleSyncPreviewApplyRequest(
    params.previewId,
    request,
    DEFAULT_SYNC_PREVIEW_APPLY_DEPENDENCIES,
    principalFromLocals(locals)
  );
