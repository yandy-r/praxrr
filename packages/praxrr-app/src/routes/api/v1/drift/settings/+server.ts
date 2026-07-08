import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { driftSettingsQueries } from '$db/queries/driftSettings.ts';
import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { scheduleDriftCheck } from '$jobs/init.ts';
import { toDriftSettingsResponse } from '$sync/drift/responses.ts';
import { logger } from '$logger/logger.ts';

type ErrorResponse = { error: string };

const MIN_INTERVAL_MINUTES = 5;

type UpdateBody = {
  enabled?: unknown;
  intervalMinutes?: unknown;
};

/**
 * PUT /api/v1/drift/settings
 *
 * Enable/disable drift detection and set the polling interval, then reschedule or cancel the
 * recurring drift check job accordingly.
 */
export const PUT: RequestHandler = async ({ request }) => {
  let body: UpdateBody;
  try {
    body = (await request.json()) as UpdateBody;
  } catch {
    return json({ error: 'Invalid JSON body' } satisfies ErrorResponse, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return json({ error: 'Request body must be an object' } satisfies ErrorResponse, { status: 400 });
  }

  const update: { enabled?: boolean; intervalMinutes?: number } = {};

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') {
      return json({ error: 'enabled must be a boolean' } satisfies ErrorResponse, { status: 400 });
    }
    update.enabled = body.enabled;
  }

  if (body.intervalMinutes !== undefined) {
    if (
      typeof body.intervalMinutes !== 'number' ||
      !Number.isInteger(body.intervalMinutes) ||
      body.intervalMinutes < MIN_INTERVAL_MINUTES
    ) {
      return json({ error: `intervalMinutes must be an integer >= ${MIN_INTERVAL_MINUTES}` } satisfies ErrorResponse, {
        status: 400,
      });
    }
    update.intervalMinutes = body.intervalMinutes;
  }

  try {
    driftSettingsQueries.update(update);
    // Reseed or cancel the recurring job to match the new settings.
    scheduleDriftCheck();

    const settings = driftSettingsQueries.get();
    const nextRunAt = settings.enabled === 1 ? (jobQueueQueries.getByDedupeKey('drift.check')?.runAt ?? null) : null;
    return json(toDriftSettingsResponse(settings, nextRunAt));
  } catch (error) {
    await logger.error('Failed to update drift settings', {
      source: 'DriftSettingsRoute',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to update drift settings' } satisfies ErrorResponse, { status: 500 });
  }
};
