import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { driftStatusQueries } from '$db/queries/driftStatus.ts';
import { isSyncPreviewArrType } from '$sync/preview/types.ts';
import { checkAndPersistInstance } from '$sync/drift/persist.ts';
import { DRIFT_REFRESH_RATE_LIMIT_WINDOW_MS, registerDriftRefreshAttempt } from '$sync/drift/limits.ts';
import { toDriftDetail } from '$sync/drift/responses.ts';
import { logger } from '$logger/logger.ts';

type ErrorResponse = { error: string };

function parseInstanceId(raw: string | undefined): number | null {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

/**
 * GET /api/v1/drift/{instanceId}
 *
 * Stored drift detail for one instance, grouped into drift / missing / unmanaged. Returns 404
 * only when the instance does not exist; degraded statuses are carried in the 200 body.
 */
export const GET: RequestHandler = async ({ params }) => {
  const instanceId = parseInstanceId(params.instanceId);
  if (instanceId === null) {
    return json({ error: 'Invalid instance id' } satisfies ErrorResponse, { status: 400 });
  }

  const instance = arrInstancesQueries.getById(instanceId);
  if (!instance) {
    return json({ error: 'Instance not found' } satisfies ErrorResponse, { status: 404 });
  }
  if (!isSyncPreviewArrType(instance.type)) {
    return json({ error: `Unsupported instance type: ${instance.type}` } satisfies ErrorResponse, { status: 400 });
  }

  try {
    const row = driftStatusQueries.getById(instanceId);
    return json(toDriftDetail(instance, row));
  } catch (error) {
    await logger.error('Failed to read drift detail', {
      source: 'DriftDetailRoute',
      meta: { instanceId, error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to read drift detail' } satisfies ErrorResponse, { status: 500 });
  }
};

/**
 * POST /api/v1/drift/{instanceId}
 *
 * Runs a fresh drift check on the request thread (not the scheduled queue), rate-limited per
 * instance, and returns the updated detail projected from the persisted row.
 */
export const POST: RequestHandler = async ({ params }) => {
  const instanceId = parseInstanceId(params.instanceId);
  if (instanceId === null) {
    return json({ error: 'Invalid instance id' } satisfies ErrorResponse, { status: 400 });
  }

  const instance = arrInstancesQueries.getById(instanceId);
  if (!instance) {
    return json({ error: 'Instance not found' } satisfies ErrorResponse, { status: 404 });
  }
  if (!isSyncPreviewArrType(instance.type)) {
    return json({ error: `Unsupported instance type: ${instance.type}` } satisfies ErrorResponse, { status: 400 });
  }
  if (!instance.enabled) {
    return json({ error: 'Instance is disabled' } satisfies ErrorResponse, { status: 400 });
  }

  if (!registerDriftRefreshAttempt(instanceId, Date.now())) {
    const windowSeconds = Math.floor(DRIFT_REFRESH_RATE_LIMIT_WINDOW_MS / 1000);
    return json({ error: 'Too many drift refresh requests for this instance' } satisfies ErrorResponse, {
      status: 429,
      headers: { 'Retry-After': String(windowSeconds) },
    });
  }

  const result = await checkAndPersistInstance(instance);
  if (!result) {
    return json({ error: 'A drift check for this instance is already in progress' } satisfies ErrorResponse, {
      status: 409,
    });
  }

  const row = driftStatusQueries.getById(instanceId);
  return json(toDriftDetail(instance, row));
};
