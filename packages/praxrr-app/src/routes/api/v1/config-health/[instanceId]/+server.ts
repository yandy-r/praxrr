import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { isSyncPreviewArrType } from '$sync/preview/types.ts';
import { scoreInstance } from '$lib/server/health/service.ts';
import { toDetailResponse } from '$lib/server/health/responses.ts';
import { parseConfigHealthInstanceId } from '$lib/server/health/pathParams.ts';
import { logger } from '$logger/logger.ts';
import type { components } from '$api/v1.d.ts';

type ErrorResponse = { error: string };
type DetailResponse = components['schemas']['ConfigHealthDetailResponse'];

/**
 * GET /api/v1/config-health/{instanceId}
 *
 * Live overall health plus a per-quality-profile breakdown with per-criterion contributions and
 * suggestions. 404 only when the instance is unknown; degraded states are carried in the 200 body.
 */
export const GET: RequestHandler = async ({ params }) => {
  const instanceId = parseConfigHealthInstanceId(params.instanceId);
  if (instanceId === null) {
    return json({ error: 'Invalid instance id' } satisfies ErrorResponse, { status: 400 });
  }

  const instance = arrInstancesQueries.getById(instanceId);
  // 404 covers both "unknown" and "not sync-capable" (per the OpenAPI contract).
  if (!instance || !isSyncPreviewArrType(instance.type)) {
    return json({ error: 'Instance not found or not sync-capable' } satisfies ErrorResponse, { status: 404 });
  }

  try {
    const report = await scoreInstance(instanceId);
    if (!report) {
      return json({ error: 'Instance not found' } satisfies ErrorResponse, { status: 404 });
    }
    return json(toDetailResponse(report) satisfies DetailResponse);
  } catch (error) {
    await logger.error('Failed to build config health detail', {
      source: 'ConfigHealthDetailRoute',
      meta: { instanceId, error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to build config health detail' } satisfies ErrorResponse, { status: 500 });
  }
};
