import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import { getImpact, isNodeKind, pcdManager } from '$pcd/index.ts';
import type { GraphArrType, ImpactDirection } from '$pcd/index.ts';
import { isGraphArrType, mapGraphErrorToResponse, sanitizeBigInts } from '../../shared.ts';

type GraphImpactResponse = components['schemas']['GraphImpactResponse'];
type ErrorResponse = components['schemas']['ErrorResponse'];

/**
 * GET /api/v1/pcd/{databaseId}/graph/{nodeKind}/{name}
 *
 * Returns the entities that reference (`direction=dependents`, default) or are referenced
 * by (`direction=dependencies`) a single named node, via a bounded traversal.
 *
 * `name` is a `[...name]` rest param so entity names containing `/` survive (clients must
 * percent-encode reserved characters). An unknown/unbuilt `databaseId` is 400; a
 * well-formed request for a missing node is 404.
 */
export const GET: RequestHandler = async ({ locals, params, url }) => {
  if (!locals.user && !locals.authBypass) {
    return json({ error: 'Unauthorized' } satisfies ErrorResponse, { status: 401 });
  }

  const databaseIdParam = params.databaseId;
  if (!databaseIdParam || !/^\d+$/.test(databaseIdParam)) {
    return json({ error: 'Invalid databaseId' } satisfies ErrorResponse, { status: 400 });
  }
  const databaseId = Number.parseInt(databaseIdParam, 10);

  const cache = pcdManager.getCache(databaseId);
  if (!cache?.isBuilt()) {
    return json({ error: 'Database not found' } satisfies ErrorResponse, { status: 400 });
  }

  const nodeKindParam = params.nodeKind;
  if (!nodeKindParam || !isNodeKind(nodeKindParam)) {
    return json({ error: `Invalid nodeKind "${nodeKindParam}"` } satisfies ErrorResponse, { status: 400 });
  }
  const nodeKind = nodeKindParam;

  const name = params.name;
  if (!name) {
    return json({ error: 'Missing node name' } satisfies ErrorResponse, { status: 400 });
  }

  const directionParam = url.searchParams.get('direction') ?? 'dependents';
  if (directionParam !== 'dependents' && directionParam !== 'dependencies') {
    return json({ error: `Invalid direction "${directionParam}"` } satisfies ErrorResponse, { status: 400 });
  }
  const direction: ImpactDirection = directionParam;

  const depthParam = url.searchParams.get('depth');
  let depth: number | undefined;
  if (depthParam !== null) {
    if (!/^\d+$/.test(depthParam)) {
      return json({ error: `Invalid depth "${depthParam}"` } satisfies ErrorResponse, { status: 400 });
    }
    depth = Number.parseInt(depthParam, 10);
  }

  const arrTypeParam = url.searchParams.get('arrType');
  let arrType: GraphArrType | undefined;
  if (arrTypeParam !== null) {
    if (!isGraphArrType(arrTypeParam)) {
      return json({ error: `Invalid arrType "${arrTypeParam}"` } satisfies ErrorResponse, { status: 400 });
    }
    arrType = arrTypeParam;
  }

  try {
    const impact: GraphImpactResponse = await getImpact(
      cache,
      databaseId,
      { kind: nodeKind, name },
      { direction, depth, arrType }
    );
    return json(sanitizeBigInts(impact));
  } catch (error) {
    return mapGraphErrorToResponse(error, {
      source: 'pcd/graph/[nodeKind]/[name]',
      logMessage: 'Failed to compute dependency impact',
      meta: { databaseId, nodeKind, name, direction },
      fallbackMessage: 'Failed to compute dependency impact',
    });
  }
};
