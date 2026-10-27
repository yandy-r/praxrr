import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import { listOverrides, pcdManager } from '$pcd/index.ts';
import type { ArrAppType } from '$shared/pcd/types.ts';
import type { ResolvedEntityType } from '$pcd/index.ts';
import {
  isKnownResolvedEntityType,
  mapOverridesErrorToResponse,
  parseArrTypeParam,
  parseDatabaseId,
  sanitizeBigInts,
  toWireOverridesResponse,
  validateEntityScope,
} from './shared.ts';

type ErrorResponse = components['schemas']['ErrorResponse'];

/**
 * GET /api/v1/pcd/{databaseId}/overrides
 *
 * Lists entities carrying published user (local) ops with their upstream-base-to-resolved field
 * deltas, plus the latest undoable action across the whole database.
 *
 * Query params:
 * - entityType: optional resolved entity type filter
 * - arrType: optional Arr app filter; required for per-arr entity types, rejected for
 *   arr-agnostic ones when entityType is given
 */
export const GET: RequestHandler = async ({ locals, params, url }) => {
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

  const entityTypeParam = url.searchParams.get('entityType');
  let entityType: ResolvedEntityType | undefined;
  if (entityTypeParam !== null) {
    if (!isKnownResolvedEntityType(entityTypeParam)) {
      return json({ error: `Unknown entityType "${entityTypeParam}"` } satisfies ErrorResponse, { status: 400 });
    }
    entityType = entityTypeParam;
  }

  const arrTypeResult = parseArrTypeParam(url.searchParams.get('arrType'));
  if ('response' in arrTypeResult) return arrTypeResult.response;
  const arrType: ArrAppType | undefined = arrTypeResult.value;

  if (entityType !== undefined) {
    const invalid = validateEntityScope(entityType, arrType);
    if (invalid) return invalid.response;
  }

  try {
    const snapshot = await listOverrides(databaseId, { entityType, arrType });
    return json(sanitizeBigInts(toWireOverridesResponse(databaseId, snapshot)));
  } catch (error) {
    return mapOverridesErrorToResponse(error, {
      source: 'pcd/overrides',
      logMessage: 'Failed to list local overrides',
      meta: { databaseId, entityType, arrType },
      fallbackMessage: 'Failed to list local overrides',
    });
  }
};
