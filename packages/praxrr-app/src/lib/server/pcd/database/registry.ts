/**
 * PCD Cache Registry
 * Manages the global registry of compiled PCD caches
 */

import type { PCDCache } from './cache.ts';

/**
 * Cache registry - maps database instance ID to PCDCache
 */
const caches = new Map<number, PCDCache>();

/**
 * Set a cache in the registry
 */
export function setCache(databaseInstanceId: number, cache: PCDCache): void {
  caches.set(databaseInstanceId, cache);
}

/**
 * Get a compiled cache by database instance ID
 */
export function getCache(databaseInstanceId: number): PCDCache | undefined {
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
