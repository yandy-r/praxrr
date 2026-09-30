/**
 * PCD Cache Registry
 * Manages the global registry of compiled PCD caches
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { PCDCache } from './cache.ts';

/**
 * Cache registry - maps database instance ID to PCDCache
 */
const caches = new Map<number, PCDCache>();

/**
 * Per-import ephemeral cache scope. While `withScopedCache` runs, `getCache`
 * answers with the scoped cache so deep import call paths (writer validation,
 * entity deserializers) read the base-only import view. The registered cache is
 * untouched for every other reader. Lifecycle: created and closed by the owner of
 * the scope; never passed to `setCache`.
 */
const scopedCaches = new AsyncLocalStorage<Map<number, PCDCache>>();

/**
 * Run `callback` with `cache` visible to `getCache(databaseInstanceId)`.
 */
export function withScopedCache<T>(databaseInstanceId: number, cache: PCDCache, callback: () => T): T {
  const parent = scopedCaches.getStore() ?? new Map<number, PCDCache>();
  const next = new Map(parent);
  next.set(databaseInstanceId, cache);
  return scopedCaches.run(next, callback);
}

/**
 * True while `databaseInstanceId` is inside a `withScopedCache` block.
 */
export function isCacheScoped(databaseInstanceId: number): boolean {
  return (scopedCaches.getStore()?.get(databaseInstanceId) ?? undefined) !== undefined;
}

/**
 * Set a cache in the registry
 */
export function setCache(databaseInstanceId: number, cache: PCDCache): void {
  caches.set(databaseInstanceId, cache);
}

/**
 * Get a compiled cache by database instance ID.
 *
 * Answers the scoped (ephemeral import) cache first when running inside
 * `withScopedCache`; otherwise the registered cache. Code that must always see
 * the registered cache (compile/invalidate) uses `getRegisteredCache`.
 */
export function getCache(databaseInstanceId: number): PCDCache | undefined {
  return scopedCaches.getStore()?.get(databaseInstanceId) ?? caches.get(databaseInstanceId);
}

/**
 * Get the registered cache only, ignoring any `withScopedCache` override.
 */
export function getRegisteredCache(databaseInstanceId: number): PCDCache | undefined {
  return caches.get(databaseInstanceId);
}

/**
 * Check if a cache exists for a database instance
 */
export function hasCache(databaseInstanceId: number): boolean {
  return caches.has(databaseInstanceId);
}

/**
 * Delete a cache from the registry
 */
export function deleteCache(databaseInstanceId: number): boolean {
  return caches.delete(databaseInstanceId);
}

/**
 * Get all currently cached database instance IDs (for debugging)
 */
export function getCachedDatabaseIds(): number[] {
  return Array.from(caches.keys());
}

/**
 * Clear all caches from the registry
 */
export function clearAllCaches(): void {
  for (const cache of caches.values()) {
    cache.close();
  }
  caches.clear();
}
