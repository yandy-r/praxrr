/**
 * Client-side library cache store
 * Persists library data across navigations to avoid refetching on every page load
 */

import { writable, get } from 'svelte/store';
import type { RadarrLibraryItem, SonarrLibraryItem } from '$utils/arr/types.ts';

type LibraryData = RadarrLibraryItem[] | SonarrLibraryItem[];

interface LibraryCacheEntry {
  data: LibraryData;
  profilesByDatabase: { databaseId: number; databaseName: string; profiles: string[] }[];
  fetchedAt: number;
}

interface LibraryCacheState {
  entries: Map<number, LibraryCacheEntry>;
}

function createLibraryCacheStore() {
  const { subscribe, update } = writable<LibraryCacheState>({
    entries: new Map(),
  });

  return {
    subscribe,

    /**
     * Get cached library data for an instance
     */
    get(instanceId: number): LibraryCacheEntry | undefined {
      const state = get({ subscribe });
      return state.entries.get(instanceId);
    },

    /**
     * Check if we have valid cached data for an instance
     */
    has(instanceId: number): boolean {
      const state = get({ subscribe });
      return state.entries.has(instanceId);
    },

    /**
     * Store library data for an instance
     */
    set(instanceId: number, data: LibraryData, profilesByDatabase: LibraryCacheEntry['profilesByDatabase']): void {
      update((state) => {
        const newEntries = new Map(state.entries);
        newEntries.set(instanceId, {
          data,
          profilesByDatabase,
          fetchedAt: Date.now(),
        });
        return { entries: newEntries };
      });
    },

    /**
     * Invalidate cache for a specific instance
     */
    invalidate(instanceId: number): void {
      update((state) => {
        const newEntries = new Map(state.entries);
        newEntries.delete(instanceId);
        return { entries: newEntries };
      });
    },

    /**
     * Clear all cached data
     */
    clear(): void {
      update(() => ({ entries: new Map() }));
    },

    /**
     * Get the age of cached data in seconds
     */
    getAge(instanceId: number): number | null {
      const entry = this.get(instanceId);
      if (!entry) return null;
      return Math.floor((Date.now() - entry.fetchedAt) / 1000);
    },
  };
}

export const libraryCache = createLibraryCacheStore();
