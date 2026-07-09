import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { CONFIG_HEALTH_ENGINE_VERSION, type CriterionConfig } from '$shared/health/index.ts';
import { configHealthSettingsQueries, type UpdateConfigHealthSettingsInput } from '$db/queries/configHealthSettings.ts';
import { toSettingsResponse } from '$lib/server/health/responses.ts';
import { scheduleConfigHealthSnapshot, scheduleConfigHealthCleanup } from '$jobs/init.ts';
import { logger } from '$logger/logger.ts';
import type { components } from '$api/v1.d.ts';

type ErrorResponse = { error: string };
type SettingsResponse = components['schemas']['ConfigHealthSettingsResponse'];

/**
 * GET /api/v1/config-health/settings
 *
 * The configurable criteria (enable/weights), cadence, retention, engine version, and the static
 * criterion catalog so the client hardcodes nothing.
 */
export const GET: RequestHandler = () => {
  const settings = configHealthSettingsQueries.get();
  return json(toSettingsResponse(settings) satisfies SettingsResponse);
};

function isInt(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min;
}

/**
 * PUT /api/v1/config-health/settings
 *
 * Update criteria/cadence/retention. Guards with `expectedEngineVersion` (409 on mismatch) and
 * reschedules the snapshot + cleanup jobs immediately so cadence/enable changes take effect at once.
 */
export const PUT: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('body must be a JSON object');
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' } satisfies ErrorResponse, { status: 400 });
  }

  if (typeof body.expectedEngineVersion !== 'string' || body.expectedEngineVersion.length === 0) {
    return json({ error: 'expectedEngineVersion must be a non-empty string' } satisfies ErrorResponse, { status: 400 });
  }
  if (body.expectedEngineVersion !== CONFIG_HEALTH_ENGINE_VERSION) {
    return json(
      {
        error: `Engine version mismatch: client "${body.expectedEngineVersion}", server "${CONFIG_HEALTH_ENGINE_VERSION}". Reload settings before saving.`,
      } satisfies ErrorResponse,
      { status: 409 }
    );
  }

  const update: UpdateConfigHealthSettingsInput = {};

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') {
      return json({ error: 'enabled must be a boolean' } satisfies ErrorResponse, { status: 400 });
    }
    update.enabled = body.enabled;
  }
  if (body.intervalMinutes !== undefined) {
    if (!isInt(body.intervalMinutes, 5)) {
      return json({ error: 'intervalMinutes must be an integer >= 5' } satisfies ErrorResponse, { status: 400 });
    }
    update.intervalMinutes = body.intervalMinutes;
  }
  if (body.retentionDays !== undefined) {
    if (!isInt(body.retentionDays, 1)) {
      return json({ error: 'retentionDays must be an integer >= 1' } satisfies ErrorResponse, { status: 400 });
    }
    update.retentionDays = body.retentionDays;
  }
  if (body.retentionMaxEntries !== undefined) {
    if (!isInt(body.retentionMaxEntries, 1)) {
      return json({ error: 'retentionMaxEntries must be an integer >= 1' } satisfies ErrorResponse, { status: 400 });
    }
    update.retentionMaxEntries = body.retentionMaxEntries;
  }
  if (body.criteria !== undefined) {
    if (!Array.isArray(body.criteria)) {
      return json({ error: 'criteria must be an array' } satisfies ErrorResponse, { status: 400 });
    }
    // The query normalizer validates/sanitizes each entry against the canonical criterion set.
    update.criteria = body.criteria as CriterionConfig[];
  }

  try {
    configHealthSettingsQueries.update(update);
    // Reschedule immediately so cadence/enabled changes take effect without waiting for a restart.
    scheduleConfigHealthSnapshot();
    scheduleConfigHealthCleanup();
    return json(toSettingsResponse(configHealthSettingsQueries.get()) satisfies SettingsResponse);
  } catch (error) {
    await logger.error('Failed to update config health settings', {
      source: 'ConfigHealthSettingsRoute',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to update config health settings' } satisfies ErrorResponse, { status: 500 });
  }
};
