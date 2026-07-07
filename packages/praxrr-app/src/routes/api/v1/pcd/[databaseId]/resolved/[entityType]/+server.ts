import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import {
  buildPendingConflictIndex,
  computeUserOverrides,
  listResolvedEntityNames,
  pcdManager,
  readEntityOrNull,
  readResolvedEntity,
  withBaseOnlyCache,
} from '$pcd/index.ts';
import { isArrAppType } from '$shared/arr/capabilities.ts';
import type { ArrAppType } from '$shared/pcd/types.ts';
import {
  isKnownResolvedEntityType,
  mapResolvedErrorToResponse,
  sanitizeBigInts,
  toWireOverrides,
  toWirePayload,
} from '../shared.ts';

type ResolvedEntityListResponse = components['schemas']['ResolvedEntityListResponse'];
type ResolvedEntityState = components['schemas']['ResolvedEntityState'];
type ErrorResponse = components['schemas']['ErrorResponse'];

/**
 * GET /api/v1/pcd/{databaseId}/resolved/{entityType}
 *
 * Lists resolved config state for every entity of the given type in the PCD
 * database, for the selected layer (`base`, `user`, or `resolved`).
 *
 * Path params:
 * - databaseId: PCD database ID
 * - entityType: resolved config entity type
 *
 * Query params:
 * - layer: resolved config layer to read (default `resolved`)
 * - arrType: required for per-arr-app entity types, rejected for arr-agnostic ones
 */
export const GET: RequestHandler = async ({ locals, params, url }) => {
  // Fail closed unless authenticated OR auth is explicitly bypassed (AUTH=off / local-subnet bypass).
  if (!locals.user && !locals.authBypass) {
    return json({ error: 'Unauthorized' } satisfies ErrorResponse, { status: 401 });
  }

  // Strict digits-only: reject leading-numeric junk like "1e5"/"1abc"/" 1" outright
  // per the fail-fast, no-ambiguous-ids policy for this endpoint.
  const databaseIdParam = params.databaseId;
  if (!databaseIdParam || !/^\d+$/.test(databaseIdParam)) {
    return json({ error: 'Invalid databaseId' } satisfies ErrorResponse, { status: 400 });
  }
  const databaseId = Number.parseInt(databaseIdParam, 10);

  const cache = pcdManager.getCache(databaseId);
  if (!cache?.isBuilt()) {
    // Deliberately 400, not 404: an unknown/unbuilt database is a caller input
    // problem here, and there is no sibling-app fallback to fall back on per
    // the Cross-Arr Semantic Validation Policy.
    return json({ error: 'Database not found' } satisfies ErrorResponse, { status: 400 });
  }

  const entityTypeParam = params.entityType;
  if (!entityTypeParam || !isKnownResolvedEntityType(entityTypeParam)) {
    return json({ error: `Unknown entityType "${entityTypeParam}"` } satisfies ErrorResponse, { status: 400 });
  }
  const entityType = entityTypeParam;

  const layerParam = url.searchParams.get('layer') ?? 'resolved';
  if (layerParam !== 'base' && layerParam !== 'user' && layerParam !== 'resolved') {
    return json({ error: `Invalid layer "${layerParam}"` } satisfies ErrorResponse, { status: 400 });
  }

  const arrTypeParam = url.searchParams.get('arrType');
  let arrType: ArrAppType | undefined;
  if (arrTypeParam !== null) {
    if (!isArrAppType(arrTypeParam)) {
      return json({ error: `Invalid arrType "${arrTypeParam}"` } satisfies ErrorResponse, { status: 400 });
    }
    arrType = arrTypeParam;
  }

  try {
    // Business Rule 6: hoisted ONCE per request and reused as an O(1) lookup across
    // every branch below -- see `buildPendingConflictIndex`'s doc for why this replaces
    // a per-entity `pcdOpHistoryQueries.listLatestConflictsByDatabase` query. Also
    // replaces the previous layer=resolved branch's hardcoded `hasPendingConflict:
    // false`, which was never accurate.
    const pendingConflictLookup = buildPendingConflictIndex(databaseId);

    let entities: ResolvedEntityState[];

    if (layerParam === 'resolved') {
      const names = await listResolvedEntityNames(cache, entityType, arrType);
      entities = await Promise.all(
        names.map(async (name) => {
          const entity = await readResolvedEntity(cache, entityType, arrType, name);
          return {
            databaseId,
            entityType,
            name,
            layer: 'resolved',
            present: true,
            entity: toWirePayload(entity),
            hasPendingConflict: pendingConflictLookup(entityType, arrType, name),
          } satisfies ResolvedEntityState;
        })
      );
    } else if (layerParam === 'base') {
      // Build the ephemeral schema+base+tweaks-only cache ONCE for the whole request --
      // never per entity -- then list and read every name against that single cache.
      entities = await withBaseOnlyCache(databaseId, async (baseCache) => {
        const names = await listResolvedEntityNames(baseCache, entityType, arrType);
        return Promise.all(
          names.map(async (name) => {
            const entity = await readResolvedEntity(baseCache, entityType, arrType, name);
            return {
              databaseId,
              entityType,
              name,
              layer: 'base',
              present: true,
              entity: toWirePayload(entity),
              hasPendingConflict: pendingConflictLookup(entityType, arrType, name),
            } satisfies ResolvedEntityState;
          })
        );
      });
    } else {
      // layer === 'user': names are the UNION of the resolved-cache and base-cache
      // names, not just the resolved cache -- a name present only in base (absent from
      // resolved) is a user-deleted entity and must still be reported (present:false,
      // removal overrides via `computeUserOverrides(baseEntity, null)`), not silently
      // omitted from the list. The base-only cache is built ONCE and reused for every
      // name's diff.
      entities = await withBaseOnlyCache(databaseId, async (baseCache) => {
        const [resolvedNames, baseNames] = await Promise.all([
          listResolvedEntityNames(cache, entityType, arrType),
          listResolvedEntityNames(baseCache, entityType, arrType),
        ]);
        const names = Array.from(new Set([...resolvedNames, ...baseNames])).sort();

        return Promise.all(
          names.map(async (name) => {
            const resolvedEntity = await readEntityOrNull(cache, entityType, arrType, name);
            const baseEntity = await readEntityOrNull(baseCache, entityType, arrType, name);
            return {
              databaseId,
              entityType,
              name,
              layer: 'user',
              present: resolvedEntity !== null,
              overrides: toWireOverrides(computeUserOverrides(baseEntity, resolvedEntity)),
              hasPendingConflict: pendingConflictLookup(entityType, arrType, name),
            } satisfies ResolvedEntityState;
          })
        );
      });
    }

    const response = {
      databaseId,
      entityType,
      layer: layerParam,
      entities,
    } satisfies ResolvedEntityListResponse;

    return json(sanitizeBigInts(response));
  } catch (error) {
    return mapResolvedErrorToResponse(error, {
      source: 'pcd/resolved/[entityType]',
      logMessage: 'Failed to list resolved config entities',
      meta: { databaseId, entityType },
      fallbackMessage: 'Failed to read resolved config state',
    });
  }
};
