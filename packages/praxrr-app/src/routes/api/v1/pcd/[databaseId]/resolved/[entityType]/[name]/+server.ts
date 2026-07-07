import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import { pcdManager, resolveLayerState } from '$pcd/index.ts';
import { isArrAppType } from '$shared/arr/capabilities.ts';
import type { ArrAppType } from '$shared/pcd/types.ts';
import {
  isKnownResolvedEntityType,
  mapResolvedErrorToResponse,
  sanitizeBigInts,
  toWireOverrides,
  toWirePayload,
} from '../../shared.ts';

type ResolvedEntityState = components['schemas']['ResolvedEntityState'];
type ErrorResponse = components['schemas']['ErrorResponse'];

/**
 * GET /api/v1/pcd/{databaseId}/resolved/{entityType}/{name}
 *
 * Returns resolved config state for a single named entity, for the selected
 * layer (`base`, `user`, or `resolved`), via `resolveLayerState`.
 *
 * Path params:
 * - databaseId: PCD database ID
 * - entityType: resolved config entity type
 * - name: entity name
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

  const name = params.name;
  if (!name) {
    return json({ error: 'Invalid name' } satisfies ErrorResponse, { status: 400 });
  }

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
    // resolveLayerState composes the readers dispatch table (`layer=resolved`), the
    // ephemeral base-only cache (`layer=base`), and the base-vs-resolved field diff
    // (`layer=user`) behind one call -- a single entity read has no per-request
    // repeated-build cost, so unlike the list endpoint's layer=base/user branches this
    // always routes through resolveLayerState for hasPendingConflict uniformity.
    const state = await resolveLayerState({ databaseId, entityType, arrType, name, layer: layerParam });

    let response: ResolvedEntityState;
    if (state.layer === 'user') {
      response = {
        databaseId,
        entityType,
        name,
        layer: 'user',
        present: state.present,
        overrides: toWireOverrides(state.overrides),
        hasPendingConflict: state.hasPendingConflict,
      } satisfies ResolvedEntityState;
    } else {
      response = {
        databaseId,
        entityType,
        name,
        layer: state.layer,
        present: state.present,
        entity: state.entity !== null ? toWirePayload(state.entity) : null,
        hasPendingConflict: state.hasPendingConflict,
      } satisfies ResolvedEntityState;
    }

    return json(sanitizeBigInts(response));
  } catch (error) {
    // Typed error mapping (never string-sniffed): `ResolvedConfigValidationError` ->
    // 400, `ResolvedConfigDatabaseNotFoundError` -> 400 'Database not found',
    // `ResolvedEntityNotFoundError` (a genuine by-name miss -- serialize.ts's readers
    // throw a plain `Error("... not found")` on their own top-level miss, rewrapped by
    // readers.ts's `invokeReader`) -> 404, everything else -> generic 500. Previously
    // this branch used `error.message.includes('not found')`, which also matched
    // `ResolvedConfigDatabaseNotFoundError`'s "Database instance N not found" and
    // PCDCache's SQL-helper "Tag not found: X" misses -- both misclassified as 404.
    return mapResolvedErrorToResponse(error, {
      source: 'pcd/resolved/[entityType]/[name]',
      logMessage: 'Failed to read resolved config entity',
      meta: { databaseId, entityType, name },
      fallbackMessage: 'Failed to read resolved config state',
    });
  }
};
