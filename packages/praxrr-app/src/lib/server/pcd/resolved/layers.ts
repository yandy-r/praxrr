/**
 * Resolved Config Layers
 *
 * `withBaseOnlyCache` is the single entry point for building an ephemeral,
 * schema+base+tweaks-only replay of a PCD (i.e. "what does this database look like
 * before any user overrides are applied"). It exists solely to answer `layer=base` /
 * `layer=user` reads in `layerDiff.ts` -- it is never registered in the cache registry
 * (`database/registry.ts`'s `setCache`) and is rebuilt fresh on every call (no
 * memoization in v1; KISS -- see the plan's Task 2.2 note).
 *
 * The ephemeral cache's lifecycle is entirely owned by this function: it is
 * constructed, built, handed to `fn`, and ALWAYS closed afterward, whether `fn`
 * resolves or throws.
 */

import { PCDCache } from '../database/cache.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { logger } from '$logger/logger.ts';

const SOURCE = 'ResolvedConfigLayers';

/** The layer set that constitutes "base" -- everything except user-origin ops. */
const BASE_ONLY_LAYERS = new Set<'schema' | 'base' | 'tweaks' | 'user'>(['schema', 'base', 'tweaks']);

/**
 * Thrown when `databaseId` does not resolve to a known database instance. Distinct
 * from `ResolvedConfigValidationError` (readers.ts, reserved for entityType/arrType
 * caller-input problems) -- callers that reach this point are expected to have
 * already validated `databaseId` against a registered, built cache (see the parity
 * handler pattern), so this only fires on an inconsistent/rescinded database row.
 */
export class ResolvedConfigDatabaseNotFoundError extends Error {
  constructor(databaseId: number) {
    super(`Database instance ${databaseId} not found`);
    this.name = 'ResolvedConfigDatabaseNotFoundError';
  }
}

/**
 * Builds a fresh, read-only, schema+base+tweaks-only `PCDCache` for `databaseId`, runs
 * `fn` against it, and always closes the cache afterward -- including when `fn` throws.
 *
 * The cache is:
 * - built per call (no caching/memoization);
 * - NEVER registered via `setCache()` -- it must not be discoverable through
 *   `pcdManager.getCache()`/the cache registry;
 * - owned end-to-end by this function; callers never see the raw `PCDCache` outside
 *   the lifetime of `fn`.
 */
export async function withBaseOnlyCache<T>(databaseId: number, fn: (cache: PCDCache) => Promise<T>): Promise<T> {
  const instance = databaseInstancesQueries.getById(databaseId);
  if (!instance) {
    throw new ResolvedConfigDatabaseNotFoundError(databaseId);
  }

  const cache = new PCDCache(instance.local_path, databaseId);
  const startTime = performance.now();
  try {
    await cache.buildReadOnly({ layers: BASE_ONLY_LAYERS });
    return await fn(cache);
  } finally {
    cache.close();
    await logger.debug('withBaseOnlyCache: ephemeral base-only cache closed', {
      source: SOURCE,
      meta: { databaseId, timingMs: Math.round(performance.now() - startTime) },
    });
  }
}
