import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { startupPullQueries } from '$db/queries/startupPull.ts';
import { logger } from '$logger/logger.ts';

type ErrorResponse = {
  error: string;
};

/**
 * GET /api/v1/system/startup-pull/latest
 *
 * Returns the latest startup pull run with per-instance outcomes.
 * Returns 404 when no runs exist.
 */
export const GET: RequestHandler = async () => {
  try {
    const summary = startupPullQueries.getLatestWithOutcomes();
    if (!summary) {
      return json({ error: 'No startup pull runs found' } satisfies ErrorResponse, { status: 404 });
    }

    return json({
      id: summary.id,
      status: summary.status,
      startedAt: summary.startedAt,
      finishedAt: summary.finishedAt,
      imported: summary.imported,
      skippedDefault: summary.skippedDefault,
      skippedNoMatch: summary.skippedNoMatch,
      conflicted: summary.conflicted,
      failed: summary.failed,
      instancesTotal: summary.instancesTotal,
      instancesFailed: summary.instancesFailed,
      createdAt: summary.createdAt,
      instances: summary.instances.map((instance) => ({
        id: instance.id,
        instanceId: instance.instanceId,
        instanceName: instance.instanceName,
        arrType: instance.arrType,
        status: instance.status,
        imported: instance.imported,
        skippedDefault: instance.skippedDefault,
        skippedNoMatch: instance.skippedNoMatch,
        conflicted: instance.conflicted,
        failed: instance.failed,
        createdAt: instance.createdAt,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch latest startup pull run';
    await logger.error('Failed to get latest startup pull run', {
      source: 'system/startup-pull',
      meta: { error: message },
    });
    return json({ error: message } satisfies ErrorResponse, { status: 500 });
  }
};
