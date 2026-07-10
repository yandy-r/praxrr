import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import { ConfigHealthTrendQueryError, parseConfigHealthTrendFilters } from '$lib/server/health/trendFilters.ts';
import { ConfigHealthTrendServiceError, readConfigHealthTrend } from '$lib/server/health/trends.ts';
import { toTrendsResponse } from '$lib/server/health/responses.ts';
import { logger } from '$logger/logger.ts';

type ErrorResponse = components['schemas']['ErrorResponse'];
type TrendsResponse = components['schemas']['ConfigHealthTrendsResponse'];

function parseInstanceId(raw: string | undefined): number | null {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** GET one canonical, bounded Config Health historical selection. */
export const GET: RequestHandler = async ({ params, url }) => {
  const instanceId = parseInstanceId(params.instanceId);
  if (instanceId === null) {
    return json({ error: 'Invalid instance id' } satisfies ErrorResponse, { status: 400 });
  }

  try {
    const filters = parseConfigHealthTrendFilters(url);
    const result = readConfigHealthTrend(instanceId, filters);
    return json(toTrendsResponse(result) satisfies TrendsResponse);
  } catch (error) {
    if (error instanceof ConfigHealthTrendQueryError || error instanceof ConfigHealthTrendServiceError) {
      return json({ error: error.message } satisfies ErrorResponse, { status: error.status });
    }

    await logger.error('Failed to read config health trends', {
      source: 'ConfigHealthTrendsRoute',
      meta: { instanceId, errorType: error instanceof Error ? error.name : 'UnknownError' },
    });
    return json({ error: 'Failed to read config health trends' } satisfies ErrorResponse, { status: 500 });
  }
};
