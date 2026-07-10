/**
 * Resolved Config Route Helpers
 *
 * Shared, byte-identical helpers for the four `resolved/**` route handlers (list,
 * named, diff, compare): the known-entityType guard, the two wire-boundary narrowing
 * casts, the bigint-sanitizing `json()` wrapper, and a single typed error-to-response
 * mapper. Not a route module itself (no `+server.ts`/`load` export), so SvelteKit does
 * not treat it as a route -- safe to colocate under `resolved/`.
 *
 * Every route previously carried its own copy of these (byte-identical across three of
 * the four files) plus, on the named endpoint, an `error.message.includes('not found')`
 * string-sniff that could misclassify a non-404 failure -- `Database instance N not
 * found` (`ResolvedConfigDatabaseNotFoundError`) or `Tag not found: X` (a PCDCache SQL
 * helper miss) both satisfy `.includes('not found')` despite neither being a by-name
 * entity miss. `mapResolvedErrorToResponse` replaces that sniff with typed
 * `instanceof`/type-guard checks.
 */

import { json } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import {
  ARR_AGNOSTIC_READERS,
  isResolvedConfigValidationError,
  isResolvedEntityNotFoundError,
  PER_ARR_READERS,
  ResolvedConfigDatabaseNotFoundError,
} from '$pcd/index.ts';
import type { ResolvedEntityPayload, ResolvedEntityType } from '$pcd/index.ts';
import type { FieldChange } from '$sync/preview/types.ts';
import type { FieldLineage } from '$shared/pcd/fieldLineage.ts';
import { logger } from '$logger/logger.ts';

type ResolvedEntityState = components['schemas']['ResolvedEntityState'];
type ErrorResponse = components['schemas']['ErrorResponse'];

// ============================================================================
// ENTITY TYPE GUARD
// ============================================================================

// readers.ts is the single source of truth for which entity types exist -- derive the
// known-entityType set from its dispatch tables instead of re-declaring the union here.
export const RESOLVED_ENTITY_TYPES: ReadonlySet<string> = new Set<string>([
  ...Object.keys(ARR_AGNOSTIC_READERS),
  ...Object.keys(PER_ARR_READERS),
]);

export function isKnownResolvedEntityType(value: string): value is ResolvedEntityType {
  return RESOLVED_ENTITY_TYPES.has(value);
}

// ============================================================================
// WIRE-BOUNDARY NARROWING
// ============================================================================

/**
 * `PortableCustomFormat.conditions` is an intentionally loosely-typed "shape varies by
 * condition type" field in the contract (see docs/api/v1/schemas/pcd.yaml); the
 * generated `{ [key: string]: unknown }` item shape has no structural relationship to
 * the internal `ConditionData` interface (it declares no index signature), even though
 * the two are identical once serialized to JSON. Narrow, single-purpose cast at the
 * wire boundary -- every other field on `ResolvedEntityState` stays `satisfies`-checked.
 */
export function toWirePayload(payload: ResolvedEntityPayload): ResolvedEntityState['entity'] {
  return payload as unknown as ResolvedEntityState['entity'];
}

/**
 * `FieldChange.current`/`.desired` (`$sync/preview/types.ts`) are internally typed
 * `unknown` -- a diff can carry any JSON-shaped value -- while the generated
 * `FieldChange` OpenAPI schema types them as a closed JSON-value union. Same
 * wire-boundary narrowing as `toWirePayload` above; the two shapes are identical once
 * serialized to JSON.
 */
export function toWireOverrides(overrides: readonly FieldChange[]): ResolvedEntityState['overrides'] {
  return overrides as unknown as ResolvedEntityState['overrides'];
}

/**
 * Same wire-boundary narrowing for exact field lineage. The internal `FieldLineage`
 * (`$shared/pcd/fieldLineage.ts`) and the generated OpenAPI `FieldLineage` are identical
 * once serialized to JSON; this single-purpose cast keeps the rest of `ResolvedEntityState`
 * `satisfies`-checked.
 */
export function toWireLineage(lineage: readonly FieldLineage[]): ResolvedEntityState['lineage'] {
  return lineage as unknown as ResolvedEntityState['lineage'];
}

// ============================================================================
// BIGINT SANITIZATION
// ============================================================================

// Re-exported from the shared `$http` boundary util so the four resolved route handlers
// keep their existing `import { sanitizeBigInts } from '../shared.ts'` path while the
// implementation lives in exactly one place (also consumed by the dependency-graph
// routes). See `$http/sanitizeBigInts.ts`.
export { sanitizeBigInts } from '$http/sanitizeBigInts.ts';

// ============================================================================
// ERROR -> RESPONSE MAPPING
// ============================================================================

export interface ResolvedErrorLogContext {
  /** `logger.error`'s `source` tag, e.g. `'pcd/resolved/[entityType]'`. */
  readonly source: string;
  /** `logger.error`'s message, describing the operation that failed. */
  readonly logMessage: string;
  /** Identifying context (databaseId/entityType/name/etc.) merged into the log's `meta`; `error` is appended automatically. */
  readonly meta: Record<string, unknown>;
  /** Response body `error` text for the generic 500 fallback. Defaults to a resolved-config-generic message. */
  readonly fallbackMessage?: string;
}

/**
 * Maps an error caught from resolved-config read logic to an HTTP response, typed
 * (never string-sniffed):
 * - `ResolvedConfigValidationError` (readers.ts -- bad/missing arrType, unmapped
 *   entityType): 400, message passed through (already caller-safe).
 * - `ResolvedConfigDatabaseNotFoundError` (layers.ts -- `databaseId` has a built cache
 *   but no matching `database_instances` row): 400, fixed sanitized message. Distinct
 *   from a by-name entity miss and must never surface as 404.
 * - `ResolvedEntityNotFoundError` (readers.ts / layerDiff.ts -- a well-formed by-name
 *   miss): 404, message passed through (already caller-safe).
 * - Anything else: full detail logged server-side via `logger.error`, generic 500
 *   returned -- raw error text never reaches the response body.
 */
export async function mapResolvedErrorToResponse(
  error: unknown,
  logContext: ResolvedErrorLogContext
): Promise<Response> {
  if (isResolvedConfigValidationError(error)) {
    return json({ error: error.message } satisfies ErrorResponse, { status: 400 });
  }

  if (error instanceof ResolvedConfigDatabaseNotFoundError) {
    return json({ error: 'Database not found' } satisfies ErrorResponse, { status: 400 });
  }

  if (isResolvedEntityNotFoundError(error)) {
    return json({ error: error.message } satisfies ErrorResponse, { status: 404 });
  }

  await logger.error(logContext.logMessage, {
    source: logContext.source,
    meta: { ...logContext.meta, error: error instanceof Error ? error.message : String(error) },
  });

  return json({ error: logContext.fallbackMessage ?? 'Failed to read resolved config state' } satisfies ErrorResponse, {
    status: 500,
  });
}
