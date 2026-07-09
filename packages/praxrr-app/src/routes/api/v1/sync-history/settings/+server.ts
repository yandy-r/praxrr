import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { syncHistorySettingsQueries, type UpdateSyncHistorySettingsInput } from '$db/queries/syncHistorySettings.ts';
import { scheduleSyncHistoryCleanup } from '$jobs/init.ts';
import { toSyncHistorySettingsResponse } from '$sync/syncHistory/responses.ts';
import { logger } from '$logger/logger.ts';

type ErrorResponse = { error: string };

type UpdateBody = {
  enabled?: unknown;
  retentionDays?: unknown;
  retentionMaxEntries?: unknown;
};

/**
 * GET /api/v1/sync-history/settings
 *
 * Returns the current sync history retention + enable settings.
 */
export const GET: RequestHandler = async () => {
  try {
    return json(toSyncHistorySettingsResponse(syncHistorySettingsQueries.get()));
  } catch (error) {
    await logger.error('Failed to read sync history settings', {
      source: 'SyncHistorySettingsRoute',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to read sync history settings' } satisfies ErrorResponse, { status: 500 });
  }
};

/**
 * PATCH /api/v1/sync-history/settings
 *
 * Updates retention (days + max entries) and the enable flag, then reschedules or cancels the
 * recurring `sync.history.cleanup` job so the change takes effect immediately.
 */
export const PATCH: RequestHandler = async ({ request }) => {
  let body: UpdateBody;
  try {
    body = (await request.json()) as UpdateBody;
  } catch {
    return json({ error: 'Invalid JSON body' } satisfies ErrorResponse, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return json({ error: 'Request body must be an object' } satisfies ErrorResponse, { status: 400 });
  }

  const update: UpdateSyncHistorySettingsInput = {};

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') {
      return json({ error: 'enabled must be a boolean' } satisfies ErrorResponse, { status: 400 });
    }
    update.enabled = body.enabled;
  }

  if (body.retentionDays !== undefined) {
    if (typeof body.retentionDays !== 'number' || !Number.isInteger(body.retentionDays) || body.retentionDays < 1) {
      return json({ error: 'retentionDays must be an integer >= 1' } satisfies ErrorResponse, { status: 400 });
    }
    update.retentionDays = body.retentionDays;
  }

  if (body.retentionMaxEntries !== undefined) {
    if (
      typeof body.retentionMaxEntries !== 'number' ||
      !Number.isInteger(body.retentionMaxEntries) ||
      body.retentionMaxEntries < 0
    ) {
      return json({ error: 'retentionMaxEntries must be an integer >= 0' } satisfies ErrorResponse, { status: 400 });
    }
    update.retentionMaxEntries = body.retentionMaxEntries;
  }

  try {
    syncHistorySettingsQueries.update(update);
    // Reseed or cancel the recurring cleanup job to match the new settings.
    scheduleSyncHistoryCleanup();

    return json(toSyncHistorySettingsResponse(syncHistorySettingsQueries.get()));
  } catch (error) {
    await logger.error('Failed to update sync history settings', {
      source: 'SyncHistorySettingsRoute',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to update sync history settings' } satisfies ErrorResponse, { status: 500 });
  }
};
