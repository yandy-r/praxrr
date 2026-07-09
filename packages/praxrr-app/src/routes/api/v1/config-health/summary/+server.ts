import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { scoreFleet } from '$lib/server/health/service.ts';
import { toSummaryResponse } from '$lib/server/health/responses.ts';
import { configHealthSettingsQueries } from '$db/queries/configHealthSettings.ts';
import { logger } from '$logger/logger.ts';
import type { components } from '$api/v1.d.ts';

type ErrorResponse = { error: string };
type SummaryResponse = components['schemas']['ConfigHealthSummaryResponse'];

/**
 * GET /api/v1/config-health/summary
 *
 * Live per-instance overall health for every enabled, sync-capable instance, plus aggregate totals
 * and a settings snapshot. Degraded / never-checked states are carried in the 200 body (per-instance
 * band); this returns 500 only on an internal error.
 */
export const GET: RequestHandler = async () => {
  try {
    const reports = await scoreFleet();
    const settings = configHealthSettingsQueries.get();
    const payload = toSummaryResponse(reports, settings, new Date().toISOString());
    return json(payload satisfies SummaryResponse);
  } catch (error) {
    await logger.error('Failed to build config health summary', {
      source: 'ConfigHealthSummaryRoute',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to build config health summary' } satisfies ErrorResponse, { status: 500 });
  }
};
