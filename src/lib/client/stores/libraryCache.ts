/**
 * Client-side library cache store
 * Persists library data across navigations to avoid refetching on every page load
 */

import { get, writable } from "svelte/store";
import type {
  LidarrLibraryItem,
  RadarrLibraryItem,
  SonarrLibraryItem,
} from "$utils/arr/types.ts";

type LibraryCacheSortDirection = "asc" | "desc";

interface LibraryCacheRequest {
  page: number;
  pageSize: number;
  query?: string;
  sortKey?: string;
  sortDirection?: LibraryCacheSortDirection;
}

type LibraryData =
  | RadarrLibraryItem[]
  | SonarrLibraryItem[]
  | LidarrLibraryItem[];

interface LibraryCacheEntry {
  data: LibraryData;
  profilesByDatabase: {
    databaseId: number;
    databaseName: string;
    profiles: string[];
  }[];
  query: LibraryCacheRequest;
  totalRecords: number;
  totalPages: number;
  hasNext: boolean;
  fetchedAt: number;
}

interface LibraryCacheState {
  entries: Map<string, LibraryCacheEntry>;
}

const DEFAULT_LIBRARY_CACHE_REQUEST: LibraryCacheRequest = {
  page: 1,
  pageSize: 100,
  sortDirection: "asc",
};

function normalizeLibraryCacheQuery(
  query?: LibraryCacheRequest,
): LibraryCacheRequest {
  const normalized = {
    ...DEFAULT_LIBRARY_CACHE_REQUEST,
    ...query,
  };

  return {
    page: Number.isInteger(normalized.page) && normalized.page > 0
      ? normalized.page
      : DEFAULT_LIBRARY_CACHE_REQUEST.page,
    pageSize: Number.isInteger(normalized.pageSize) && normalized.pageSize > 0
      ? normalized.pageSize
      : DEFAULT_LIBRARY_CACHE_REQUEST.pageSize,
    query: normalized.query?.trim() || undefined,
    sortKey: normalized.sortKey?.trim() || undefined,
    sortDirection: normalized.sortDirection === "desc" ? "desc" : "asc",
  };
}

function buildLibraryCacheKey(
  instanceId: number,
  request: LibraryCacheRequest,
): string {
  const params = new URLSearchParams();
  params.set("page", String(request.page));
  params.set("pageSize", String(request.pageSize));

  if (request.query) {
    params.set("query", request.query);
  }

  if (request.sortKey) {
    params.set("sortKey", request.sortKey);
  }

  if (request.sortDirection) {
    params.set("sortDirection", request.sortDirection);
  }

  return `${instanceId}|${params.toString()}`;
}

function getInstanceEntries(
  entries: Map<string, LibraryCacheEntry>,
  instanceId: number,
): [string, LibraryCacheEntry][] {
  const prefix = `${instanceId}|`;
  const matching: [string, LibraryCacheEntry][] = [];

  for (const [key, entry] of entries) {
    if (key.startsWith(prefix)) {
      matching.push([key, entry]);
    }
  }

  return matching;
}

function getLatestEntry(
  entries: Map<string, LibraryCacheEntry>,
  instanceId: number,
): LibraryCacheEntry | undefined {
  let latestEntry: LibraryCacheEntry | undefined;

  for (const [, entry] of getInstanceEntries(entries, instanceId)) {
    if (!latestEntry || entry.fetchedAt > latestEntry.fetchedAt) {
      latestEntry = entry;
    }
  }

  return latestEntry;
}

function createLibraryCacheStore() {
  const { subscribe, update } = writable<LibraryCacheState>({
    entries: new Map(),
  });

  return {
    subscribe,

    /**
     * Get cached library data
     */
    get(
      instanceId: number,
      request?: LibraryCacheRequest,
    ): LibraryCacheEntry | undefined {
      const state = get({ subscribe });

      if (request) {
        const normalizedRequest = normalizeLibraryCacheQuery(request);
        const key = buildLibraryCacheKey(instanceId, normalizedRequest);
        return state.entries.get(key);
      }

      return getLatestEntry(state.entries, instanceId);
    },

    /**
     * Check if we have cached data
     */
    has(instanceId: number, request?: LibraryCacheRequest): boolean {
      const state = get({ subscribe });

      if (request) {
        const normalizedRequest = normalizeLibraryCacheQuery(request);
        const key = buildLibraryCacheKey(instanceId, normalizedRequest);
        return state.entries.has(key);
      }

      return getInstanceEntries(state.entries, instanceId).length > 0;
    },

    /**
     * Store library data for an instance/query combination
     */
    set(
      instanceId: number,
      data: LibraryData,
      profilesByDatabase: LibraryCacheEntry["profilesByDatabase"],
      request: LibraryCacheRequest,
      metadata: {
        totalRecords: number;
        totalPages: number;
        hasNext: boolean;
      } = {
        totalRecords: 0,
        totalPages: 0,
        hasNext: false,
      },
    ): void {
      const normalizedRequest = normalizeLibraryCacheQuery(request);
      update((state) => {
        const newEntries = new Map(state.entries);
        const key = buildLibraryCacheKey(instanceId, normalizedRequest);
        newEntries.set(key, {
          data,
          profilesByDatabase,
          query: normalizedRequest,
          totalRecords: metadata.totalRecords,
          totalPages: metadata.totalPages,
          hasNext: metadata.hasNext,
          fetchedAt: Date.now(),
        });
        return { entries: newEntries };
      });
    },

    /**
     * Build a deterministic cache key for an instance/query combination.
     */
    buildKey(instanceId: number, request: LibraryCacheRequest): string {
      const normalizedRequest = normalizeLibraryCacheQuery(request);
      return buildLibraryCacheKey(instanceId, normalizedRequest);
    },

    /**
     * Invalidate cache for a specific instance, including all query/page variants.
     */
    invalidate(instanceId: number, request?: LibraryCacheRequest): void {
      update((state) => {
        const newEntries = new Map(state.entries);

        if (request) {
          const normalizedRequest = normalizeLibraryCacheQuery(request);
          const key = buildLibraryCacheKey(instanceId, normalizedRequest);
          newEntries.delete(key);
          return { entries: newEntries };
        }

        for (const key of newEntries.keys()) {
          if (key.startsWith(`${instanceId}|`)) {
            newEntries.delete(key);
          }
        }

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
    getAge(instanceId: number, request?: LibraryCacheRequest): number | null {
      const entry = this.get(instanceId, request);
      if (!entry) return null;
      return Math.floor((Date.now() - entry.fetchedAt) / 1000);
    },
  };
}

export const libraryCache = createLibraryCacheStore();
