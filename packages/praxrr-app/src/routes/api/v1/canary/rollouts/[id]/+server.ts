import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { canaryRolloutQueries } from '$db/queries/canaryRollouts.ts';
import { logger } from '$logger/logger.ts';

type ErrorResponse = { error: string };

const POSITIVE_INTEGER_ID = /^\d+$/;

function parsePositiveInteger(rawId: string | undefined, fieldName: string): { value: number } | { error: string } {
  if (!rawId) {
    return { error: `Missing ${fieldName}` };
  }

  if (!POSITIVE_INTEGER_ID.test(rawId)) {
    return { error: `Invalid ${fieldName}` };
  }

  const id = Number.parseInt(rawId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return { error: `Invalid ${fieldName}` };
  }

  return { value: id };
}

/**
 * GET /api/v1/canary/rollouts/{id}
 *
 * Full detail for a single canary rollout (issue #19): canary diagnostics, remaining targets,
 * per-instance rollout results, and the current `stateToken` used to guard proceed/abort.
 * Returns 404 when the rollout does not exist; 400 on an invalid id; 500 only on internal error.
 */
export const GET: RequestHandler = async ({ params }) => {
  const idResult = parsePositiveInteger(params.id, 'id');
  if ('error' in idResult) {
    return json({ error: idResult.error } satisfies ErrorResponse, { status: 400 });
  }

  try {
    const rollout = canaryRolloutQueries.getById(idResult.value);
    if (!rollout) {
      return json({ error: 'Canary rollout not found' } satisfies ErrorResponse, { status: 404 });
    }
    return json(rollout);
  } catch (error) {
    await logger.error('Failed to read canary rollout detail', {
      source: 'CanaryRolloutDetailRoute',
      meta: { id: idResult.value, error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to read canary rollout detail' } satisfies ErrorResponse, { status: 500 });
  }
};
