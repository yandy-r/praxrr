import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { logger } from '$logger/logger.ts';
import { proceedRollout } from '$sync/canary/coordinator.ts';
import {
  isCanaryNotFoundError,
  isCanaryPreviewUnavailableError,
  isCanaryStaleTokenError,
  isCanaryStateError,
} from '$sync/canary/errors.ts';

const POSITIVE_INTEGER_ID = /^\d+$/;
const MAX_BODY_BYTES = 8 * 1024;

function parsePositiveInteger(rawId: string | undefined, fieldName: string): { value: number } | { error: string } {
  if (!rawId) {
    return { error: `Missing ${fieldName}` };
  }

  if (!POSITIVE_INTEGER_ID.test(rawId)) {
    return { error: `Invalid ${fieldName}` };
  }

  const id = Number.parseInt(rawId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return { error: `Invalid ${fieldName}` };
  }

  return { value: id };
}

/**
 * POST /api/v1/canary/rollouts/{id}/proceed
 *
 * Confirm the verification gate (issue #19): transition the rollout from
 * `awaiting_confirmation` to `rolling_out` and enqueue the resumable rollout job. The body
 * must carry the `stateToken` shown at the gate as a value-guard; a stale token (the gate
 * was refreshed or already actioned) is rejected 422 and the caller must refresh and retry.
 * Unavailable or invalid remaining-preview evidence is rejected 409 without enqueueing.
 */
export const POST: RequestHandler = async ({ params, request }) => {
  const idResult = parsePositiveInteger(params.id, 'id');
  if ('error' in idResult) {
    return json({ error: idResult.error }, { status: 400 });
  }

  // Reject oversized bodies via Content-Length before buffering; the post-read check below
  // still guards the case where the header is absent or understates the actual size.
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json({ error: 'Request body too large' }, { status: 400 });
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return json({ error: 'Request body too large' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = rawBody.length > 0 ? JSON.parse(rawBody) : {};
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const stateToken = (body as { stateToken?: unknown }).stateToken;
  if (typeof stateToken !== 'string' || stateToken.length === 0) {
    return json({ error: 'Missing or invalid stateToken' }, { status: 400 });
  }

  try {
    const rollout = proceedRollout(idResult.value, stateToken);
    return json(rollout);
  } catch (error) {
    if (isCanaryNotFoundError(error)) {
      return json({ error: error.message }, { status: 404 });
    }
    if (isCanaryStateError(error)) {
      return json({ error: error.message }, { status: 409 });
    }
    if (isCanaryPreviewUnavailableError(error)) {
      return json({ error: error.failure.message }, { status: 409 });
    }
    if (isCanaryStaleTokenError(error)) {
      return json({ error: error.message }, { status: 422 });
    }

    await logger.error('Failed to proceed canary rollout', {
      source: 'CanaryProceedRoute',
      meta: {
        rolloutId: idResult.value,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return json({ error: 'Failed to proceed canary rollout' }, { status: 500 });
  }
};
