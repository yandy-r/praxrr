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
import { createLineageIndex, createLineageObserver, type LineageIndex } from './lineage/lineageIndex.ts';

const SOURCE = 'ResolvedConfigLayers';

/** The layer set that constitutes "base" -- everything except user-origin ops. */
const BASE_ONLY_LAYERS = new Set<'schema' | 'base' | 'tweaks' | 'user'>(['schema', 'base', 'tweaks']);

/** The full resolved layer set -- everything including user-origin ops. */
const ALL_LAYERS = new Set<'schema' | 'base' | 'tweaks' | 'user'>(['schema', 'base', 'tweaks', 'user']);

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
  return withEphemeralCache(databaseId, { layers: BASE_ONLY_LAYERS, label: 'base-only' }, fn);
}

/**
 * Builds a fresh, read-only, point-in-time replay of a PCD as of a snapshot (rollback,
 * issue #16). Replays the FULL layer set {schema, base, tweaks, user}, but the base/user ops
 * are exactly `snapshotOpIds` (the reconstructed published-op set for the snapshot) rather
 * than the current published ops. Same lifecycle guarantees as `withBaseOnlyCache`: never
 * registered via `setCache`, always closed.
 */
export async function withSnapshotCache<T>(
  databaseId: number,
  snapshotOpIds: ReadonlySet<number>,
  fn: (cache: PCDCache) => Promise<T>
): Promise<T> {
  return withEphemeralCache(databaseId, { layers: ALL_LAYERS, snapshotOpIds, label: 'snapshot' }, fn);
}

/**
 * Builds a fresh, read-only replay of the CURRENT resolved state (all layers, current
 * published ops). Used as the current side of a rollback preview when no registry cache is
 * built for the database. Best-effort: unlike the registered `build()` cache it applies no
 * value guards / auto-drop, so it can differ slightly from the live cache — prefer
 * `getCache(databaseId)` when it is built.
 */
export async function withCurrentCache<T>(databaseId: number, fn: (cache: PCDCache) => Promise<T>): Promise<T> {
  return withEphemeralCache(databaseId, { layers: ALL_LAYERS, label: 'current' }, fn);
}

/**
 * Builds a fresh, read-only, all-layers replay of the CURRENT resolved state with per-op
 * write capture enabled, then runs `fn` with both the cache and the populated `LineageIndex`.
 * Same lifecycle guarantees as the other `with*Cache` helpers: never registered via
 * `setCache`, always closed. Used by the field-lineage engine (issue #231).
 */
export async function withInstrumentedCache<T>(
  databaseId: number,
  fn: (cache: PCDCache, index: LineageIndex) => Promise<T>
): Promise<T> {
  const instance = databaseInstancesQueries.getById(databaseId);
  if (!instance) {
    throw new ResolvedConfigDatabaseNotFoundError(databaseId);
  }

  const cache = new PCDCache(instance.local_path, databaseId);
  const index = createLineageIndex();
  const observer = createLineageObserver(index);
  const startTime = performance.now();
  try {
    await cache.buildReadOnly({ layers: ALL_LAYERS }, { onOp: observer });
    return await fn(cache, index);
  } finally {
    cache.close();
    await logger.debug('withInstrumentedCache: ephemeral instrumented cache closed', {
      source: SOURCE,
      meta: { databaseId, timingMs: Math.round(performance.now() - startTime) },
    });
  }
}

/**
 * Shared ephemeral-cache lifecycle: build a fresh unregistered read-only cache, run `fn`
 * against it, and ALWAYS close it (whether `fn` resolves or throws). Never calls `setCache`.
 */
async function withEphemeralCache<T>(
  databaseId: number,
  options: {
    layers: ReadonlySet<'schema' | 'base' | 'tweaks' | 'user'>;
    snapshotOpIds?: ReadonlySet<number>;
    label: string;
  },
  fn: (cache: PCDCache) => Promise<T>
): Promise<T> {
  const instance = databaseInstancesQueries.getById(databaseId);
  if (!instance) {
    throw new ResolvedConfigDatabaseNotFoundError(databaseId);
  }

  const cache = new PCDCache(instance.local_path, databaseId);
  const startTime = performance.now();
  try {
    await cache.buildReadOnly({ layers: options.layers, snapshotOpIds: options.snapshotOpIds });
    return await fn(cache);
  } finally {
    cache.close();
    await logger.debug(`withEphemeralCache: ephemeral ${options.label} cache closed`, {
      source: SOURCE,
      meta: { databaseId, timingMs: Math.round(performance.now() - startTime) },
    });
  }
}
