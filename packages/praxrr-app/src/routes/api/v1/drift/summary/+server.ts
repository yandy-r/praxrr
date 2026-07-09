import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { driftSettingsQueries } from '$db/queries/driftSettings.ts';
import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { buildDriftSummary } from '$sync/drift/summary.ts';
import { toDriftSettingsResponse } from '$sync/drift/responses.ts';
import { logger } from '$logger/logger.ts';

type ErrorResponse = { error: string };

/**
 * GET /api/v1/drift/summary
 *
 * Latest drift status for every enabled, sync-capable Arr instance, plus aggregate totals and
 * settings. The per-instance rollup + totals come from the shared buildDriftSummary() (also used by
 * the MCP server); the scheduler settings/nextRunAt block stays here. Degraded per-instance statuses
 * are carried in the 200 body; this returns 500 only on an internal error.
 */
export const GET: RequestHandler = async () => {
  try {
    const core = buildDriftSummary();

    const settings = driftSettingsQueries.get();
    const nextRunAt = settings.enabled === 1 ? (jobQueueQueries.getByDedupeKey('drift.check')?.runAt ?? null) : null;

    return json({
      generatedAt: core.generatedAt,
      settings: toDriftSettingsResponse(settings, nextRunAt),
      totals: core.totals,
      instances: core.instances,
    });
  } catch (error) {
    await logger.error('Failed to build drift summary', {
      source: 'DriftSummaryRoute',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to build drift summary' } satisfies ErrorResponse, { status: 500 });
  }
};
