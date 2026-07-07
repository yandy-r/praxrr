import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import {
  ARR_AGNOSTIC_READERS,
  computeUserOverrides,
  isResolvedConfigValidationError,
  listResolvedEntityNames,
  pcdManager,
  PER_ARR_READERS,
  readResolvedEntity,
  withBaseOnlyCache,
} from '$pcd/index.ts';
import type { PCDCache, ResolvedEntityPayload, ResolvedEntityType } from '$pcd/index.ts';
// Not re-exported via `$pcd/index.ts` -- imported directly from its owning module (an
// established pattern in this codebase, see e.g. `tests/pcd/resolved/layerDiff.test.ts`).
// `resolveLayerState` itself is not used here: it would rebuild the ephemeral base-only
// cache once per entity in this loop, which the list endpoint must not do (see the
// layer=base/user branches below, which build it once via `withBaseOnlyCache`).
import { computeHasPendingConflict } from '$pcd/resolved/layerDiff.ts';
import { isArrAppType } from '$shared/arr/capabilities.ts';
import type { ArrAppType } from '$shared/pcd/types.ts';
import type { FieldChange } from '$sync/preview/types.ts';
import { logger } from '$logger/logger.ts';

type ResolvedEntityListResponse = components['schemas']['ResolvedEntityListResponse'];
type ResolvedEntityState = components['schemas']['ResolvedEntityState'];
type ErrorResponse = components['schemas']['ErrorResponse'];

// readers.ts is the single source of truth for which entity types exist -- derive the
// known-entityType set from its dispatch tables instead of re-declaring the union here.
const RESOLVED_ENTITY_TYPES: ReadonlySet<string> = new Set<string>([
  ...Object.keys(ARR_AGNOSTIC_READERS),
  ...Object.keys(PER_ARR_READERS),
]);

function isKnownResolvedEntityType(value: string): value is ResolvedEntityType {
  return RESOLVED_ENTITY_TYPES.has(value);
}

/**
 * `PortableCustomFormat.conditions` is an intentionally loosely-typed "shape varies by
 * condition type" field in the contract (see docs/api/v1/schemas/pcd.yaml); the
 * generated `{ [key: string]: unknown }` item shape has no structural relationship to
 * the internal `ConditionData` interface (it declares no index signature), even though
 * the two are identical once serialized to JSON. Narrow, single-purpose cast at the
 * wire boundary -- every other field on `ResolvedEntityState` stays `satisfies`-checked.
 */
function toWirePayload(payload: ResolvedEntityPayload): ResolvedEntityState['entity'] {
  return payload as unknown as ResolvedEntityState['entity'];
}

/**
 * `FieldChange.current`/`.desired` (`$sync/preview/types.ts`) are internally typed
 * `unknown` -- a diff can carry any JSON-shaped value -- while the generated
 * `FieldChange` OpenAPI schema types them as a closed JSON-value union. Same
 * wire-boundary narrowing as `toWirePayload` above; the two shapes are identical once
 * serialized to JSON.
 */
function toWireOverrides(overrides: readonly FieldChange[]): ResolvedEntityState['overrides'] {
  return overrides as unknown as ResolvedEntityState['overrides'];
}

/**
 * PCD cache tables are opened with `int64: true` (see `PCDCache`), so some integer
 * columns can come back as `bigint`. `json()` calls `JSON.stringify` internally, which
 * throws on `bigint` -- coerce any bigint (every resolved-config value is well within
 * the safe-integer range) to `number` before handing the payload off.
 */
function sanitizeBigInts<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, val) => (typeof val === 'bigint' ? Number(val) : val))) as T;
}

/**
 * Reads a single entity from `cache`, resolving a plain not-found miss to `null`
 * instead of throwing -- mirrors `layerDiff.ts`'s private `readEntityOrNull`, which is
 * not exported. Still propagates `ResolvedConfigValidationError` (bad/missing arrType,
 * unmapped entityType): that is always a caller-input problem, not an absence.
 */
async function readEntityOrNull(
  cache: PCDCache,
  entityType: ResolvedEntityType,
  arrType: ArrAppType | undefined,
  name: string
): Promise<ResolvedEntityPayload | null> {
  try {
    return await readResolvedEntity(cache, entityType, arrType, name);
  } catch (error) {
    if (isResolvedConfigValidationError(error)) {
      throw error;
    }
    return null;
  }
}

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
    let entities: ResolvedEntityState[];

    if (layerParam === 'resolved') {
      // Deliberately NOT routed through `resolveLayerState`: that would re-run
      // `pcdOpHistoryQueries.listLatestConflictsByDatabase` once per entity in this
      // loop for no benefit (the underlying entity read is unchanged), regressing list
      // performance for large entity sets. hasPendingConflict stays `false` here; the
      // named endpoint (single entity, no loop) computes it accurately via
      // `resolveLayerState` instead.
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
            hasPendingConflict: false,
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
              hasPendingConflict: computeHasPendingConflict(databaseId, entityType, arrType, name),
            } satisfies ResolvedEntityState;
          })
        );
      });
    } else {
      // layer === 'user': names come from the resolved cache (a superset of base --
      // includes user-created entities absent from base), the base-only cache is built
      // ONCE and reused for every name's diff.
      const names = await listResolvedEntityNames(cache, entityType, arrType);
      entities = await withBaseOnlyCache(databaseId, (baseCache) =>
        Promise.all(
          names.map(async (name) => {
            const resolvedEntity = await readResolvedEntity(cache, entityType, arrType, name);
            const baseEntity = await readEntityOrNull(baseCache, entityType, arrType, name);
            return {
              databaseId,
              entityType,
              name,
              layer: 'user',
              present: true,
              overrides: toWireOverrides(computeUserOverrides(baseEntity, resolvedEntity)),
              hasPendingConflict: computeHasPendingConflict(databaseId, entityType, arrType, name),
            } satisfies ResolvedEntityState;
          })
        )
      );
    }

    const response = {
      databaseId,
      entityType,
      layer: layerParam,
      entities,
    } satisfies ResolvedEntityListResponse;

    return json(sanitizeBigInts(response));
  } catch (error) {
    if (isResolvedConfigValidationError(error)) {
      return json({ error: error.message } satisfies ErrorResponse, { status: 400 });
    }

    await logger.error('Failed to list resolved config entities', {
      source: 'pcd/resolved/[entityType]',
      meta: { databaseId, entityType, error: error instanceof Error ? error.message : String(error) },
    });

    return json({ error: 'Failed to read resolved config state' } satisfies ErrorResponse, { status: 500 });
  }
};
