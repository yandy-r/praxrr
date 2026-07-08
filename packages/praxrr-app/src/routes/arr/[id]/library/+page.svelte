<script lang="ts">
  import { goto } from '$app/navigation';
  import { page as pageStore } from '$app/stores';
  import { AlertTriangle, Film, ExternalLink, CircleAlert, Check, ChevronLeft, ChevronRight } from 'lucide-svelte';
  import { browser } from '$app/environment';
  import ExpandableTable from '$ui/table/ExpandableTable.svelte';
  import type { Column, SortState } from '$ui/table/types';
  import Badge from '$ui/badge/Badge.svelte';
  import type { PageData } from './$types';
  import type { RadarrLibraryItem, SonarrLibraryItem, SonarrEpisodeItem, LidarrLibraryItem } from '$utils/arr/types.ts';
  import { getPersistentSearchStore, type SearchStore } from '$stores/search';
  import { libraryCache } from '$stores/libraryCache';
  import { getArrAppMetadata, isArrAppType, supportsArrWorkflow } from '$shared/arr/capabilities.ts';
  import { resolveInstanceBrowserUrl } from '$shared/arr/instanceUrl.ts';

  import LibraryActionBar from './components/LibraryActionBar.svelte';
  import MovieRow from './components/MovieRow.svelte';
  import MovieRowSkeleton from './components/MovieRowSkeleton.svelte';
  import SeriesRow from './components/SeriesRow.svelte';
  import SeriesRowSkeleton from './components/SeriesRowSkeleton.svelte';
  import SeasonTable from './components/SeasonTable.svelte';

  export let data: PageData;

  $: instance = data?.instance;
  $: instanceId = instance?.id ?? null;
  $: instanceType = instance?.type ?? '';
  $: instanceName = instance?.name ?? 'Arr';
  $: instanceUrl = resolveInstanceBrowserUrl({
    url: instance?.url ?? '',
    external_url: instance?.external_url ?? null,
  }).replace(/\/$/, '');
  $: appType = instanceType && isArrAppType(instanceType) ? instanceType : null;
  $: supportsLibraryWorkflow = appType ? supportsArrWorkflow(appType, 'library') : false;
  $: isRadarr = instanceType === 'radarr';
  $: isSonarr = instanceType === 'sonarr';
  $: isLidarr = instanceType === 'lidarr';

  let searchStore: SearchStore;
  $: searchStore = getPersistentSearchStore(`arrLibrarySearch:${instanceId ?? 'unknown'}`, {
    debounceMs: 150,
  });
  const DEFAULT_LIBRARY_PAGE = 1;
  const DEFAULT_LIBRARY_PAGE_SIZE = 100;

  interface LibraryMetaProfile {
    databaseId: number;
    databaseName: string;
    profiles: string[];
  }

  type LibraryApiResponse =
    | {
        type: 'radarr';
        items: RadarrLibraryItem[];
        profilesByDatabase: LibraryMetaProfile[];
        page?: number;
        pageSize?: number;
        totalRecords?: number;
        totalPages?: number;
        hasNext?: boolean;
      }
    | {
        type: 'sonarr';
        items: SonarrLibraryItem[];
        profilesByDatabase: LibraryMetaProfile[];
        page?: number;
        pageSize?: number;
        totalRecords?: number;
        totalPages?: number;
        hasNext?: boolean;
      }
    | {
        type: 'lidarr';
        items: LidarrLibraryItem[];
        profilesByDatabase: LibraryMetaProfile[];
        page?: number;
        pageSize?: number;
        totalRecords?: number;
        totalPages?: number;
        hasNext?: boolean;
      };

  const parsePositiveInt = (value: string | null, fallback: number, min = 1): number => {
    const parsed = Number.parseInt(value ?? '', 10);
    if (!Number.isInteger(parsed) || parsed < min) {
      return fallback;
    }

    return parsed;
  };

  const parseMetadataInt = (value: unknown, fallback: number): number => {
    return typeof value === 'number' && Number.isInteger(value) ? value : fallback;
  };

  const parseMetadataBoolean = (value: unknown, fallback: boolean): boolean => {
    if (typeof value === 'boolean') {
      return value;
    }

    return fallback;
  };

  const readLibraryResponseMetadata = (rawValue: unknown, fallback: number): number => {
    const parsed = parseMetadataInt(rawValue, fallback);
    return parsed < 0 ? fallback : parsed;
  };

  const getFilterSignature = (
    filters: {
      field: string;
      operator: string;
      value: unknown;
    }[]
  ): string => filters.map((filter) => `${filter.field}:${filter.operator}:${String(filter.value)}`).join('|');

  const buildLibraryUrl = (params: {
    page: number;
    pageSize: number;
    query?: string;
    sortKey?: string;
    sortDirection?: string;
  }): string => {
    const searchParams = new URLSearchParams({
      instanceId: String(instanceId),
      page: String(params.page),
      pageSize: String(params.pageSize),
    });

    const query = params.query?.trim();
    if (query) {
      searchParams.set('query', query);
    }

    if (params.sortKey) {
      searchParams.set('sortKey', params.sortKey);
    }

    if (params.sortDirection) {
      searchParams.set('sortDirection', params.sortDirection);
    }

    return `/api/v1/arr/library?${searchParams.toString()}`;
  };

  const normalizeLibraryQuery = (value?: string | null) => {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
  };

  let activeSearchQuery: string | undefined = undefined;
  $: activeSearchQuery = normalizeLibraryQuery($searchStore.query);

  const buildLibraryRequestContext = (params?: { page?: number; pageSize?: number; query?: string }) => ({
    page: params?.page ?? page,
    pageSize: params?.pageSize ?? pageSize,
    query: params?.query ?? activeSearchQuery,
  });

  const requestToLibraryCacheKey = (
    targetInstanceId: number,
    params?: { page?: number; pageSize?: number; query?: string }
  ) => libraryCache.buildKey(targetInstanceId, buildLibraryRequestContext(params));
  const updateUrlParams = (updates: { page?: number; pageSize?: number }) => {
    if (!browser || !instanceId) {
      return;
    }

    const currentUrl = new URL($pageStore.url);
    const url = new URL(currentUrl);
    if (updates.page === undefined) {
      url.searchParams.delete('page');
    } else {
      url.searchParams.set('page', String(updates.page));
    }

    if (updates.pageSize === undefined) {
      url.searchParams.delete('pageSize');
    } else {
      url.searchParams.set('pageSize', String(updates.pageSize));
    }

    if (url.toString() === currentUrl.toString()) {
      return;
    }

    goto(url.toString(), {
      replaceState: true,
      noScroll: true,
      keepFocus: true,
      invalidateAll: true,
    });
  };

  const syncPaginationFromUrl = (target: URL) => {
    const nextPage = parsePositiveInt(target.searchParams.get('page'), DEFAULT_LIBRARY_PAGE);
    const nextPageSize = parsePositiveInt(target.searchParams.get('pageSize'), DEFAULT_LIBRARY_PAGE_SIZE);
    const nextQuery = target.searchParams.get('query');

    if (nextQuery !== null && normalizeLibraryQuery($searchStore.query) !== normalizeLibraryQuery(nextQuery)) {
      searchStore.setQuery(nextQuery);
    }

    if (nextPageSize !== pageSize && nextPage !== DEFAULT_LIBRARY_PAGE) {
      pageSize = nextPageSize;
      page = DEFAULT_LIBRARY_PAGE;
      updateUrlParams({ page, pageSize });
      return;
    }

    if (nextPageSize !== pageSize) {
      pageSize = nextPageSize;
    }

    if (nextPage !== page) {
      page = nextPage;
    }
  };

  let page = DEFAULT_LIBRARY_PAGE;
  let pageSize = DEFAULT_LIBRARY_PAGE_SIZE;
  let totalRecords = 0;
  let totalPages = 0;
  let hasNext = false;
  $: totalRecordCount = Math.max(0, totalRecords);
  $: currentPageStart = totalRecordCount > 0 ? (page - 1) * pageSize + 1 : 0;
  $: currentPageEnd = totalRecordCount > 0 ? Math.min(page * pageSize, totalRecordCount) : 0;
  $: hasMorePages = page < totalPages || hasNext;

  let lastLibraryRequestKey = '';
  let lastFilterSignature: string | null = null;

  // ==========================================================================
  // Library Data State
  // ==========================================================================

  let library: RadarrLibraryItem[] | SonarrLibraryItem[] | LidarrLibraryItem[] = [];
  let libraryError: string | null = null;
  let libraryCapabilityError: string | null = null;
  let profilesByDatabase: { databaseId: number; databaseName: string; profiles: string[] }[] = [];
  let loading = true;
  let refreshing = false;

  function getLibraryUnsupportedMessage(instanceType: string): string {
    if (isArrAppType(instanceType)) {
      return `${getArrAppMetadata(instanceType).label} library view is not available in this version yet.`;
    }

    return 'This instance type does not support library view in this version.';
  }

  async function getLibraryErrorMessage(response: Response): Promise<string> {
    try {
      const payload = await response.json();
      if (payload && typeof payload.error === 'string' && payload.error.trim().length > 0) {
        return payload.error;
      }
    } catch {
      // Fall back to status-based messaging when the error body is not JSON.
    }

    if (response.statusText) {
      return `Failed to fetch library: ${response.statusText}`;
    }

    return `Failed to fetch library (${response.status})`;
  }

  function isUnsupportedLibraryError(status: number, message: string): boolean {
    if (status < 400 || status >= 500) {
      return false;
    }

    const normalizedMessage = message.toLowerCase();
    return (
      normalizedMessage.includes('unsupported instance type') ||
      (normalizedMessage.includes('library') && normalizedMessage.includes('not supported'))
    );
  }

  $: defaultUnsupportedLibraryMessage = getLibraryUnsupportedMessage(instanceType);
  $: libraryUnavailableMessage = !supportsLibraryWorkflow ? defaultUnsupportedLibraryMessage : libraryCapabilityError;

  async function fetchLibrary(force = false) {
    if (!browser) {
      return;
    }

    if (!instanceId) {
      library = [];
      profilesByDatabase = [];
      libraryError = null;
      libraryCapabilityError = null;
      loading = false;
      refreshing = false;
      return;
    }

    if (!supportsLibraryWorkflow) {
      library = [];
      profilesByDatabase = [];
      libraryError = null;
      libraryCapabilityError = null;
      loading = false;
      refreshing = false;
      return;
    }

    libraryCapabilityError = null;
    const request = buildLibraryRequestContext();

    if (!force) {
      const cachedEntry = libraryCache.get(instanceId, request);
      if (cachedEntry) {
        library = cachedEntry.data;
        profilesByDatabase = cachedEntry.profilesByDatabase;
        page = cachedEntry.query.page;
        pageSize = cachedEntry.query.pageSize;
        totalRecords = cachedEntry.totalRecords;
        totalPages = cachedEntry.totalPages;
        hasNext = cachedEntry.hasNext;
        libraryError = null;
        libraryCapabilityError = null;
        loading = false;
        refreshing = false;
        return;
      }
    }

    const requestUrl = buildLibraryUrl(request);

    if (force) {
      libraryCache.invalidate(instanceId);
    }

    // Fetch from API
    try {
      if (force) {
        await fetch(`${requestUrl}`, { method: 'DELETE' });
      }

      const response = await fetch(requestUrl);
      if (!response.ok) {
        const message = await getLibraryErrorMessage(response);
        if (isUnsupportedLibraryError(response.status, message)) {
          library = [];
          profilesByDatabase = [];
          libraryError = null;
          libraryCapabilityError = defaultUnsupportedLibraryMessage;
          return;
        }
        throw new Error(message);
      }

      const result = (await response.json()) as LibraryApiResponse;
      switch (result.type) {
        case 'radarr':
          library = result.items;
          break;
        case 'sonarr':
          library = result.items;
          break;
        case 'lidarr':
          library = result.items;
          break;
      }
      libraryError = null;
      libraryCapabilityError = null;
      profilesByDatabase = result.profilesByDatabase;
      const nextPage = readLibraryResponseMetadata(result.page, request.page);
      const nextPageSize = readLibraryResponseMetadata(result.pageSize, request.pageSize);
      const nextTotalRecords = readLibraryResponseMetadata(result.totalRecords, 0);
      const nextTotalPages = readLibraryResponseMetadata(result.totalPages, 0);
      const nextHasNext = parseMetadataBoolean(result.hasNext, false);
      page = nextPage;
      pageSize = nextPageSize;
      totalRecords = nextTotalRecords;
      totalPages = nextTotalPages;
      hasNext = nextHasNext;
      libraryCache.set(instanceId, result.items, result.profilesByDatabase, request, {
        totalRecords: nextTotalRecords,
        totalPages: nextTotalPages,
        hasNext: nextHasNext,
      });
    } catch (err) {
      libraryError = err instanceof Error ? err.message : 'Failed to fetch library';
      libraryCapabilityError = null;
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  async function handleRefresh() {
    if (!instanceId) {
      return;
    }

    refreshing = true;
    libraryCache.invalidate(instanceId);
    // Clear episode cache on refresh too
    if (isSonarr) {
      episodeCache = new Map();
      episodeLoadingSet = new Set();
    }
    await fetchLibrary(true);
  }

  function handlePreviousPage() {
    if (loading || page <= 1) {
      return;
    }

    updateUrlParams({ page: page - 1 });
  }

  function handleNextPage() {
    if (loading || !hasMorePages) {
      return;
    }

    updateUrlParams({ page: page + 1 });
  }

  function handlePageSizeChange(nextSize: number) {
    if (nextSize <= 0) {
      return;
    }

    updateUrlParams({ pageSize: nextSize, page: 1 });
  }

  let currentInstanceId: number | null = null;

  $: if (browser) {
    syncPaginationFromUrl($pageStore.url);
  }

  $: {
    const filterSignature = `${activeSearchQuery ?? ''}|${getFilterSignature(activeFilters)}`;
    if (lastFilterSignature === null) {
      lastFilterSignature = filterSignature;
    } else if (filterSignature !== lastFilterSignature) {
      lastFilterSignature = filterSignature;
      if (page !== DEFAULT_LIBRARY_PAGE) {
        page = DEFAULT_LIBRARY_PAGE;
        updateUrlParams({ page, pageSize });
      } else {
        // Force request-key recomputation/fetch when query/filter changes on page 1.
        lastLibraryRequestKey = '';
      }
    }
  }

  $: if (browser && instanceId) {
    const requestKey = requestToLibraryCacheKey(instanceId, { page, pageSize, query: activeSearchQuery });
    if (requestKey !== lastLibraryRequestKey) {
      lastLibraryRequestKey = requestKey;
      fetchLibrary();
    }
  }

  // Refetch if instance changes (navigation between instances)
  $: if (browser && instanceId && instanceId !== currentInstanceId) {
    currentInstanceId = instanceId;
    loading = true;
    lastLibraryRequestKey = '';
    lastFilterSignature = null;
    episodeCache = new Map();
    episodeLoadingSet = new Set();
  }

  // ==========================================================================
  // Column Visibility (Radarr)
  // ==========================================================================

  const RADARR_STORAGE_KEY = 'praxrr-library-columns';
  const RADARR_TOGGLEABLE_COLUMNS = [
    'qualityName',
    'customFormatScore',
    'progress',
    'popularity',
    'dateAdded',
  ] as const;
  type RadarrToggleableColumn = (typeof RADARR_TOGGLEABLE_COLUMNS)[number];

  function loadRadarrColumnVisibility(): Set<RadarrToggleableColumn> {
    if (!browser) return new Set(RADARR_TOGGLEABLE_COLUMNS);
    try {
      const stored = localStorage.getItem(RADARR_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as RadarrToggleableColumn[];
        return new Set(parsed);
      }
    } catch {
      // Ignore invalid localStorage data
    }
    return new Set(RADARR_TOGGLEABLE_COLUMNS);
  }

  function saveRadarrColumnVisibility(visible: Set<RadarrToggleableColumn>) {
    if (!browser) return;
    localStorage.setItem(RADARR_STORAGE_KEY, JSON.stringify([...visible]));
  }

  let radarrVisibleColumns = loadRadarrColumnVisibility();

  function toggleRadarrColumn(key: string) {
    const colKey = key as RadarrToggleableColumn;
    if (radarrVisibleColumns.has(colKey)) {
      radarrVisibleColumns.delete(colKey);
    } else {
      radarrVisibleColumns.add(colKey);
    }
    radarrVisibleColumns = radarrVisibleColumns;
    saveRadarrColumnVisibility(radarrVisibleColumns);
  }

  const radarrColumnLabels: Record<RadarrToggleableColumn, string> = {
    qualityName: 'Quality',
    customFormatScore: 'Score',
    progress: 'Progress',
    popularity: 'Popularity',
    dateAdded: 'Added',
  };

  // ==========================================================================
  // Column Visibility (Sonarr)
  // ==========================================================================

  const SONARR_STORAGE_KEY = 'praxrr-library-sonarr-columns';
  const SONARR_TOGGLEABLE_COLUMNS = ['episodes', 'sizeOnDisk', 'dateAdded'] as const;
  type SonarrToggleableColumn = (typeof SONARR_TOGGLEABLE_COLUMNS)[number];

  function loadSonarrColumnVisibility(): Set<SonarrToggleableColumn> {
    if (!browser) return new Set(SONARR_TOGGLEABLE_COLUMNS);
    try {
      const stored = localStorage.getItem(SONARR_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as SonarrToggleableColumn[];
        return new Set(parsed);
      }
    } catch {
      // Ignore invalid localStorage data
    }
    return new Set(SONARR_TOGGLEABLE_COLUMNS);
  }

  function saveSonarrColumnVisibility(visible: Set<SonarrToggleableColumn>) {
    if (!browser) return;
    localStorage.setItem(SONARR_STORAGE_KEY, JSON.stringify([...visible]));
  }

  let sonarrVisibleColumns = loadSonarrColumnVisibility();

  function toggleSonarrColumn(key: string) {
    const colKey = key as SonarrToggleableColumn;
    if (sonarrVisibleColumns.has(colKey)) {
      sonarrVisibleColumns.delete(colKey);
    } else {
      sonarrVisibleColumns.add(colKey);
    }
    sonarrVisibleColumns = sonarrVisibleColumns;
    saveSonarrColumnVisibility(sonarrVisibleColumns);
  }

  const sonarrColumnLabels: Record<SonarrToggleableColumn, string> = {
    episodes: 'Episodes',
    sizeOnDisk: 'Size',
    dateAdded: 'Added',
  };

  // ==========================================================================
  // Column Visibility (Lidarr)
  // ==========================================================================

  const LIDARR_STORAGE_KEY = 'praxrr-library-lidarr-columns';
  const LIDARR_TOGGLEABLE_COLUMNS = ['tracks', 'progress', 'sizeOnDisk', 'dateAdded'] as const;
  type LidarrToggleableColumn = (typeof LIDARR_TOGGLEABLE_COLUMNS)[number];

  function loadLidarrColumnVisibility(): Set<LidarrToggleableColumn> {
    if (!browser) return new Set(LIDARR_TOGGLEABLE_COLUMNS);
    try {
      const stored = localStorage.getItem(LIDARR_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as LidarrToggleableColumn[];
        return new Set(parsed);
      }
    } catch {
      // Ignore invalid localStorage data
    }
    return new Set(LIDARR_TOGGLEABLE_COLUMNS);
  }

  function saveLidarrColumnVisibility(visible: Set<LidarrToggleableColumn>) {
    if (!browser) return;
    localStorage.setItem(LIDARR_STORAGE_KEY, JSON.stringify([...visible]));
  }

  let lidarrVisibleColumns = loadLidarrColumnVisibility();

  function toggleLidarrColumn(key: string) {
    const colKey = key as LidarrToggleableColumn;
    if (lidarrVisibleColumns.has(colKey)) {
      lidarrVisibleColumns.delete(colKey);
    } else {
      lidarrVisibleColumns.add(colKey);
    }
    lidarrVisibleColumns = lidarrVisibleColumns;
    saveLidarrColumnVisibility(lidarrVisibleColumns);
  }

  const lidarrColumnLabels: Record<LidarrToggleableColumn, string> = {
    tracks: 'Tracks',
    progress: 'Progress',
    sizeOnDisk: 'Size',
    dateAdded: 'Added',
  };

  // ==========================================================================
  // Unified column toggle (delegates based on type)
  // ==========================================================================

  $: activeToggleableColumns = isRadarr
    ? RADARR_TOGGLEABLE_COLUMNS
    : isSonarr
      ? SONARR_TOGGLEABLE_COLUMNS
      : LIDARR_TOGGLEABLE_COLUMNS;
  $: activeColumnLabels = isRadarr ? radarrColumnLabels : isSonarr ? sonarrColumnLabels : lidarrColumnLabels;
  $: activeVisibleColumns = isRadarr
    ? new Set([...radarrVisibleColumns])
    : isSonarr
      ? new Set([...sonarrVisibleColumns])
      : new Set([...lidarrVisibleColumns]);

  function toggleColumn(key: string) {
    if (isRadarr) {
      toggleRadarrColumn(key);
    } else if (isSonarr) {
      toggleSonarrColumn(key);
    } else {
      toggleLidarrColumn(key);
    }
  }

  // ==========================================================================
  // Filter System
  // ==========================================================================

  type FilterOperator = 'eq' | 'neq';
  type FilterField = 'qualityName' | 'qualityProfileName';

  interface ActiveFilter {
    field: FilterField;
    operator: FilterOperator;
    value: string | number | boolean;
    label: string;
  }

  let activeFilters: ActiveFilter[] = [];

  // Radarr filters
  $: radarrLibrary = library as RadarrLibraryItem[];
  $: uniqueQualities = isRadarr
    ? [...new Set(radarrLibrary.filter((m) => m.qualityName).map((m) => m.qualityName!))].sort()
    : [];
  $: uniqueProfiles = [
    ...new Set((library as Array<{ qualityProfileName: string }>).map((m) => m.qualityProfileName)),
  ].sort();

  function toggleFilter(field: FilterField, operator: FilterOperator, value: string | number | boolean, label: string) {
    const existingIndex = activeFilters.findIndex((f) => f.field === field && f.value === value);
    if (existingIndex >= 0) {
      activeFilters = activeFilters.filter((_, i) => i !== existingIndex);
    } else {
      activeFilters = [...activeFilters, { field, operator, value, label }];
    }
  }

  function applyFilters<T extends object>(items: T[]): T[] {
    if (activeFilters.length === 0) return items;

    const filtersByField = new Map<FilterField, ActiveFilter[]>();
    for (const filter of activeFilters) {
      const existing = filtersByField.get(filter.field) || [];
      existing.push(filter);
      filtersByField.set(filter.field, existing);
    }

    return items.filter((item) => {
      return [...filtersByField.entries()].every(([field, filters]) => {
        const itemValue = (item as Record<string, unknown>)[field];
        return filters.some((filter) => {
          if (filter.operator === 'eq') return itemValue === filter.value;
          if (filter.operator === 'neq') return itemValue !== filter.value;
          return true;
        });
      });
    });
  }

  // ==========================================================================
  // Radarr Data & Columns
  // ==========================================================================

  $: baseUrl = instanceUrl;
  $: hasSearchQuery = Boolean(activeSearchQuery);

  // Radarr
  $: allMoviesWithFiles = isRadarr ? radarrLibrary.filter((m) => m.hasFile) : [];

  $: moviesWithFiles = (() => {
    if (!isRadarr) return [];
    return applyFilters(allMoviesWithFiles);
  })();

  const allRadarrColumns: Column<RadarrLibraryItem>[] = [
    { key: 'title', header: 'Title', align: 'left', sortable: true },
    { key: 'qualityProfileName', header: 'Profile', align: 'left', width: 'w-40', sortable: true },
    { key: 'qualityName', header: 'Quality', align: 'left', width: 'w-32', sortable: true },
    {
      key: 'customFormatScore',
      header: 'Score',
      align: 'right',
      width: 'w-28',
      sortable: true,
      defaultSortDirection: 'desc',
    },
    {
      key: 'progress',
      header: 'Progress',
      align: 'center',
      width: 'w-40',
      sortable: true,
      sortAccessor: (row) => row.progress,
      defaultSortDirection: 'desc',
    },
    {
      key: 'popularity',
      header: 'Popularity',
      align: 'right',
      width: 'w-24',
      sortable: true,
      defaultSortDirection: 'desc',
    },
    {
      key: 'dateAdded',
      header: 'Added',
      align: 'right',
      width: 'w-28',
      sortable: true,
      sortAccessor: (row) => (row.dateAdded ? new Date(row.dateAdded).getTime() : 0),
      defaultSortDirection: 'desc',
    },
  ];

  $: radarrColumns = allRadarrColumns.filter(
    (col) =>
      col.key === 'title' ||
      col.key === 'qualityProfileName' ||
      radarrVisibleColumns.has(col.key as RadarrToggleableColumn)
  );

  const radarrDefaultSort: SortState = { key: 'title', direction: 'asc' };

  const radarrSkeletonData: RadarrLibraryItem[] = Array.from({ length: 12 }, (_, i) => ({
    id: `skeleton-${i}`,
    title: '',
    year: 0,
    tmdbId: 0,
    hasFile: true,
    qualityProfileId: 0,
    qualityProfileName: '',
    isPraxrrProfile: false,
    qualityName: null,
    customFormatScore: 0,
    cutoffScore: 0,
    cutoffMet: false,
    progress: 0,
    popularity: 0,
    dateAdded: '',
    fileName: null,
    scoreBreakdown: [],
  })) as unknown as RadarrLibraryItem[];

  // ==========================================================================
  // Sonarr Data & Columns
  // ==========================================================================

  $: sonarrLibrary = library as SonarrLibraryItem[];

  $: filteredSeries = (() => {
    if (!isSonarr) return [];
    return applyFilters(sonarrLibrary);
  })();

  const allSonarrColumns: Column<SonarrLibraryItem>[] = [
    { key: 'title', header: 'Title', align: 'left', sortable: true },
    { key: 'qualityProfileName', header: 'Profile', align: 'left', width: 'w-40', sortable: true },
    {
      key: 'episodes',
      header: 'Episodes',
      align: 'center',
      width: 'w-28',
      sortable: true,
      sortAccessor: (row) => row.percentOfEpisodes,
      defaultSortDirection: 'desc',
    },
    {
      key: 'sizeOnDisk',
      header: 'Size',
      align: 'right',
      width: 'w-24',
      sortable: true,
      sortAccessor: (row) => row.sizeOnDisk,
      defaultSortDirection: 'desc',
    },
    {
      key: 'dateAdded',
      header: 'Added',
      align: 'right',
      width: 'w-28',
      sortable: true,
      sortAccessor: (row) => (row.dateAdded ? new Date(row.dateAdded).getTime() : 0),
      defaultSortDirection: 'desc',
    },
  ];

  $: sonarrColumns = allSonarrColumns.filter(
    (col) =>
      col.key === 'title' ||
      col.key === 'qualityProfileName' ||
      sonarrVisibleColumns.has(col.key as SonarrToggleableColumn)
  );

  const sonarrDefaultSort: SortState = { key: 'title', direction: 'asc' };

  const sonarrSkeletonData: SonarrLibraryItem[] = Array.from({ length: 12 }, (_, i) => ({
    id: i,
    title: '',
    year: 0,
    qualityProfileId: 0,
    qualityProfileName: '',
    monitored: true,
    seasonCount: 0,
    episodeCount: 0,
    episodeFileCount: 0,
    totalEpisodeCount: 0,
    sizeOnDisk: 0,
    percentOfEpisodes: 0,
    dateAdded: '',
    seasons: [],
    isPraxrrProfile: false,
  })) as unknown as SonarrLibraryItem[];

  // ==========================================================================
  // Lidarr Data & Columns
  // ==========================================================================

  $: lidarrLibrary = library as LidarrLibraryItem[];

  $: filteredAlbums = (() => {
    if (!isLidarr) return [];
    return applyFilters(lidarrLibrary);
  })();

  const allLidarrColumns: Column<LidarrLibraryItem>[] = [
    { key: 'title', header: 'Album', align: 'left', sortable: true },
    { key: 'qualityProfileName', header: 'Profile', align: 'left', width: 'w-40', sortable: true },
    {
      key: 'tracks',
      header: 'Tracks',
      align: 'center',
      width: 'w-28',
      sortable: true,
      sortAccessor: (row) => row.trackCount,
    },
    {
      key: 'progress',
      header: 'Progress',
      align: 'center',
      width: 'w-40',
      sortable: true,
      sortAccessor: (row) => getLidarrProgressPercent(row),
      defaultSortDirection: 'desc',
    },
    {
      key: 'sizeOnDisk',
      header: 'Size',
      align: 'right',
      width: 'w-24',
      sortable: true,
      sortAccessor: (row) => row.sizeOnDisk,
      defaultSortDirection: 'desc',
    },
    {
      key: 'dateAdded',
      header: 'Added',
      align: 'right',
      width: 'w-28',
      sortable: true,
      sortAccessor: (row) => (row.dateAdded ? new Date(row.dateAdded).getTime() : 0),
      defaultSortDirection: 'desc',
    },
  ];

  $: lidarrColumns = allLidarrColumns.filter(
    (col) =>
      col.key === 'title' ||
      col.key === 'qualityProfileName' ||
      lidarrVisibleColumns.has(col.key as LidarrToggleableColumn)
  );

  const lidarrDefaultSort: SortState = { key: 'title', direction: 'asc' };

  const lidarrSkeletonData: LidarrLibraryItem[] = Array.from({ length: 12 }, (_, i) => ({
    id: i,
    artistId: 0,
    artistName: '',
    title: '',
    qualityProfileId: 0,
    qualityProfileName: '',
    isPraxrrProfile: false,
    monitored: true,
    trackFileCount: 0,
    trackCount: 0,
    totalTrackCount: 0,
    sizeOnDisk: 0,
    percentOfTracks: 0,
    dateAdded: '',
  }));

  function formatDate(isoString?: string): string {
    if (!isoString) return '-';
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  }

  function formatSize(bytes: number): string {
    if (!bytes) return '-';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(0)} MB`;
  }

  function getLidarrProgressPercent(row: LidarrLibraryItem): number {
    if (row.trackCount > 0) {
      return (row.trackFileCount / row.trackCount) * 100;
    }
    return row.percentOfTracks;
  }

  // ==========================================================================
  // Sonarr Episode Lazy Loading
  // ==========================================================================

  let episodeCache: Map<number, SonarrEpisodeItem[]> = new Map();
  let episodeLoadingSet: Set<number> = new Set();

  async function loadEpisodes(seriesId: number) {
    if (!instanceId) return;
    if (episodeCache.has(seriesId) || episodeLoadingSet.has(seriesId)) return;

    episodeLoadingSet.add(seriesId);
    episodeLoadingSet = episodeLoadingSet;

    try {
      const response = await fetch(`/api/v1/arr/library/episodes?instanceId=${instanceId}&seriesId=${seriesId}`);
      if (!response.ok) throw new Error('Failed to fetch episodes');
      const result = await response.json();
      episodeCache.set(seriesId, result.episodes);
      episodeCache = episodeCache;
    } catch (err) {
      console.error(`Failed to load episodes for series ${seriesId}:`, err);
    } finally {
      episodeLoadingSet.delete(seriesId);
      episodeLoadingSet = episodeLoadingSet;
    }
  }

  // Reactive episode grouping - Svelte tracks episodeCache dependency
  $: episodesBySeriesAndSeason = (() => {
    const result = new Map<number, Map<number, SonarrEpisodeItem[]>>();
    for (const [seriesId, episodes] of episodeCache) {
      const seasonMap = new Map<number, SonarrEpisodeItem[]>();
      for (const ep of episodes) {
        const existing = seasonMap.get(ep.seasonNumber) ?? [];
        existing.push(ep);
        seasonMap.set(ep.seasonNumber, existing);
      }
      result.set(seriesId, seasonMap);
    }
    return result;
  })();

  let sonarrExpandedRows: Set<string | number> = new Set();

  // Watch for expansion changes to trigger lazy loading
  $: if (isSonarr && sonarrExpandedRows.size > 0) {
    for (const id of sonarrExpandedRows) {
      const numId = typeof id === 'string' ? parseInt(id) : id;
      loadEpisodes(numId);
    }
  }
</script>

<svelte:head>
  <title>{instanceName} - Library - Praxrr</title>
</svelte:head>

<div class="mt-6 space-y-6">
  {#if libraryUnavailableMessage}
    <div class="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      <div class="flex items-center gap-3">
        <Film class="h-5 w-5 text-neutral-400" />
        <div>
          <h3 class="font-medium text-neutral-900 dark:text-neutral-50">Library view not available</h3>
          <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            {libraryUnavailableMessage}
          </p>
        </div>
      </div>
    </div>
  {:else if libraryError && !loading}
    <div class="rounded-lg border border-red-200 bg-red-50 p-6 dark:border-red-800 dark:bg-red-950/40">
      <div class="flex items-center gap-3">
        <AlertTriangle class="h-5 w-5 text-red-600 dark:text-red-400" />
        <div>
          <h3 class="font-medium text-red-800 dark:text-red-200">Failed to load library</h3>
          <p class="mt-1 text-sm text-red-600 dark:text-red-400">{libraryError}</p>
        </div>
      </div>
    </div>
  {:else}
    <LibraryActionBar
      {searchStore}
      visibleColumns={activeVisibleColumns}
      toggleableColumns={activeToggleableColumns}
      columnLabels={activeColumnLabels}
      {activeFilters}
      uniqueQualities={loading ? [] : uniqueQualities}
      uniqueProfiles={loading ? [] : uniqueProfiles}
      onToggleColumn={toggleColumn}
      onToggleFilter={toggleFilter}
      onRefresh={handleRefresh}
      openUrl={instanceUrl}
      {page}
      {pageSize}
      {totalRecords}
      {totalPages}
      {hasNext}
      isPaginationLoading={loading}
      disablePaginationControls={loading || !supportsLibraryWorkflow}
      onPreviousPage={handlePreviousPage}
      onNextPage={handleNextPage}
      onChangePageSize={handlePageSizeChange}
      {instanceType}
    />

    {#if isRadarr}
      <!-- ============================================================ -->
      <!-- Radarr Library -->
      <!-- ============================================================ -->
      {#if allMoviesWithFiles.length === 0 && !loading && activeFilters.length === 0 && !hasSearchQuery}
        <div class="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
          <div class="flex items-center gap-3">
            <Film class="h-5 w-5 text-neutral-400" />
            <div>
              <h3 class="font-medium text-neutral-900 dark:text-neutral-50">No movies with files</h3>
              <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                This library has {library.length} movies but none have downloaded files yet.
              </p>
            </div>
          </div>
        </div>
      {:else}
        <div class="transition-all duration-300 {loading ? 'opacity-60' : 'opacity-100'}">
          <ExpandableTable
            columns={radarrColumns}
            data={loading ? radarrSkeletonData : moviesWithFiles}
            getRowId={(row) => row.id}
            compact={true}
            defaultSort={radarrDefaultSort}
            responsive
            emptyMessage={activeFilters.length > 0 || hasSearchQuery
              ? 'No movies match the current filters'
              : 'No movies with files'}
          >
            <svelte:fragment slot="cell" let:row let:column>
              {#if loading}
                <MovieRowSkeleton {column} />
              {:else}
                <MovieRow {row} {column} mode="cell" />
              {/if}
            </svelte:fragment>

            <svelte:fragment slot="actions" let:row>
              {#if !loading && row.tmdbId}
                <a
                  href="{baseUrl}/movie/{row.tmdbId}"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex h-7 w-7 items-center justify-center rounded border border-neutral-300 bg-white text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                  title="Open in Radarr"
                  on:click|stopPropagation
                >
                  <ExternalLink size={14} />
                </a>
              {/if}
            </svelte:fragment>

            <svelte:fragment slot="expanded" let:row>
              {#if !loading}
                <MovieRow {row} column={allRadarrColumns[0]} mode="expanded" />
              {/if}
            </svelte:fragment>
          </ExpandableTable>
        </div>
      {/if}
    {:else if isSonarr}
      <!-- ============================================================ -->
      <!-- Sonarr Library -->
      <!-- ============================================================ -->
      {#if sonarrLibrary.length === 0 && !loading && activeFilters.length === 0 && !hasSearchQuery}
        <div class="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
          <div class="flex items-center gap-3">
            <Film class="h-5 w-5 text-neutral-400" />
            <div>
              <h3 class="font-medium text-neutral-900 dark:text-neutral-50">No series found</h3>
              <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                This Sonarr instance has no series in its library.
              </p>
            </div>
          </div>
        </div>
      {:else}
        <div class="transition-all duration-300 {loading ? 'opacity-60' : 'opacity-100'}">
          <ExpandableTable
            columns={sonarrColumns}
            data={loading ? sonarrSkeletonData : filteredSeries}
            getRowId={(row) => row.id}
            compact={true}
            defaultSort={sonarrDefaultSort}
            responsive
            flushExpanded
            bind:expandedRows={sonarrExpandedRows}
            emptyMessage={activeFilters.length > 0 || hasSearchQuery
              ? 'No series match the current filters'
              : 'No series found'}
          >
            <svelte:fragment slot="cell" let:row let:column>
              {#if loading}
                <SeriesRowSkeleton {column} />
              {:else}
                <SeriesRow {row} {column} />
              {/if}
            </svelte:fragment>

            <svelte:fragment slot="actions" let:row>
              {#if !loading && row.tvdbId}
                <a
                  href="{baseUrl}/series/{row.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex h-7 w-7 items-center justify-center rounded border border-neutral-300 bg-white text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                  title="Open in Sonarr"
                  on:click|stopPropagation
                >
                  <ExternalLink size={14} />
                </a>
              {/if}
            </svelte:fragment>

            <svelte:fragment slot="expanded" let:row>
              {#if !loading}
                {@const seriesId = row.id}
                {@const isEpisodeLoading = episodeLoadingSet.has(seriesId)}
                {@const episodesBySeasonNumber = episodesBySeriesAndSeason.get(seriesId) ?? new Map()}

                {#if isEpisodeLoading}
                  <div class="flex items-center gap-2 p-4 text-sm text-neutral-500 dark:text-neutral-400">
                    <div
                      class="border-t-accent-500 h-4 w-4 animate-spin rounded-full border-2 border-neutral-300"
                    ></div>
                    Loading episodes...
                  </div>
                {:else}
                  <div class="p-4">
                    <SeasonTable seasons={row.seasons} {episodesBySeasonNumber} />
                  </div>
                {/if}
              {/if}
            </svelte:fragment>
          </ExpandableTable>
        </div>
      {/if}
    {:else if isLidarr}
      <!-- ============================================================ -->
      <!-- Lidarr Library -->
      <!-- ============================================================ -->
      {#if lidarrLibrary.length === 0 && !loading && activeFilters.length === 0 && !hasSearchQuery}
        <div class="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
          <div class="flex items-center gap-3">
            <Film class="h-5 w-5 text-neutral-400" />
            <div>
              <h3 class="font-medium text-neutral-900 dark:text-neutral-50">No albums found</h3>
              <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                This Lidarr instance has no albums in its library.
              </p>
            </div>
          </div>
        </div>
      {:else}
        <div class="transition-all duration-300 {loading ? 'opacity-60' : 'opacity-100'}">
          <ExpandableTable
            columns={lidarrColumns}
            data={loading ? lidarrSkeletonData : filteredAlbums}
            getRowId={(row) => row.id}
            compact={true}
            defaultSort={lidarrDefaultSort}
            responsive
            emptyMessage={activeFilters.length > 0 || hasSearchQuery
              ? 'No albums match the current filters'
              : 'No albums found'}
          >
            <svelte:fragment slot="cell" let:row let:column>
              {#if loading}
                {#if column.key === 'title'}
                  <div class="space-y-1.5">
                    <div class="h-4 w-36 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700"></div>
                    <div class="h-3 w-24 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800"></div>
                  </div>
                {:else if column.key === 'qualityProfileName'}
                  <div class="h-5 w-20 animate-pulse rounded-full bg-neutral-200 dark:bg-neutral-700"></div>
                {:else if column.key === 'tracks'}
                  <div class="h-5 w-14 animate-pulse rounded-full bg-neutral-200 dark:bg-neutral-700"></div>
                {:else if column.key === 'progress'}
                  <div class="flex items-center gap-2">
                    <div class="h-2 flex-1 animate-pulse rounded-full bg-neutral-200 dark:bg-neutral-700"></div>
                    <div class="h-4 w-8 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800"></div>
                  </div>
                {:else if column.key === 'sizeOnDisk' || column.key === 'dateAdded'}
                  <div class="h-4 w-16 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700"></div>
                {/if}
              {:else if column.key === 'title'}
                <div>
                  <div class="font-medium text-neutral-900 dark:text-neutral-50">{row.title}</div>
                  <div class="text-xs text-neutral-500 dark:text-neutral-400">
                    {row.artistName}
                    {#if row.year}
                      • {row.year}
                    {/if}
                  </div>
                </div>
              {:else if column.key === 'qualityProfileName'}
                <div class="group relative inline-flex">
                  <Badge
                    variant={row.isPraxrrProfile ? 'accent' : 'warning'}
                    icon={row.isPraxrrProfile ? null : CircleAlert}
                    mono
                  >
                    {row.qualityProfileName}
                  </Badge>
                  {#if !row.isPraxrrProfile}
                    <div
                      class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 rounded bg-neutral-800 px-2 py-1 text-xs whitespace-nowrap text-white opacity-0 group-hover:opacity-100 dark:bg-neutral-700"
                    >
                      Not managed by Praxrr
                    </div>
                  {/if}
                </div>
              {:else if column.key === 'tracks'}
                {@const trackTotal = row.trackCount > 0 ? row.trackCount : row.totalTrackCount}
                <Badge variant={trackTotal > 0 && row.trackFileCount >= trackTotal ? 'success' : 'neutral'} mono>
                  {row.trackFileCount}/{trackTotal}
                </Badge>
              {:else if column.key === 'progress'}
                {@const progress = Math.max(0, Math.min(getLidarrProgressPercent(row), 100))}
                <div class="flex items-center gap-2">
                  <div class="h-2 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                    <div
                      class="h-full rounded-full transition-all {progress >= 100
                        ? 'bg-green-500 dark:bg-green-400'
                        : 'bg-accent-500 dark:bg-accent-400'}"
                      style="width: {progress}%"
                    ></div>
                  </div>
                  {#if progress >= 100}
                    <Check size={16} class="flex-shrink-0 text-green-600 dark:text-green-400" />
                  {:else}
                    <span class="w-10 text-right font-mono text-xs text-neutral-500 dark:text-neutral-400">
                      {Math.round(progress)}%
                    </span>
                  {/if}
                </div>
              {:else if column.key === 'sizeOnDisk'}
                <Badge variant="neutral" mono>{formatSize(row.sizeOnDisk)}</Badge>
              {:else if column.key === 'dateAdded'}
                <Badge variant="neutral" mono>{formatDate(row.dateAdded)}</Badge>
              {/if}
            </svelte:fragment>

            <svelte:fragment slot="actions" let:row>
              {#if !loading && row.foreignArtistId}
                <a
                  href="{baseUrl}/artist/{row.foreignArtistId}"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex h-7 w-7 items-center justify-center rounded border border-neutral-300 bg-white text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                  title="Open in Lidarr"
                  on:click|stopPropagation
                >
                  <ExternalLink size={14} />
                </a>
              {/if}
            </svelte:fragment>

            <svelte:fragment slot="expanded" let:row>
              {#if !loading}
                <div class="flex flex-wrap items-center gap-2 p-4">
                  <Badge variant="neutral" mono>{row.artistName}</Badge>
                  {#if row.albumType}
                    <Badge variant="neutral" mono>{row.albumType}</Badge>
                  {/if}
                  {#if row.releaseDate}
                    <Badge variant="neutral" mono>{formatDate(row.releaseDate)}</Badge>
                  {/if}
                </div>
              {/if}
            </svelte:fragment>
          </ExpandableTable>
        </div>
      {/if}
    {/if}
  {/if}
  <nav
    aria-label="Library pagination"
    class="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-center sm:gap-3"
  >
    <p role="status" aria-live="polite" aria-atomic="true" class="text-sm text-neutral-600 dark:text-neutral-400">
      Showing {currentPageStart}-{currentPageEnd} of {totalRecordCount} records
    </p>
    <div class="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
      <button
        type="button"
        aria-label="Previous page"
        disabled={loading || page <= 1 || !supportsLibraryWorkflow}
        on:click={handlePreviousPage}
        class="rounded px-3 py-1.5 text-sm transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-neutral-700"
      >
        <ChevronLeft size={16} class="inline-block" />
        Previous
      </button>
      <span class="text-sm text-neutral-600 dark:text-neutral-400">Page {page} of {Math.max(1, totalPages)}</span>
      <button
        type="button"
        aria-label="Next page"
        disabled={loading || !hasMorePages || !supportsLibraryWorkflow}
        on:click={handleNextPage}
        class="rounded px-3 py-1.5 text-sm transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-neutral-700"
      >
        Next
        <ChevronRight size={16} class="inline-block" />
      </button>
    </div>
  </nav>
</div>
