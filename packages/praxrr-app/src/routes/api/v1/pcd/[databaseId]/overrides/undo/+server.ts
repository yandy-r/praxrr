import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import { pcdManager, undoLastAction } from '$pcd/index.ts';
import {
  mapOverridesErrorToResponse,
  parseDatabaseId,
  parseUndoBody,
  readJsonObjectBody,
  sanitizeBigInts,
} from '../shared.ts';

type ErrorResponse = components['schemas']['ErrorResponse'];
type PcdOverrideUndoResult = components['schemas']['PcdOverrideUndoResult'];

/**
 * POST /api/v1/pcd/{databaseId}/overrides/undo
 *
 * Soft-drops exactly the latest published user-action unit and recompiles the PCD. Optional body
 * `{ expectedActionId }` guards against undoing an action the caller has not seen (409
 * `stale_action`). API tokens require the `admin` scope (fail-closed default in scopePolicy).
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  // Fail closed unless authenticated OR auth is explicitly bypassed (AUTH=off / local-subnet bypass).
  if (!locals.user && !locals.authBypass) {
    return json({ error: 'Unauthorized' } satisfies ErrorResponse, { status: 401 });
  }

  const databaseIdResult = parseDatabaseId(params.databaseId);
  if ('response' in databaseIdResult) return databaseIdResult.response;
  const databaseId = databaseIdResult.value;

  const cache = pcdManager.getCache(databaseId);
  if (!cache?.isBuilt()) {
    return json({ error: 'Database not found' } satisfies ErrorResponse, { status: 400 });
  }

  const bodyResult = await readJsonObjectBody(request);
  if ('response' in bodyResult) return bodyResult.response;
  const parsed = parseUndoBody(bodyResult.value);
  if ('response' in parsed) return parsed.response;

  try {
    const result = await undoLastAction({ databaseId, expectedActionId: parsed.value.expectedActionId });
    return json(sanitizeBigInts(result satisfies PcdOverrideUndoResult));
  } catch (error) {
    return mapOverridesErrorToResponse(error, {
      source: 'pcd/overrides/undo',
      logMessage: 'Failed to undo latest local change',
      meta: { databaseId },
      fallbackMessage: 'Failed to undo the latest local change',
    });
  }
};
