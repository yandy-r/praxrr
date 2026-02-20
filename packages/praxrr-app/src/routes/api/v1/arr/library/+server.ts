import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import type {
  ArrType,
  RadarrLibraryItem as RuntimeRadarrLibraryItem,
  SonarrLibraryItem as RuntimeSonarrLibraryItem,
  LidarrLibraryItem as RuntimeLidarrLibraryItem,
} from '$utils/arr/types.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { pcdManager } from '$pcd/index.ts';
import * as qualityProfileQueries from '$pcd/entities/qualityProfiles/index.ts';
import { cache, buildArrLibraryCacheKey, getArrLibraryCachePrefix } from '$cache/cache.ts';
import { getArrInstanceClient } from '$arr/arrInstanceClients.ts';
import type { LidarrClient } from '$utils/arr/clients/lidarr.ts';
import type { RadarrClient } from '$utils/arr/clients/radarr.ts';
import type { SonarrClient } from '$utils/arr/clients/sonarr.ts';
import { logger } from '$logger/logger.ts';

type LibraryResponse = components['schemas']['LibraryResponse'];
type ProfileByDatabase = components['schemas']['ProfileByDatabase'];
type ErrorResponse = components['schemas']['ErrorResponse'];

type SortDirection = 'asc' | 'desc';

type LibraryItem = RuntimeRadarrLibraryItem | RuntimeSonarrLibraryItem | RuntimeLidarrLibraryItem;

type LibraryQuery = {
  page: number;
  pageSize: number;
  query?: string;
  sortKey?: string;
  sortDirection: SortDirection;
};

const LIBRARY_CACHE_TTL = 300; // 5 minutes
const LIBRARY_DEFAULT_PAGE = 1;
const LIBRARY_DEFAULT_PAGE_SIZE = 100;
const LIBRARY_MAX_PAGE_SIZE = 250;
const LIBRARY_DEFAULT_SORT_DIRECTION = 'asc';
const LIBRARY_SORT_KEYS_BY_TYPE = {
  radarr: new Set([
    'id',
    'title',
    'year',
    'qualityProfileName',
    'qualityName',
    'qualityScore',
    'customFormatScore',
    'progress',
    'popularity',
    'dateAdded',
  ]),
  sonarr: new Set([
    'id',
    'title',
    'year',
    'qualityProfileName',
    'status',
    'percentOfEpisodes',
    'episodeCount',
    'seasonCount',
    'dateAdded',
  ]),
  lidarr: new Set([
    'id',
    'title',
    'artistName',
    'year',
    'qualityProfileName',
    'status',
    'percentOfTracks',
    'trackCount',
    'dateAdded',
  ]),
} as const;

function parseLibraryQuery(url: URL): LibraryQuery {
  const page = parsePageSizeOrPage(url.searchParams.get('page'), LIBRARY_DEFAULT_PAGE, 1, 'page');
  const pageSize = parsePageSizeOrPage(
    url.searchParams.get('pageSize'),
    LIBRARY_DEFAULT_PAGE_SIZE,
    1,
    'pageSize',
    LIBRARY_MAX_PAGE_SIZE
  );

  const sortDirectionRaw = url.searchParams.get('sortDirection');
  const sortDirection = parseSortDirection(sortDirectionRaw);

  const sortKey = url.searchParams.get('sortKey')?.trim() || undefined;
  const query = url.searchParams.get('query')?.trim() || undefined;

  return {
    page,
    pageSize,
    query: query?.length ? query : undefined,
    sortKey: sortKey?.length ? sortKey : undefined,
    sortDirection,
  };
}

function parsePageSizeOrPage(raw: string | null, fallback: number, min: number, name: string, max?: number): number {
  if (!raw) {
    return fallback;
  }

  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error(`Invalid ${name}`);
  }

  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`Invalid ${name}`);
  }

  if (max !== undefined && value > max) {
    return max;
  }

  return value;
}

function parseSortDirection(raw: string | null): SortDirection {
  if (!raw) {
    return LIBRARY_DEFAULT_SORT_DIRECTION;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized !== 'asc' && normalized !== 'desc') {
    throw new Error('Invalid sortDirection');
  }

  return normalized;
}

function validateSortKey(type: 'radarr' | 'sonarr' | 'lidarr', sortKey: string | undefined): void {
  if (!sortKey) {
    return;
  }

  if (!LIBRARY_SORT_KEYS_BY_TYPE[type].has(sortKey)) {
    throw new Error('Invalid sortKey');
  }
}

function getSearchableText(item: LibraryItem): string {
  return [
    item.title,
    'artistName' in item && typeof item.artistName === 'string' ? item.artistName : undefined,
    item.qualityProfileName,
    'qualityName' in item && typeof item.qualityName === 'string' ? item.qualityName : undefined,
    'status' in item && typeof item.status === 'string' ? item.status : undefined,
    item.year,
    item.id,
  ]
    .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
    .map((value) => String(value).toLowerCase())
    .join(' ');
}

function resolveSortValue(item: LibraryItem, sortKey: string): unknown {
  if (sortKey in item) {
    return (item as unknown as Record<string, unknown>)[sortKey];
  }

  return undefined;
}

function compareSortValues(a: unknown, b: unknown): number {
  if (a === b) {
    return 0;
  }

  if (a === undefined || a === null) {
    return 1;
  }

  if (b === undefined || b === null) {
    return -1;
  }

  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }

  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return Number(a) - Number(b);
  }

  return String(a).localeCompare(String(b));
}

function applyLibraryQueryAndPagination<T extends LibraryItem>(
  items: T[],
  query: LibraryQuery,
  sortKeys: ReadonlySet<string>
): {
  items: T[];
  page: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
  hasNext: boolean;
} {
  const queryText = query.query?.trim().toLowerCase();

  const filteredItems = queryText ? items.filter((item) => getSearchableText(item).includes(queryText)) : [...items];

  const sortedItems =
    query.sortKey && sortKeys.has(query.sortKey)
      ? [...filteredItems]
          .map((item, index) => ({ item, index }))
          .sort((a, b) => {
            const compare = compareSortValues(
              resolveSortValue(a.item, query.sortKey as string),
              resolveSortValue(b.item, query.sortKey as string)
            );

            if (compare !== 0) {
              return query.sortDirection === 'asc' ? compare : -compare;
            }

            return a.index - b.index;
          })
          .map((entry) => entry.item)
      : [...filteredItems];

  const totalRecords = sortedItems.length;
  const totalPages = totalRecords === 0 ? 0 : Math.ceil(totalRecords / query.pageSize);
  const start = (query.page - 1) * query.pageSize;
  const end = start + query.pageSize;

  return {
    items: sortedItems.slice(start, end),
    page: query.page,
    pageSize: query.pageSize,
    totalRecords,
    totalPages,
    hasNext: query.page < totalPages,
  };
}

/**
 * Get all quality profile names from all enabled Praxrr databases
 */
async function getPraxrrProfileNames(): Promise<Set<string>> {
  const profileNames = new Set<string>();
  const databases = pcdManager.getAll().filter((db) => db.enabled);

  for (const db of databases) {
    const dbCache = pcdManager.getCache(db.id);
    if (!dbCache?.isBuilt()) continue;

    try {
      const names = await qualityProfileQueries.names(dbCache);
      for (const name of names) {
        profileNames.add(name);
      }
    } catch {
      // Cache query failed, skip this database
    }
  }

  return profileNames;
}

/**
 * Get profiles grouped by database
 */
async function getProfilesByDatabase(): Promise<ProfileByDatabase[]> {
  const profilesByDatabase: ProfileByDatabase[] = [];
  const databases = pcdManager.getAll().filter((db) => db.enabled);

  for (const db of databases) {
    const dbCache = pcdManager.getCache(db.id);
    if (!dbCache?.isBuilt()) continue;

    try {
      const names = await qualityProfileQueries.names(dbCache);
      profilesByDatabase.push({
        databaseId: db.id,
        databaseName: db.name,
        profiles: names,
      });
    } catch {
      // Skip if cache query fails
    }
  }

  return profilesByDatabase;
}

/**
 * GET /api/v1/arr/library
 *
 * Get the full library from an Arr instance with quality profile,
 * score, and progress information.
 *
 * Query params:
 * - instanceId: Arr instance ID (required)
 * - page: page number (default 1)
 * - pageSize: max 250, default 100
 */
export const GET: RequestHandler = async ({ url }) => {
  const instanceId = url.searchParams.get('instanceId');

  if (!instanceId) {
    return json({ error: 'instanceId is required' } satisfies ErrorResponse, { status: 400 });
  }

  const id = parseInt(instanceId, 10);
  if (isNaN(id)) {
    return json({ error: 'Invalid instanceId' } satisfies ErrorResponse, { status: 400 });
  }

  const instance = arrInstancesQueries.getById(id);
  if (!instance) {
    return json({ error: 'Instance not found' } satisfies ErrorResponse, { status: 404 });
  }

  let libraryQuery: LibraryQuery;
  try {
    libraryQuery = parseLibraryQuery(url);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Invalid query parameters' }, { status: 400 });
  }

  const cacheKey = buildArrLibraryCacheKey({ instanceId: id });

  const profilesByDatabase = await getProfilesByDatabase();

  try {
    if (instance.type === 'radarr') {
      try {
        validateSortKey('radarr', libraryQuery.sortKey);
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : 'Invalid sortKey' }, { status: 400 });
      }

      const cached = cache.get<RuntimeRadarrLibraryItem[]>(cacheKey);
      if (cached) {
        const paginated = applyLibraryQueryAndPagination(cached, libraryQuery, LIBRARY_SORT_KEYS_BY_TYPE.radarr);
        return json({
          type: 'radarr',
          items: paginated.items,
          profilesByDatabase,
          page: paginated.page,
          pageSize: paginated.pageSize,
          totalRecords: paginated.totalRecords,
          totalPages: paginated.totalPages,
          hasNext: paginated.hasNext,
        } satisfies LibraryResponse);
      }

      const praxrrProfileNames = await getPraxrrProfileNames();
      const client = (await getArrInstanceClient(instance.type as ArrType, instance.id, instance.url)) as RadarrClient;
      try {
        const items = await client.getLibrary(praxrrProfileNames);
        cache.set(cacheKey, items, LIBRARY_CACHE_TTL);
        const paginated = applyLibraryQueryAndPagination(items, libraryQuery, LIBRARY_SORT_KEYS_BY_TYPE.radarr);

        await logger.info(`Fetched library for ${instance.name}`, {
          source: 'arr/library',
          meta: { instanceId: id, movieCount: items.length },
        });

        return json({
          type: 'radarr',
          items: paginated.items,
          profilesByDatabase,
          page: paginated.page,
          pageSize: paginated.pageSize,
          totalRecords: paginated.totalRecords,
          totalPages: paginated.totalPages,
          hasNext: paginated.hasNext,
        } satisfies LibraryResponse);
      } finally {
        client.close();
      }
    } else if (instance.type === 'sonarr') {
      try {
        validateSortKey('sonarr', libraryQuery.sortKey);
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : 'Invalid sortKey' }, { status: 400 });
      }

      const cached = cache.get<RuntimeSonarrLibraryItem[]>(cacheKey);
      if (cached) {
        const paginated = applyLibraryQueryAndPagination(cached, libraryQuery, LIBRARY_SORT_KEYS_BY_TYPE.sonarr);
        return json({
          type: 'sonarr',
          items: paginated.items,
          profilesByDatabase,
          page: paginated.page,
          pageSize: paginated.pageSize,
          totalRecords: paginated.totalRecords,
          totalPages: paginated.totalPages,
          hasNext: paginated.hasNext,
        } satisfies LibraryResponse);
      }

      const praxrrProfileNames = await getPraxrrProfileNames();
      const client = (await getArrInstanceClient(instance.type as ArrType, instance.id, instance.url)) as SonarrClient;
      try {
        const items = await client.getLibrary(praxrrProfileNames);
        cache.set(cacheKey, items, LIBRARY_CACHE_TTL);
        const paginated = applyLibraryQueryAndPagination(items, libraryQuery, LIBRARY_SORT_KEYS_BY_TYPE.sonarr);

        await logger.info(`Fetched library for ${instance.name}`, {
          source: 'arr/library',
          meta: { instanceId: id, seriesCount: items.length },
        });

        return json({
          type: 'sonarr',
          items: paginated.items,
          profilesByDatabase,
          page: paginated.page,
          pageSize: paginated.pageSize,
          totalRecords: paginated.totalRecords,
          totalPages: paginated.totalPages,
          hasNext: paginated.hasNext,
        } satisfies LibraryResponse);
      } finally {
        client.close();
      }
    } else if (instance.type === 'lidarr') {
      try {
        validateSortKey('lidarr', libraryQuery.sortKey);
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : 'Invalid sortKey' }, { status: 400 });
      }

      const cached = cache.get<RuntimeLidarrLibraryItem[]>(cacheKey);
      if (cached) {
        const paginated = applyLibraryQueryAndPagination<RuntimeLidarrLibraryItem>(
          cached,
          libraryQuery,
          LIBRARY_SORT_KEYS_BY_TYPE.lidarr
        );
        // Lidarr schema uses placeholder type (additionalProperties) — satisfies deferred until schema fields are finalized
        return json({
          type: 'lidarr' as const,
          items: paginated.items as unknown as components['schemas']['LidarrLibraryItem'][],
          profilesByDatabase,
          page: paginated.page,
          pageSize: paginated.pageSize,
          totalRecords: paginated.totalRecords,
          totalPages: paginated.totalPages,
          hasNext: paginated.hasNext,
        } satisfies LibraryResponse);
      }

      const praxrrProfileNames = await getPraxrrProfileNames();
      const client = (await getArrInstanceClient(instance.type as ArrType, instance.id, instance.url)) as LidarrClient;
      try {
        const items = await client.getLibrary(praxrrProfileNames);
        cache.set(cacheKey, items, LIBRARY_CACHE_TTL);
        const paginated = applyLibraryQueryAndPagination<RuntimeLidarrLibraryItem>(
          items,
          libraryQuery,
          LIBRARY_SORT_KEYS_BY_TYPE.lidarr
        );

        await logger.info(`Fetched library for ${instance.name}`, {
          source: 'arr/library',
          meta: { instanceId: id, albumCount: items.length },
        });

        // Lidarr schema uses placeholder type (additionalProperties) — satisfies deferred until schema fields are finalized
        return json({
          type: 'lidarr' as const,
          items: paginated.items as unknown as components['schemas']['LidarrLibraryItem'][],
          profilesByDatabase,
          page: paginated.page,
          pageSize: paginated.pageSize,
          totalRecords: paginated.totalRecords,
          totalPages: paginated.totalPages,
          hasNext: paginated.hasNext,
        } satisfies LibraryResponse);
      } finally {
        client.close();
      }
    } else {
      return json({ error: `Unsupported instance type: ${instance.type}` } satisfies ErrorResponse, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch library';

    await logger.error(`Failed to fetch library for ${instance.name}`, {
      source: 'arr/library',
      meta: { instanceId: id, error: message },
    });

    return json({ error: message } satisfies ErrorResponse, { status: 500 });
  }
};

/**
 * DELETE /api/v1/arr/library
 *
 * Invalidate the server-side library cache for an instance.
 *
 * Query params:
 * - instanceId: Arr instance ID (required)
 */
export const DELETE: RequestHandler = async ({ url }) => {
  const instanceId = url.searchParams.get('instanceId');

  if (!instanceId) {
    return json({ error: 'instanceId is required' } satisfies ErrorResponse, { status: 400 });
  }

  const id = parseInt(instanceId, 10);
  if (isNaN(id)) {
    return json({ error: 'Invalid instanceId' } satisfies ErrorResponse, { status: 400 });
  }

  cache.deleteByPrefix(getArrLibraryCachePrefix(id));

  return json({ success: true } satisfies components['schemas']['CacheInvalidatedResponse']);
};
