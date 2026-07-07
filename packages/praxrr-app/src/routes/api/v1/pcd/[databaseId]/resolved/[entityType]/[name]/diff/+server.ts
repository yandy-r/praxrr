import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import { ARR_AGNOSTIC_READERS, computeLiveDiff, PER_ARR_READERS, pcdManager } from '$pcd/index.ts';
import type { ResolvedEntityType } from '$pcd/index.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { isArrAppType } from '$shared/arr/capabilities.ts';
import type { EntityChange } from '$sync/preview/types.ts';
import { registerPreviewCreateAttempt } from '$sync/preview/limits.ts';
import { logger } from '$logger/logger.ts';

type ResolvedLiveDiffResponse = components['schemas']['ResolvedLiveDiffResponse'];
type ErrorResponse = components['schemas']['ErrorResponse'];

const SOURCE = 'pcd/resolved/[entityType]/[name]/diff';

// readers.ts is the single source of truth for which entity types exist -- derive the
// known-entityType set from its dispatch tables instead of re-declaring the union here
// (mirrors the sibling list/named endpoints).
const RESOLVED_ENTITY_TYPES: ReadonlySet<string> = new Set<string>([
  ...Object.keys(ARR_AGNOSTIC_READERS),
  ...Object.keys(PER_ARR_READERS),
]);

function isKnownResolvedEntityType(value: string): value is ResolvedEntityType {
  return RESOLVED_ENTITY_TYPES.has(value);
}

/**
 * Testable dependency seam for `computeLiveDiff`, mirroring `_serializeDependencies` /
 * `_deserializeDependencies` in `pcd/export/+server.ts` / `pcd/import/+server.ts`.
 * `computeLiveDiff` is a bare named function export -- its ESM binding cannot be
 * monkey-patched directly from a test file -- so route tests instead patch this
 * object's property via the established `patchTarget` idiom.
 */
export const _liveDiffDependencies = {
  computeLiveDiff,
};

/**
 * `EntityChange.fields[].current`/`.desired` (`$sync/preview/types.ts`) are internally
 * typed `unknown`, while the generated `EntityChange`/`FieldChange` OpenAPI schemas type
 * them as a closed JSON-value union. Same wire-boundary narrowing as the sibling named
 * endpoint's `toWirePayload`/`toWireOverrides` -- the two shapes are identical once
 * serialized to JSON.
 */
function toWireChange(change: EntityChange): ResolvedLiveDiffResponse['changes'][number] {
  return change as unknown as ResolvedLiveDiffResponse['changes'][number];
}

/**
 * PCD cache tables are opened with `int64: true`, so integer columns can come back as
 * `bigint` elsewhere in this feature; `json()` throws on `bigint` via `JSON.stringify`.
 * Kept for parity with the sibling endpoints even though this response is not sourced
 * from the PCD cache directly.
 */
function sanitizeBigInts<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, val) => (typeof val === 'bigint' ? Number(val) : val))) as T;
}

/**
 * GET /api/v1/pcd/{databaseId}/resolved/{entityType}/{name}/diff
 *
 * Computes the desired-vs-actual field diff for a single named entity on one Arr
 * instance, via the sync-preview section syncer filtered to the entity
 * (namespace-suffix aware). An empty `EntityChange.fields` array (inside the single
 * `changes` row) means the entity is in sync; this is never conflatable with a failed
 * check, which is instead reported via a non-200 status.
 *
 * Path params:
 * - databaseId: PCD database ID
 * - entityType: resolved config entity type
 * - name: entity name
 *
 * Query params:
 * - instanceId: Arr instance ID to diff resolved state against (required)
 *
 * There is no `arrType` query param here (unlike the list/named endpoints) -- the
 * target instance determines the arr type, per docs/api/v1/paths/resolved-config.yaml.
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
    // problem here, matching the sibling list/named endpoints.
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

  const instanceIdParam = url.searchParams.get('instanceId');
  if (!instanceIdParam || !/^\d+$/.test(instanceIdParam)) {
    return json({ error: 'Invalid instanceId' } satisfies ErrorResponse, { status: 400 });
  }
  const instanceId = Number.parseInt(instanceIdParam, 10);

  const instance = arrInstancesQueries.getById(instanceId);
  if (!instance) {
    return json({ error: 'Arr instance not found' } satisfies ErrorResponse, { status: 404 });
  }

  const nowMs = Date.now();
  if (!registerPreviewCreateAttempt(instanceId, nowMs)) {
    return json(
      { error: 'Too many live diff requests for this instance. Please retry shortly.' } satisfies ErrorResponse,
      { status: 429 }
    );
  }

  try {
    const result = await _liveDiffDependencies.computeLiveDiff({ instance, entityType, name, nowMs });

    if (!result.found) {
      if (result.reason === 'unsupported') {
        return json(
          {
            error: `Entity type "${entityType}" is unsupported for live diff against instance "${instance.name}"`,
          } satisfies ErrorResponse,
          { status: 400 }
        );
      }

      if (result.reason === 'not_found') {
        return json({ error: `Entity "${name}" not found` } satisfies ErrorResponse, { status: 404 });
      }

      // 'unreachable' | 'timeout' | 'unauthorized' | 'invalid_response' | 'error':
      // computeLiveDiff already logged full detail server-side -- only the sanitized
      // reason is safe to log/echo here.
      await logger.error('Live diff request failed', {
        source: SOURCE,
        meta: { databaseId, entityType, name, instanceId, reason: result.reason },
      });
      return json({ error: 'Failed to compute live diff' } satisfies ErrorResponse, { status: 500 });
    }

    if (!isArrAppType(instance.type)) {
      // Should not happen: computeLiveDiff only succeeds for radarr/sonarr/lidarr
      // instances. Defensive guard to keep `arrType` strictly typed on the response.
      await logger.error('Live diff succeeded for an instance with an unrecognized arr type', {
        source: SOURCE,
        meta: { databaseId, entityType, name, instanceId },
      });
      return json({ error: 'Failed to compute live diff' } satisfies ErrorResponse, { status: 500 });
    }

    const response: ResolvedLiveDiffResponse = {
      databaseId,
      entityType,
      name,
      instanceId,
      arrType: instance.type,
      changes: [toWireChange(result.change)],
    } satisfies ResolvedLiveDiffResponse;

    return json(sanitizeBigInts(response));
  } catch (error) {
    await logger.error('Failed to compute resolved config live diff', {
      source: SOURCE,
      meta: { databaseId, entityType, name, instanceId, error: error instanceof Error ? error.message : String(error) },
    });

    return json({ error: 'Failed to compute live diff' } satisfies ErrorResponse, { status: 500 });
  }
};
