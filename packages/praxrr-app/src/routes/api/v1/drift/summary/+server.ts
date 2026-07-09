import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { driftSettingsQueries } from '$db/queries/driftSettings.ts';
import { driftStatusQueries } from '$db/queries/driftStatus.ts';
import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { isSyncPreviewArrType } from '$sync/preview/types.ts';
import { toDriftSettingsResponse, toInstanceSummary, type DriftInstanceSummary } from '$sync/drift/responses.ts';
import { logger } from '$logger/logger.ts';

type ErrorResponse = { error: string };

/**
 * GET /api/v1/drift/summary
 *
 * Latest drift status for every enabled, sync-capable Arr instance, plus aggregate totals and
 * settings. Degraded per-instance statuses are carried in the 200 body; this returns 500 only
 * on an internal error.
 */
export const GET: RequestHandler = async () => {
  try {
    const instances = arrInstancesQueries.getEnabled().filter((instance) => isSyncPreviewArrType(instance.type));

    const rowsById = new Map(driftStatusQueries.getAllForSummary().map((row) => [row.arrInstanceId, row]));

    const summaries: DriftInstanceSummary[] = instances.map((instance) =>
      toInstanceSummary(instance, rowsById.get(instance.id))
    );

    const totals = {
      instances: summaries.length,
      inSync: summaries.filter((summary) => summary.status === 'in-sync').length,
      drifted: summaries.filter((summary) => summary.status === 'drifted').length,
      unreachable: summaries.filter((summary) => summary.status === 'unreachable').length,
      unauthorized: summaries.filter((summary) => summary.status === 'unauthorized').length,
      error: summaries.filter((summary) => summary.status === 'error').length,
      neverChecked: summaries.filter((summary) => summary.status === 'never-checked').length,
    };

    const settings = driftSettingsQueries.get();
    const nextRunAt = settings.enabled === 1 ? (jobQueueQueries.getByDedupeKey('drift.check')?.runAt ?? null) : null;

    return json({
      generatedAt: new Date().toISOString(),
      settings: toDriftSettingsResponse(settings, nextRunAt),
      totals,
      instances: summaries,
    });
  } catch (error) {
    await logger.error('Failed to build drift summary', {
      source: 'DriftSummaryRoute',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to build drift summary' } satisfies ErrorResponse, { status: 500 });
  }
};
