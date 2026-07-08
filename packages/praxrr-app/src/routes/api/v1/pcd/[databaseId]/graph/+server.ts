import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import { buildDependencyGraph, isNodeKind, pcdManager } from '$pcd/index.ts';
import type { GraphArrType, NodeKind } from '$pcd/index.ts';
import { isGraphArrType, mapGraphErrorToResponse, sanitizeBigInts } from './shared.ts';

type DependencyGraphResponse = components['schemas']['DependencyGraphResponse'];
type ErrorResponse = components['schemas']['ErrorResponse'];

/**
 * GET /api/v1/pcd/{databaseId}/graph
 *
 * Returns the resolved dependency graph of config entities, computed on demand from the
 * read-only PCD cache.
 *
 * Query params:
 * - arrType: restrict to edges scoped to this Arr app (plus `all`) and compatible
 *   quality profiles; `all` keeps only `all`-scoped edges
 * - nodeKind: restrict the graph to a single entity family (plus its immediate neighbours)
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
    // Deliberately 400, not 404: an unknown/unbuilt database is a caller-input problem
    // and there is no sibling-app fallback (Cross-Arr Semantic Validation Policy).
    return json({ error: 'Database not found' } satisfies ErrorResponse, { status: 400 });
  }

  const arrTypeParam = url.searchParams.get('arrType');
  let arrType: GraphArrType | undefined;
  if (arrTypeParam !== null) {
    if (!isGraphArrType(arrTypeParam)) {
      return json({ error: `Invalid arrType "${arrTypeParam}"` } satisfies ErrorResponse, { status: 400 });
    }
    arrType = arrTypeParam;
  }

  const nodeKindParam = url.searchParams.get('nodeKind');
  let nodeKind: NodeKind | undefined;
  if (nodeKindParam !== null) {
    if (!isNodeKind(nodeKindParam)) {
      return json({ error: `Invalid nodeKind "${nodeKindParam}"` } satisfies ErrorResponse, { status: 400 });
    }
    nodeKind = nodeKindParam;
  }

  try {
    const graph: DependencyGraphResponse = await buildDependencyGraph(cache, databaseId, { arrType, nodeKind });
    return json(sanitizeBigInts(graph));
  } catch (error) {
    return mapGraphErrorToResponse(error, {
      source: 'pcd/graph',
      logMessage: 'Failed to build dependency graph',
      meta: { databaseId, arrType, nodeKind },
    });
  }
};
