import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { isSyncPreviewArrType } from '$sync/preview/types.ts';
import { recomputeAndPersistInstance } from '$lib/server/health/recompute.ts';
import { toDetailResponse } from '$lib/server/health/responses.ts';
import { parseConfigHealthInstanceId } from '$lib/server/health/pathParams.ts';
import {
  CONFIG_HEALTH_RECOMPUTE_RATE_LIMIT_WINDOW_MS,
  registerConfigHealthRecomputeAttempt,
} from '$lib/server/health/recomputeLimits.ts';
import { logger } from '$logger/logger.ts';
import type { components } from '$api/v1.d.ts';

type ErrorResponse = { error: string };
type DetailResponse = components['schemas']['ConfigHealthDetailResponse'];

/**
 * POST /api/v1/config-health/{instanceId}/recompute
 *
 * Recompute + persist current config health for exactly one instance on the request thread (not the
 * scheduled sweep), then return the fresh detail. Reuses the one score+persist path the sweep uses
 * (`recomputeAndPersistInstance`), so the response schema and engine version match scheduled
 * snapshots exactly. Rate-limited per instance and bounded by a per-instance in-flight guard.
 *
 * The body is the freshly computed in-memory report (via `toDetailResponse`), NOT a re-read of the
 * persisted snapshot: `config_health_snapshots` stores only a lossy trend projection (no suggestions,
 * no per-profile criteria), so it cannot reconstruct the full detail response.
 *
 * A degraded/unreachable instance is not an error — scoring does no live Arr I/O, so it still yields
 * an `unknown`-band report returned as 200 (identical to the GET detail route). 500 is reached only
 * when persisting the snapshot fails.
 */
export const POST: RequestHandler = async ({ params }) => {
  const instanceId = parseConfigHealthInstanceId(params.instanceId);
  if (instanceId === null) {
    return json({ error: 'Invalid instance id' } satisfies ErrorResponse, { status: 400 });
  }

  const instance = arrInstancesQueries.getById(instanceId);
  // 404 covers both "unknown" and "not sync-capable" (matches the GET detail contract).
  if (!instance || !isSyncPreviewArrType(instance.type)) {
    return json({ error: 'Instance not found or not sync-capable' } satisfies ErrorResponse, { status: 404 });
  }
  // The scheduled sweep only snapshots enabled instances; rejecting disabled here keeps the persisted
  // trend consistent with the sweep (no orphan points for disabled instances).
  if (!instance.enabled) {
    return json({ error: 'Instance is disabled' } satisfies ErrorResponse, { status: 400 });
  }

  if (!registerConfigHealthRecomputeAttempt(instanceId, Date.now())) {
    const windowSeconds = Math.floor(CONFIG_HEALTH_RECOMPUTE_RATE_LIMIT_WINDOW_MS / 1000);
    return json({ error: 'Too many config health recompute requests for this instance' } satisfies ErrorResponse, {
      status: 429,
      headers: { 'Retry-After': String(windowSeconds) },
    });
  }

  const outcome = await recomputeAndPersistInstance(instance);
  if (outcome.kind === 'in_flight') {
    return json(
      { error: 'A config health recompute for this instance is already in progress' } satisfies ErrorResponse,
      {
        status: 409,
      }
    );
  }
  // Defensive: only reachable if the instance is deleted between the getById above and the score.
  if (outcome.kind === 'skipped') {
    return json({ error: 'Instance not found or not sync-capable' } satisfies ErrorResponse, { status: 404 });
  }
  if (outcome.kind === 'error') {
    await logger.error('Failed to recompute config health', {
      source: 'ConfigHealthRecomputeRoute',
      meta: { instanceId },
    });
    return json({ error: 'Failed to recompute config health' } satisfies ErrorResponse, { status: 500 });
  }

  return json(toDetailResponse(outcome.report) satisfies DetailResponse);
};
