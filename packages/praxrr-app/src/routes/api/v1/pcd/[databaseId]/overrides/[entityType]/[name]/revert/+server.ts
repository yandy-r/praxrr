import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import { pcdManager, revertEntityOverrides } from '$pcd/index.ts';
import {
  mapOverridesErrorToResponse,
  parseDatabaseId,
  parseRevertBody,
  readJsonObjectBody,
  resolveEntityTarget,
  sanitizeBigInts,
} from '../../../shared.ts';

type ErrorResponse = components['schemas']['ErrorResponse'];
type PcdOverrideRevertResult = components['schemas']['PcdOverrideRevertResult'];

/**
 * POST /api/v1/pcd/{databaseId}/overrides/{entityType}/{name}/revert
 *
 * Soft-drops all (or the selected `opIds`) published user ops of the entity addressed by its
 * CURRENT name and recompiles the PCD. Fail-closed: dependent or conflicting changes yield 409
 * with a `reason`; `cascadeGroup: true` opts in to dropping co-grouped ops of other entities.
 *
 * Query params:
 * - arrType: required for per-arr entity types, rejected for arr-agnostic ones
 *
 * API tokens require the `admin` scope (fail-closed default in scopePolicy).
 */
export const POST: RequestHandler = async ({ locals, params, url, request }) => {
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

  const targetResult = resolveEntityTarget(params, url);
  if ('response' in targetResult) return targetResult.response;
  const { entityType, arrType, name } = targetResult.value;

  const bodyResult = await readJsonObjectBody(request);
  if ('response' in bodyResult) return bodyResult.response;
  const parsed = parseRevertBody(bodyResult.value);
  if ('response' in parsed) return parsed.response;

  try {
    const result = await revertEntityOverrides({
      databaseId,
      entityType,
      arrType,
      name,
      opIds: parsed.value.opIds,
      cascadeGroup: parsed.value.cascadeGroup,
    });
    return json(sanitizeBigInts(result satisfies PcdOverrideRevertResult));
  } catch (error) {
    return mapOverridesErrorToResponse(error, {
      source: 'pcd/overrides/[entityType]/[name]/revert',
      logMessage: 'Failed to revert local overrides',
      meta: { databaseId, entityType, arrType, name },
      fallbackMessage: 'Failed to revert local overrides',
    });
  }
};
