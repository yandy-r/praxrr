/**
 * Dependency Graph Route Helpers
 *
 * Shared helpers for the two `graph/**` route handlers (full graph, per-node impact):
 * the 4-value graph arrType guard, the bigint-sanitizing `json()` wrapper (re-exported
 * from the shared `$http` util), and a single typed error-to-response mapper. Not a route
 * module itself (no `+server.ts`/`load` export), so SvelteKit does not treat it as a
 * route -- safe to colocate under `graph/`.
 */

import { json } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import { isGraphDatabaseNotFoundError, isGraphNodeNotFoundError, isGraphValidationError } from '$pcd/index.ts';
import type { GraphArrType } from '$pcd/index.ts';
import { logger } from '$logger/logger.ts';

// The dependency-graph routes return cache-derived (int64) payloads, same as
// resolved-config -- share the single bigint-sanitizing wrapper.
export { sanitizeBigInts } from '$http/sanitizeBigInts.ts';

type ErrorResponse = components['schemas']['ErrorResponse'];

// ============================================================================
// GRAPH ARR TYPE GUARD (4-value: includes `all`)
// ============================================================================

/**
 * The dependency-graph `arrType` filter is the 4-value `ArrType` (`all` is a first-class
 * edge scope), NOT the 3-value `ArrAppType` used elsewhere -- keep a dedicated guard so a
 * caller passing `all` is accepted here but never treated as a per-arr app.
 */
const GRAPH_ARR_TYPES: readonly GraphArrType[] = ['radarr', 'sonarr', 'lidarr', 'all'];
const GRAPH_ARR_TYPE_SET: ReadonlySet<string> = new Set<string>(GRAPH_ARR_TYPES);

export function isGraphArrType(value: string): value is GraphArrType {
  return GRAPH_ARR_TYPE_SET.has(value);
}

// ============================================================================
// ERROR -> RESPONSE MAPPING
// ============================================================================

export interface GraphErrorLogContext {
  /** `logger.error`'s `source` tag, e.g. `'pcd/graph'`. */
  readonly source: string;
  /** `logger.error`'s message, describing the operation that failed. */
  readonly logMessage: string;
  /** Identifying context (databaseId/nodeKind/name/etc.) merged into the log's `meta`; `error` is appended automatically. */
  readonly meta: Record<string, unknown>;
  /** Response body `error` text for the generic 500 fallback. */
  readonly fallbackMessage?: string;
}

/**
 * Maps an error caught from dependency-graph logic to an HTTP response, typed (never
 * string-sniffed):
 * - `GraphValidationError`: 400, message passed through (already caller-safe).
 * - `GraphDatabaseNotFoundError`: 400, message passed through. Deliberately not 404 --
 *   an unknown/unbuilt database is a caller-input problem with no sibling fallback.
 * - `GraphNodeNotFoundError`: 404, message passed through (echoes the requested name).
 * - Anything else: full detail logged server-side, generic 500 -- raw error text never
 *   reaches the response body.
 */
export async function mapGraphErrorToResponse(error: unknown, logContext: GraphErrorLogContext): Promise<Response> {
  if (isGraphValidationError(error)) {
    return json({ error: error.message } satisfies ErrorResponse, { status: 400 });
  }

  if (isGraphDatabaseNotFoundError(error)) {
    return json({ error: error.message } satisfies ErrorResponse, { status: 400 });
  }

  if (isGraphNodeNotFoundError(error)) {
    return json({ error: error.message } satisfies ErrorResponse, { status: 404 });
  }

  await logger.error(logContext.logMessage, {
    source: logContext.source,
    meta: { ...logContext.meta, error: error instanceof Error ? error.message : String(error) },
  });

  return json({ error: logContext.fallbackMessage ?? 'Failed to read dependency graph' } satisfies ErrorResponse, {
    status: 500,
  });
}
