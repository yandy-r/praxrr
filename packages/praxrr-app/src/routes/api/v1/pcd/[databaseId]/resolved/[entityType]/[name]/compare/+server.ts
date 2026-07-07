import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import {
  ARR_AGNOSTIC_READERS,
  compareAcrossInstances,
  COMPARE_MAX_INSTANCES,
  isInstanceCountWithinCap,
  PER_ARR_READERS,
  pcdManager,
  registerCompareAttempt,
} from '$pcd/index.ts';
import type { CompareAcrossInstancesResult, CompareInstanceResult, ResolvedEntityType } from '$pcd/index.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import type { EntityChange } from '$sync/preview/types.ts';
import { logger } from '$logger/logger.ts';

type CrossInstanceComparisonResponse = components['schemas']['CrossInstanceComparisonResponse'];
type ResolvedInstanceStateWire = CrossInstanceComparisonResponse['instances'][number];
type ErrorResponse = components['schemas']['ErrorResponse'];

const SOURCE = 'pcd/resolved/[entityType]/[name]/compare';

// readers.ts is the single source of truth for which entity types exist -- derive the
// known-entityType set from its dispatch tables instead of re-declaring the union here
// (mirrors the sibling list/named/diff endpoints).
const RESOLVED_ENTITY_TYPES: ReadonlySet<string> = new Set<string>([
  ...Object.keys(ARR_AGNOSTIC_READERS),
  ...Object.keys(PER_ARR_READERS),
]);

function isKnownResolvedEntityType(value: string): value is ResolvedEntityType {
  return RESOLVED_ENTITY_TYPES.has(value);
}

/**
 * Testable dependency seam for `compareAcrossInstances`, mirroring `_liveDiffDependencies`
 * on the sibling diff endpoint. `compareAcrossInstances` is a bare named function export --
 * its ESM binding cannot be monkey-patched directly from a test file -- so route tests
 * instead patch this object's property via the established `patchTarget` idiom.
 */
export const _compareDependencies = {
  compareAcrossInstances,
};

/**
 * `EntityChange.fields[].current`/`.desired` (`$sync/preview/types.ts`) are internally
 * typed `unknown`, while the generated `EntityChange` OpenAPI schema types them as a
 * closed JSON-value union. Same wire-boundary narrowing as the sibling diff endpoint's
 * `toWireChange` -- the two shapes are identical once serialized to JSON.
 */
function toWireChange(change: EntityChange): components['schemas']['EntityChange'] {
  return change as unknown as components['schemas']['EntityChange'];
}

/**
 * Maps a `CompareInstanceResult` (compare.ts's internal shape) onto the generated
 * `ResolvedInstanceState` wire shape:
 * - `arrType` is `string` on `CompareInstanceResult` (it holds the raw, possibly
 *   unrecognized `arr_type` value for the `incompatible` case) -- narrowed here since the
 *   wire schema's `arrType` is a closed `radarr|sonarr|lidarr` enum.
 * - `desired` is a `Portable*` union whose nested array fields (e.g. `PortableCustomFormat`'s
 *   `conditions: ConditionData[]`) are internally typed, while the generated schema types
 *   nested arrays as a closed JSON-value index-signature shape -- same wire-boundary
 *   narrowing as `toWireChange` below; the two shapes are identical once serialized to JSON.
 * - `actual` is compare.ts's located `EntityChange` (see compare.ts module doc point 3),
 *   not the raw upstream Arr payload the OpenAPI schema's free-form `additionalProperties`
 *   shape implies -- the most information-preserving mapping available without redesigning
 *   `liveDiff.ts`.
 * - `error` is `CompareReason`, a superset of the wire `error` enum by design (see
 *   compare.ts module doc point 2); the contract was amended in this task to match the
 *   full superset, so no narrowing cast is needed here.
 */
function toWireInstance(result: CompareInstanceResult): ResolvedInstanceStateWire {
  return {
    instanceId: result.instanceId,
    instanceName: result.instanceName,
    arrType: result.arrType as ResolvedInstanceStateWire['arrType'],
    compatible: result.compatible,
    present: result.present,
    desired: result.desired as unknown as ResolvedInstanceStateWire['desired'],
    actual: result.actual as unknown as ResolvedInstanceStateWire['actual'],
    error: result.error,
  };
}

/**
 * PCD cache tables are opened with `int64: true`, so integer columns can come back as
 * `bigint` elsewhere in this feature; `json()` throws on `bigint` via `JSON.stringify`.
 * Kept for parity with the sibling endpoints.
 */
function sanitizeBigInts<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, val) => (typeof val === 'bigint' ? Number(val) : val))) as T;
}

/**
 * An "entity hard miss" is when at least one requested instance was arr_type/entity-type
 * compatible (so it was actually capable of looking the entity up), but none of the
 * compatible instances found it present. This is distinct from every instance being
 * `incompatible`/`unsupported` -- that is a degraded-but-successful comparison (200 with
 * inline per-instance statuses), not a 404, since compatibility says nothing about
 * whether the named entity exists.
 */
function isEntityHardMiss(result: CompareAcrossInstancesResult): boolean {
  const anyPresent = result.instances.some((instance) => instance.present);
  if (anyPresent) return false;

  const compatibleInstances = result.instances.filter((instance) => instance.compatible);
  if (compatibleInstances.length === 0) return false;

  return compatibleInstances.every((instance) => instance.error === 'not_found');
}

/**
 * GET /api/v1/pcd/{databaseId}/resolved/{entityType}/{name}/compare
 *
 * Computes per-instance transformed-desired payloads (and optionally live Arr state) for
 * a single named entity across up to `COMPARE_MAX_INSTANCES` Arr instances, with pairwise
 * diffs against the first compatible instance. Per-instance failures (unreachable,
 * incompatible arr_type, unsupported entity type) are reported as inline statuses on that
 * instance and never fail the whole request; only a hard miss of the named entity across
 * every compatible instance produces a 404.
 *
 * Path params:
 * - databaseId: PCD database ID
 * - entityType: resolved config entity type
 * - name: entity name
 *
 * Query params:
 * - instanceIds: comma-separated Arr instance IDs to compare (required, cap
 *   `COMPARE_MAX_INSTANCES`)
 * - includeLive: when true, also fetch live per-instance state (default false)
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
    // problem here, matching the sibling list/named/diff endpoints.
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

  const instanceIdsParam = url.searchParams.get('instanceIds');
  if (!instanceIdsParam) {
    return json({ error: 'instanceIds is required' } satisfies ErrorResponse, { status: 400 });
  }

  const rawInstanceIds = instanceIdsParam.split(',').map((part) => part.trim());
  if (rawInstanceIds.length === 0 || rawInstanceIds.some((part) => !/^\d+$/.test(part))) {
    return json({ error: 'Invalid instanceIds: each id must be a positive integer' } satisfies ErrorResponse, {
      status: 400,
    });
  }

  const instanceIds = rawInstanceIds.map((part) => Number.parseInt(part, 10));

  // Cap check happens before the per-id existence lookups below, so an oversized
  // instanceIds list is rejected without doing any DB work.
  if (!isInstanceCountWithinCap(instanceIds.length)) {
    return json(
      {
        error: `Too many instanceIds: maximum ${COMPARE_MAX_INSTANCES} instances per comparison`,
      } satisfies ErrorResponse,
      { status: 400 }
    );
  }

  const instances: ArrInstance[] = [];
  for (const instanceId of instanceIds) {
    const instance = arrInstancesQueries.getById(instanceId);
    if (!instance) {
      return json({ error: `Unknown instanceId "${instanceId}"` } satisfies ErrorResponse, { status: 400 });
    }
    instances.push(instance);
  }

  const rateLimitKey = locals.user ? String(locals.user.id) : 'global';
  if (!registerCompareAttempt(rateLimitKey)) {
    return json({ error: 'Too many comparison requests. Please retry shortly.' } satisfies ErrorResponse, {
      status: 429,
    });
  }

  const includeLive = url.searchParams.get('includeLive') === 'true';

  try {
    const result = await _compareDependencies.compareAcrossInstances({
      cache,
      databaseId,
      entityType,
      name,
      instances,
      includeLive,
      nowMs: Date.now(),
    });

    if (isEntityHardMiss(result)) {
      return json({ error: `Entity "${name}" not found` } satisfies ErrorResponse, { status: 404 });
    }

    const response: CrossInstanceComparisonResponse = {
      databaseId,
      entityType,
      name,
      instances: result.instances.map(toWireInstance),
      diffs: result.diffs.map((row) => ({
        instanceId: row.instanceId,
        changes: row.changes.map(toWireChange),
      })),
    } satisfies CrossInstanceComparisonResponse;

    return json(sanitizeBigInts(response));
  } catch (error) {
    await logger.error('Failed to compute resolved config comparison', {
      source: SOURCE,
      meta: { databaseId, entityType, name, error: error instanceof Error ? error.message : String(error) },
    });

    return json({ error: 'Failed to compute cross-instance comparison' } satisfies ErrorResponse, { status: 500 });
  }
};
