import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import { ConfigHealthTrendQueryError, parseConfigHealthTrendFilters } from '$lib/server/health/trendFilters.ts';
import { ConfigHealthTrendServiceError, readConfigHealthTrend } from '$lib/server/health/trends.ts';
import { toConfigHealthTrendCsv } from '$lib/server/health/trendCsv.ts';
import { toTrendsResponse } from '$lib/server/health/responses.ts';
import { parseConfigHealthInstanceId } from '$lib/server/health/pathParams.ts';
import { logger } from '$logger/logger.ts';

type ErrorResponse = components['schemas']['ErrorResponse'];
type TrendsResponse = components['schemas']['ConfigHealthTrendsResponse'];
type ExportFormat = 'json' | 'csv';

function attachmentHeaders(instanceId: number, format: ExportFormat): Record<string, string> {
  const timestamp = Date.now();
  return {
    'Content-Disposition': `attachment; filename="config-health-${instanceId}-trends-${timestamp}.${format}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

/** GET the same canonical selection as a lossless JSON or fixed-row CSV attachment. */
export const GET: RequestHandler = async ({ params, url }) => {
  const instanceId = parseConfigHealthInstanceId(params.instanceId);
  if (instanceId === null) {
    return json({ error: 'Invalid instance id' } satisfies ErrorResponse, { status: 400 });
  }

  const formatParam = url.searchParams.get('format');
  if (formatParam !== null && formatParam !== 'json' && formatParam !== 'csv') {
    return json({ error: "format must be 'json' or 'csv'" } satisfies ErrorResponse, { status: 400 });
  }
  const format: ExportFormat = formatParam === 'csv' ? 'csv' : 'json';

  try {
    const filters = parseConfigHealthTrendFilters(url);
    const result = readConfigHealthTrend(instanceId, filters);
    const headers = attachmentHeaders(instanceId, format);

    if (format === 'csv') {
      return new Response(toConfigHealthTrendCsv(result), {
        headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' },
      });
    }

    const response = toTrendsResponse(result) satisfies TrendsResponse;
    return new Response(JSON.stringify(response), {
      headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (error) {
    if (error instanceof ConfigHealthTrendQueryError || error instanceof ConfigHealthTrendServiceError) {
      return json({ error: error.message } satisfies ErrorResponse, { status: error.status });
    }

    await logger.error('Failed to export config health trends', {
      source: 'ConfigHealthTrendsExportRoute',
      meta: { instanceId, format, errorType: error instanceof Error ? error.name : 'UnknownError' },
    });
    return json({ error: 'Failed to export config health trends' } satisfies ErrorResponse, { status: 500 });
  }
};
