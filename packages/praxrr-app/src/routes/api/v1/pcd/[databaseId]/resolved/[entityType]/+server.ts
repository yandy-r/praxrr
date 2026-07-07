import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import {
  ARR_AGNOSTIC_READERS,
  isResolvedConfigValidationError,
  listResolvedEntityNames,
  pcdManager,
  PER_ARR_READERS,
  readResolvedEntity,
} from '$pcd/index.ts';
import type { ResolvedEntityPayload, ResolvedEntityType } from '$pcd/index.ts';
import { isArrAppType } from '$shared/arr/capabilities.ts';
import type { ArrAppType } from '$shared/pcd/types.ts';
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
 * PCD cache tables are opened with `int64: true` (see `PCDCache`), so some integer
 * columns can come back as `bigint`. `json()` calls `JSON.stringify` internally, which
 * throws on `bigint` -- coerce any bigint (every resolved-config value is well within
 * the safe-integer range) to `number` before handing the payload off.
 */
function sanitizeBigInts<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, val) => (typeof val === 'bigint' ? Number(val) : val))) as T;
}

/**
 * GET /api/v1/pcd/{databaseId}/resolved/{entityType}
 *
 * Lists resolved config state for every entity of the given type in the PCD
 * database, for the selected layer (`layer=resolved` only -- Task 3.1 wires
 * `layer=base|user`).
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
  if (layerParam === 'base' || layerParam === 'user') {
    // TODO(Task 3.1): wire layer=base|user via resolveLayerState (layers.ts + layerDiff.ts).
    return json({ error: 'layer not yet supported' } satisfies ErrorResponse, { status: 400 });
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
    const names = await listResolvedEntityNames(cache, entityType, arrType);
    const entities: ResolvedEntityState[] = await Promise.all(
      names.map(async (name) => {
        const entity = await readResolvedEntity(cache, entityType, arrType, name);
        return {
          databaseId,
          entityType,
          name,
          layer: 'resolved',
          present: true,
          entity: toWirePayload(entity),
          // TODO(Task 3.1): flag true when pcdOpHistoryQueries.listLatestConflictsByDatabase
          // reports a pending value-guard conflict targeting this entity (Business Rule 6).
          hasPendingConflict: false,
        } satisfies ResolvedEntityState;
      })
    );

    const response = {
      databaseId,
      entityType,
      layer: 'resolved',
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
