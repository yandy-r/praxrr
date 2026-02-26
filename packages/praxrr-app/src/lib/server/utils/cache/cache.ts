/**
 * Simple in-memory cache with TTL
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export interface ArrLibraryCacheKey {
  instanceId: number;
}

export const LIBRARY_CACHE_KEY_PREFIX = 'library';

/**
 * Builds a full cache key string for an Arr library entry using the instance ID.
 *
 * @param instanceId - The Arr instance ID to build the key for
 * @returns The full cache key string for the library entry
 */
export function buildArrLibraryCacheKey({ instanceId }: ArrLibraryCacheKey): string {
  return `${LIBRARY_CACHE_KEY_PREFIX}:${instanceId}:`;
}

/**
 * Returns the key prefix for all library cache entries belonging to a specific instance.
 *
 * @param instanceId - The Arr instance ID to build the prefix for
 * @returns The key prefix string for the instance's library cache entries
 */
export function getArrLibraryCachePrefix(instanceId: number): string {
  return `${LIBRARY_CACHE_KEY_PREFIX}:${instanceId}:`;
}

class Cache {
  private store = new Map<string, CacheEntry<unknown>>();

  /**
   * Get a cached value
   */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    return entry.data;
  }

  /**
   * Set a cached value with TTL in seconds
   */
  set<T>(key: string, data: T, ttlSeconds: number): void {
    this.store.set(key, {
      data,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  /**
   * Delete a cached value
   */
  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /**
   * Delete all cached values matching a prefix
   */
  deleteByPrefix(prefix: string): number {
    let count = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Clear all cached values
   */
  clear(): void {
    this.store.clear();
  }
}

export const cache = new Cache();
