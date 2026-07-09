import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { isSyncPreviewArrType } from '$sync/preview/types.ts';
import { configHealthSnapshotsQueries } from '$db/queries/configHealthSnapshots.ts';
import { toTrendsResponse } from '$lib/server/health/responses.ts';
import { logger } from '$logger/logger.ts';
import type { components } from '$api/v1.d.ts';

type ErrorResponse = { error: string };
type TrendsResponse = components['schemas']['ConfigHealthTrendsResponse'];

function parseInstanceId(raw: string | undefined): number | null {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

/**
 * GET /api/v1/config-health/{instanceId}/trends?days=N
 *
 * Persisted overall-score/band time series for one instance (oldest → newest) for the sparkline,
 * optionally bounded to the last N days.
 */
export const GET: RequestHandler = async ({ params, url }) => {
  const instanceId = parseInstanceId(params.instanceId);
  if (instanceId === null) {
    return json({ error: 'Invalid instance id' } satisfies ErrorResponse, { status: 400 });
  }

  let days: number | undefined;
  const rawDays = url.searchParams.get('days');
  if (rawDays !== null) {
    const parsed = Number(rawDays);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return json({ error: 'Invalid days parameter' } satisfies ErrorResponse, { status: 400 });
    }
    days = parsed;
  }

  const instance = arrInstancesQueries.getById(instanceId);
  if (!instance) {
    return json({ error: 'Instance not found' } satisfies ErrorResponse, { status: 404 });
  }
  if (!isSyncPreviewArrType(instance.type)) {
    return json({ error: `Unsupported instance type: ${instance.type}` } satisfies ErrorResponse, { status: 400 });
  }

  try {
    const snapshots = configHealthSnapshotsQueries.getTrend(instanceId, days);
    return json(toTrendsResponse(instanceId, snapshots) satisfies TrendsResponse);
  } catch (error) {
    await logger.error('Failed to read config health trends', {
      source: 'ConfigHealthTrendsRoute',
      meta: { instanceId, error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to read config health trends' } satisfies ErrorResponse, { status: 500 });
  }
};
