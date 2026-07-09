import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { canarySettingsQueries } from '$db/queries/canarySettings.ts';
import type { CanarySettingsUpdate } from '$db/queries/canarySettings.ts';
import type { CanaryPartialPolicy } from '$sync/canary/types.ts';
import { logger } from '$logger/logger.ts';

const MAX_BODY_BYTES = 8 * 1024;
const PARTIAL_POLICIES: readonly CanaryPartialPolicy[] = ['gate', 'abort'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/**
 * Build a validated `CanarySettingsUpdate` patch from the request body. All fields are
 * optional; `defaultMaxBatchSize` must be an integer >= 1 (rejected, never clamped).
 */
function parseSettingsPatch(body: Record<string, unknown>): { patch: CanarySettingsUpdate } | { error: string } {
  const patch: CanarySettingsUpdate = {};

  if ('enabled' in body) {
    if (typeof body.enabled !== 'boolean') {
      return { error: 'enabled must be a boolean' };
    }
    patch.enabled = body.enabled;
  }

  if ('autoSelect' in body) {
    if (typeof body.autoSelect !== 'boolean') {
      return { error: 'autoSelect must be a boolean' };
    }
    patch.autoSelect = body.autoSelect;
  }

  if ('defaultMaxBatchSize' in body) {
    if (!isPositiveInteger(body.defaultMaxBatchSize)) {
      return { error: 'defaultMaxBatchSize must be an integer >= 1' };
    }
    patch.defaultMaxBatchSize = body.defaultMaxBatchSize;
  }

  if ('defaultPartialPolicy' in body) {
    if (!PARTIAL_POLICIES.includes(body.defaultPartialPolicy as CanaryPartialPolicy)) {
      return { error: "defaultPartialPolicy must be 'gate' or 'abort'" };
    }
    patch.defaultPartialPolicy = body.defaultPartialPolicy as CanaryPartialPolicy;
  }

  if ('defaultCanaryInstanceId' in body) {
    const raw = body.defaultCanaryInstanceId;
    if (raw !== null && !isPositiveInteger(raw)) {
      return { error: 'defaultCanaryInstanceId must be a positive integer or null' };
    }
    patch.defaultCanaryInstanceId = raw as number | null;
  }

  return { patch };
}

/**
 * GET /api/v1/canary/settings
 *
 * Return the canary settings singleton (id = 1), self-healing the seed row if absent.
 */
export const GET: RequestHandler = async () => {
  try {
    return json(canarySettingsQueries.get());
  } catch (error) {
    await logger.error('Failed to read canary settings', {
      source: 'CanarySettingsRoute',
      meta: {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return json({ error: 'Failed to read canary settings' }, { status: 500 });
  }
};

/**
 * PATCH /api/v1/canary/settings
 *
 * Apply a partial update to the canary settings singleton and return the fresh row.
 * `defaultMaxBatchSize` is validated as an integer >= 1 (400, never clamped).
 */
export const PATCH: RequestHandler = async ({ request }) => {
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

  if (!isRecord(body)) {
    return json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = parseSettingsPatch(body);
  if ('error' in parsed) {
    return json({ error: parsed.error }, { status: 400 });
  }

  try {
    return json(canarySettingsQueries.update(parsed.patch));
  } catch (error) {
    await logger.error('Failed to update canary settings', {
      source: 'CanarySettingsRoute',
      meta: {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return json({ error: 'Failed to update canary settings' }, { status: 500 });
  }
};
