import { assertEquals, assertRejects } from '@std/assert';
import { HttpError } from '$http/types.ts';
import { getTrashGuideNamespaceSuffix, getNamespaceSuffix } from '$sync/namespace.ts';
import type { BaseArrClient } from '$utils/arr/base.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { arrNamespaceQueries } from '$db/queries/arrNamespaces.ts';
import { arrTrashNamespaceQueries } from '$db/queries/arrTrashNamespaces.ts';
import { trashGuideSyncQueries } from '$db/queries/trashGuideSync.ts';
import { trashGuideSourcesQueries } from '$db/queries/trashGuideSources.ts';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import type { TrashGuideEntityCache } from '$db/queries/trashGuideEntityCache.ts';
import type { PCDCache } from '$pcd/index.ts';
import { clearAllCaches, setCache } from '$pcd/database/registry.ts';
import { logger } from '$logger/logger.ts';
import { deleteStaleItems, executeCleanup, NO_LONGER_STALE_REASON, scanForStaleItems } from '$sync/cleanup.ts';
import { arrManagedEntitiesQueries } from '$db/queries/arrManagedEntities.ts';
import type { ArrManagedEntity, ManagedEntityType } from '$db/queries/arrManagedEntities.ts';

const INSTANCE_ID = 3;
const INSTANCE_TYPE = 'radarr';
const PCD_DATABASE_ID = 11;
const TRASH_SOURCE_ID = 21;

function makeEntityCache(overrides: Partial<TrashGuideEntityCache>): TrashGuideEntityCache {
  return {
    id: 900,
    sourceId: TRASH_SOURCE_ID,
    trashId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    entityType: 'quality_profile',
    name: 'Profile',
    jsonData: '{}',
    filePath: 'entities.json',
    contentHash: 'hash',
    fetchedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function withNoopLogger(): () => void {
  const originalWarn = logger.warn;
  const originalInfo = logger.info;
  const originalError = logger.error;
  const originalDebug = logger.debug;
  const originalErrorWithTrace = logger.errorWithTrace;

  logger.warn = async () => {};
  logger.info = async () => {};
  logger.error = async () => {};
  logger.debug = async () => {};
  logger.errorWithTrace = async () => {};

  return () => {
    logger.warn = originalWarn;
    logger.info = originalInfo;
    logger.error = originalError;
    logger.debug = originalDebug;
    logger.errorWithTrace = originalErrorWithTrace;
  };
}

function withCleanupQueryStubs(setup: () => void): () => void {
  const originalInstanceById = arrInstancesQueries.getById;
  const originalQualitySyncSelections = arrSyncQueries.getQualityProfilesSync;
  const originalNamespaceIndex = arrNamespaceQueries.get;
  const originalTrashNamespaceIndex = arrTrashNamespaceQueries.get;
  const originalTrashSources = trashGuideSyncQueries.getQualityProfileSourceHydrationByInstance;
  const originalTrashSourceById = trashGuideSourcesQueries.getById;
  const originalTrashCacheBySource = trashGuideEntityCacheQueries.getBySource;
  const originalManagedListForInstance = arrManagedEntitiesQueries.listForInstance;
  const originalManagedDeleteConfirmed = arrManagedEntitiesQueries.deleteConfirmed;
  const restoreLogger = withNoopLogger();
  // Default: every TRaSH source already holds persisted index 1; tests override per source.
  arrTrashNamespaceQueries.get = () => 1;
  // Default ledger: nothing is Praxrr-managed, and confirmed deletes are recorded nowhere.
  // Tests that exercise the managed scope override these inside `setup`.
  arrManagedEntitiesQueries.listForInstance = () => [];
  arrManagedEntitiesQueries.deleteConfirmed = () => {};

  setup();

  return () => {
    arrInstancesQueries.getById = originalInstanceById;
    arrSyncQueries.getQualityProfilesSync = originalQualitySyncSelections;
    arrNamespaceQueries.get = originalNamespaceIndex;
    arrTrashNamespaceQueries.get = originalTrashNamespaceIndex;
    trashGuideSyncQueries.getQualityProfileSourceHydrationByInstance = originalTrashSources;
    trashGuideSourcesQueries.getById = originalTrashSourceById;
    trashGuideEntityCacheQueries.getBySource = originalTrashCacheBySource;
    arrManagedEntitiesQueries.listForInstance = originalManagedListForInstance;
    arrManagedEntitiesQueries.deleteConfirmed = originalManagedDeleteConfirmed;
    clearAllCaches();
    restoreLogger();
  };
}

function createFakePcdCache(customFormatNames: string[], profileExists = true): PCDCache {
  const names = [...customFormatNames];
  return {
    kb: {
      selectFrom: (table: string) => ({
        select: () => ({
          where: () => ({
            executeTakeFirst: async () =>
              table === 'quality_profiles' && profileExists ? { name: 'Profile' } : undefined,
            where: () => ({
              execute: async () => names.map((customFormatName) => ({ custom_format_name: customFormatName })),
            }),
          }),
        }),
      }),
    },
    close: () => {},
  } as unknown as PCDCache;
}

Deno.test('scanForStaleItems: keeps expected names from both PCD and TRaSH scopes', async () => {
  const restore = withCleanupQueryStubs(() => {
    arrInstancesQueries.getById = () =>
      ({
        id: INSTANCE_ID,
        name: 'Local Radarr',
        type: INSTANCE_TYPE,
      }) as never;

    arrSyncQueries.getQualityProfilesSync = () =>
      ({
        selections: [{ databaseId: PCD_DATABASE_ID, profileName: 'Local PCD Profile' }],
        config: {
          trigger: 'manual',
          cron: null,
        },
      }) as never;

    arrNamespaceQueries.get = () => 1;

    trashGuideSyncQueries.getQualityProfileSourceHydrationByInstance = () => [
      {
        sourceId: TRASH_SOURCE_ID,
        sourceName: 'Trash Source',
        sourceArrType: 'radarr',
        config: null,
        selectedQualityProfiles: ['Trash Profile'],
      } as never,
    ];

    trashGuideSourcesQueries.getById = () =>
      ({
        id: TRASH_SOURCE_ID,
        name: 'Trash Source',
        repository_url: '',
        branch: '',
        local_path: '',
        arr_type: 'radarr',
        score_profile: 'default',
        sync_strategy: 0,
        auto_pull: 0,
        enabled: 1,
        last_synced_at: null,
        last_commit_hash: null,
        created_at: '',
        updated_at: '',
      }) as never;

    trashGuideEntityCacheQueries.getBySource = () => [
      makeEntityCache({
        id: 901,
        name: 'Trash Profile',
        trashId: '11111111111111111111111111111111',
        entityType: 'quality_profile',
        jsonData: JSON.stringify({
          entity_type: 'quality_profile',
          arr_type: 'radarr',
          trash_id: '11111111111111111111111111111111',
          file_path: 'quality-profiles/trash-profile.json',
          name: 'Trash Profile',
          description: null,
          source_url: null,
          score_set: null,
          group: null,
          upgrade_allowed: true,
          cutoff: 'Bluray-1080p',
          min_format_score: 0,
          cutoff_format_score: 0,
          min_upgrade_format_score: 0,
          language: null,
          items: [
            {
              name: 'Bluray-1080p',
              allowed: true,
              qualities: ['Bluray-1080p'],
            },
          ],
          format_items: [
            {
              name: 'TRaSH CF',
              score: 10,
              custom_format_trash_id: null,
            },
          ],
        }),
      }),
    ];

    setCache(PCD_DATABASE_ID, createFakePcdCache(['PCD CF']));
  });

  const expectedNamespace = getNamespaceSuffix(1);
  const expectedTrashNamespace = getTrashGuideNamespaceSuffix(1);

  try {
    const client = {
      getCustomFormats: async () => [
        { id: 501, name: `PCD CF${expectedNamespace}` },
        { id: 502, name: `TRaSH CF${expectedTrashNamespace}` },
        { id: 503, name: 'Unrelated CF' },
      ],
      getQualityProfiles: async () => [
        { id: 601, name: `Local PCD Profile${expectedNamespace}` },
        { id: 602, name: `Trash Profile${expectedTrashNamespace}` },
        { id: 603, name: 'Unrelated Profile' },
      ],
    } as unknown as BaseArrClient;

    const result = await scanForStaleItems(client, INSTANCE_ID, true);

    assertEquals(result.staleCustomFormats, [{ id: 503, name: 'Unrelated CF', strippedName: 'Unrelated CF' }]);
    assertEquals(result.staleQualityProfiles, [
      { id: 603, name: 'Unrelated Profile', strippedName: 'Unrelated Profile' },
    ]);
  } finally {
    restore();
  }
});

Deno.test('scanForStaleItems: throws when TRaSH cache rows are all malformed', async () => {
  const restore = withCleanupQueryStubs(() => {
    arrInstancesQueries.getById = () =>
      ({
        id: INSTANCE_ID,
        name: 'Local Radarr',
        type: INSTANCE_TYPE,
      }) as never;

    arrSyncQueries.getQualityProfilesSync = () =>
      ({
        selections: [],
        config: {
          trigger: 'manual',
          cron: null,
        },
      }) as never;

    arrNamespaceQueries.get = () => 1;

    trashGuideSyncQueries.getQualityProfileSourceHydrationByInstance = () => [
      {
        sourceId: TRASH_SOURCE_ID,
        sourceName: 'Trash Source',
        sourceArrType: 'radarr',
        config: null,
        selectedQualityProfiles: ['Trash Profile'],
      } as never,
    ];

    trashGuideSourcesQueries.getById = () =>
      ({
        id: TRASH_SOURCE_ID,
        name: 'Trash Source',
        repository_url: '',
        branch: '',
        local_path: '',
        arr_type: 'radarr',
        score_profile: 'default',
        sync_strategy: 0,
        auto_pull: 0,
        enabled: 1,
        last_synced_at: null,
        last_commit_hash: null,
        created_at: '',
        updated_at: '',
      }) as never;

    trashGuideEntityCacheQueries.getBySource = () => [
      makeEntityCache({
        id: 902,
        name: 'Trash Profile',
        trashId: '22222222222222222222222222222222',
        entityType: 'quality_profile',
        jsonData: '{broken',
      }),
    ];
  });

  try {
    const client = {
      getCustomFormats: async () => [],
      getQualityProfiles: async () => [],
    } as unknown as BaseArrClient;

    await assertRejects(
      () => scanForStaleItems(client, INSTANCE_ID),
      Error,
      'Failed to parse all TRaSH cache rows for source "Trash Source" during cleanup scan'
    );
  } finally {
    restore();
  }
});

Deno.test('deleteStaleItems: skips assigned quality profiles and keeps successful deletions', async () => {
  const restoreLogger = withNoopLogger();
  const client = {
    deleteCustomFormat: async (id: number) => {
      if (id === 901) {
        throw new Error('failed custom format delete');
      }
    },
    deleteQualityProfile: async (id: number) => {
      if (id === 1001) {
        throw new HttpError('quality profile is assigned', 500);
      }
      if (id === 1002) {
        throw new Error('failed quality profile delete');
      }
    },
  } as unknown as BaseArrClient;

  const result = await deleteStaleItems(client, {
    staleCustomFormats: [
      { id: 901, name: 'Custom 1', strippedName: 'Custom 1' },
      { id: 902, name: 'Custom 2', strippedName: 'Custom 2' },
    ],
    staleQualityProfiles: [
      { id: 1001, name: 'QP 1', strippedName: 'QP 1' },
      { id: 1002, name: 'QP 2', strippedName: 'QP 2' },
      { id: 1003, name: 'QP 3', strippedName: 'QP 3' },
    ],
  });

  try {
    assertEquals(result.deletedCustomFormats, [{ id: 902, name: 'Custom 2', strippedName: 'Custom 2' }]);
    assertEquals(result.deletedQualityProfiles, [{ id: 1003, name: 'QP 3', strippedName: 'QP 3' }]);
    assertEquals(result.failedCustomFormats, [
      {
        item: { id: 901, name: 'Custom 1', strippedName: 'Custom 1' },
        reason: 'The delete failed unexpectedly.',
      },
    ]);
    assertEquals(result.skippedQualityProfiles, [
      {
        item: { id: 1001, name: 'QP 1', strippedName: 'QP 1' },
        reason: 'Profile is assigned to media',
      },
      {
        item: { id: 1002, name: 'QP 2', strippedName: 'QP 2' },
        reason: 'The delete failed unexpectedly.',
      },
    ]);
  } finally {
    restoreLogger();
  }
});

Deno.test(
  'deleteStaleItems: upstream HttpError body with credential-looking string never reaches reasons',
  async () => {
    const restoreLogger = withNoopLogger();
    const upstreamBody = '{"message":"apikey=sk_live_SECRET123"}';
    const client = {
      deleteCustomFormat: async () => {
        throw new HttpError(`HTTP 400: Bad Request | ${upstreamBody}`, 400, JSON.parse(upstreamBody));
      },
      deleteQualityProfile: async (id: number) => {
        if (id === 1001) {
          throw new HttpError(`HTTP 500: Internal Server Error | ${upstreamBody}`, 500, JSON.parse(upstreamBody));
        }
        throw new HttpError(`HTTP 400: Bad Request | ${upstreamBody}`, 400, JSON.parse(upstreamBody));
      },
    } as unknown as BaseArrClient;

    try {
      const result = await deleteStaleItems(client, {
        staleCustomFormats: [{ id: 901, name: 'Custom 1', strippedName: 'Custom 1' }],
        staleQualityProfiles: [
          { id: 1001, name: 'QP 1', strippedName: 'QP 1' },
          { id: 1002, name: 'QP 2', strippedName: 'QP 2' },
        ],
      });

      assertEquals(result.failedCustomFormats[0].reason, 'The Arr instance rejected the request (HTTP 400).');
      assertEquals(
        result.skippedQualityProfiles.map((entry) => entry.reason),
        ['Profile is assigned to media', 'The Arr instance rejected the request (HTTP 400).']
      );
      assertEquals(JSON.stringify(result).includes('SECRET123'), false);
    } finally {
      restoreLogger();
    }
  }
);

// --- YAN-471 / YAN-444 regressions: cleanup must never delete live configs ---

const ZWSP = '\u200B';

function makeTrashSource(id: number, name: string) {
  return {
    id,
    name,
    repository_url: '',
    branch: '',
    local_path: '',
    arr_type: 'radarr',
    score_profile: 'default',
    sync_strategy: 0,
    auto_pull: 0,
    enabled: 1,
    last_synced_at: null,
    last_commit_hash: null,
    created_at: '',
    updated_at: '',
  } as never;
}

function makeTrashProfileRow(sourceId: number, trashId: string, profileName: string, cfName: string) {
  return makeEntityCache({
    sourceId,
    name: profileName,
    trashId,
    entityType: 'quality_profile',
    jsonData: JSON.stringify({
      entity_type: 'quality_profile',
      arr_type: 'radarr',
      trash_id: trashId,
      file_path: `quality-profiles/${trashId}.json`,
      name: profileName,
      description: null,
      source_url: null,
      score_set: null,
      group: null,
      upgrade_allowed: true,
      cutoff: 'Bluray-1080p',
      min_format_score: 0,
      cutoff_format_score: 0,
      min_upgrade_format_score: 0,
      language: null,
      items: [{ name: 'Bluray-1080p', allowed: true, qualities: ['Bluray-1080p'] }],
      format_items: [{ name: cfName, score: 10, custom_format_trash_id: null }],
    }),
  });
}

function stubInstance(): void {
  arrInstancesQueries.getById = () => ({ id: INSTANCE_ID, name: 'Local Radarr', type: INSTANCE_TYPE }) as never;
}

function stubPcdSelections(selections: { databaseId: number; profileName: string }[]): void {
  arrSyncQueries.getQualityProfilesSync = () => ({ selections, config: { trigger: 'manual', cron: null } }) as never;
}

function stubTrashHydrations(hydrations: { sourceId: number; selectedQualityProfiles: string[] }[]): void {
  trashGuideSyncQueries.getQualityProfileSourceHydrationByInstance = () =>
    hydrations.map((hydration) => ({
      sourceName: `Source ${hydration.sourceId}`,
      sourceArrType: 'radarr',
      config: null,
      ...hydration,
    })) as never;
}

function remoteClient(cfs: { id: number; name: string }[], qps: { id: number; name: string }[]): BaseArrClient {
  return {
    getCustomFormats: async () => cfs,
    getQualityProfiles: async () => qps,
  } as unknown as BaseArrClient;
}

Deno.test('scanForStaleItems: keeps exact namespace of a PCD selection whose cache is unavailable', async () => {
  const NO_CACHE_DB = 11;
  const CACHED_DB = 12;
  const restore = withCleanupQueryStubs(() => {
    stubInstance();
    stubPcdSelections([
      { databaseId: NO_CACHE_DB, profileName: 'Uncached Profile' },
      { databaseId: CACHED_DB, profileName: 'Cached Profile' },
    ]);
    arrNamespaceQueries.get = (_instanceId: number, databaseId: number) => (databaseId === NO_CACHE_DB ? 1 : 2);
    stubTrashHydrations([]);
    setCache(CACHED_DB, createFakePcdCache(['Cached CF']));
  });

  const uncachedSuffix = getNamespaceSuffix(1);
  const cachedSuffix = getNamespaceSuffix(2);
  try {
    const result = await scanForStaleItems(
      remoteClient(
        [
          { id: 501, name: `Uncached CF${uncachedSuffix}` },
          { id: 502, name: `Cached CF${cachedSuffix}` },
          { id: 503, name: `Unexpected CF${cachedSuffix}` },
          // Ends in U+200B but its full suffix run is a TRaSH suffix, not the uncached DB's.
          { id: 504, name: `Trash Shaped CF${getTrashGuideNamespaceSuffix(1)}` },
          { id: 505, name: 'Unsuffixed CF' },
        ],
        [
          { id: 601, name: `Uncached Profile${uncachedSuffix}` },
          { id: 602, name: `Old Uncached Profile${uncachedSuffix}` },
          { id: 603, name: `Cached Profile${cachedSuffix}` },
          { id: 604, name: `Old Cached Profile${cachedSuffix}` },
        ]
      ),
      INSTANCE_ID,
      true
    );

    assertEquals(
      result.staleCustomFormats.map((item) => item.id),
      [503, 504, 505]
    );
    assertEquals(
      result.staleQualityProfiles.map((item) => item.id),
      [604]
    );
  } finally {
    restore();
  }
});

Deno.test('scanForStaleItems: TRaSH suffixes come from persisted per-source indexes, not position', async () => {
  const SOURCE_A = 21;
  const SOURCE_B = 22;
  const restore = withCleanupQueryStubs(() => {
    stubInstance();
    stubPcdSelections([]);
    arrNamespaceQueries.get = () => null;
    // A was synced first (index 1); B holds index 2 even though A now resolves no profiles.
    arrTrashNamespaceQueries.get = (_instanceId: number, sourceId: number) => (sourceId === SOURCE_A ? 1 : 2);
    stubTrashHydrations([
      { sourceId: SOURCE_A, selectedQualityProfiles: ['Removed Profile'] },
      { sourceId: SOURCE_B, selectedQualityProfiles: ['Profile B'] },
    ]);
    trashGuideSourcesQueries.getById = (id: number) => makeTrashSource(id, `Source ${id}`);
    trashGuideEntityCacheQueries.getBySource = (sourceId: number) =>
      sourceId === SOURCE_A
        ? [makeTrashProfileRow(SOURCE_A, 'a'.repeat(32), 'Profile A', 'CF A')]
        : [makeTrashProfileRow(SOURCE_B, 'b'.repeat(32), 'Profile B', 'CF B')];
  });

  const sourceASuffix = getTrashGuideNamespaceSuffix(1);
  const sourceBSuffix = getTrashGuideNamespaceSuffix(2);
  try {
    const result = await scanForStaleItems(
      remoteClient(
        [
          { id: 501, name: `CF B${sourceBSuffix}` },
          { id: 502, name: `CF B${getTrashGuideNamespaceSuffix(3)}` },
          // A's selected profile vanished from its source: its namespace is kept.
          { id: 503, name: `CF A${sourceASuffix}` },
        ],
        [
          { id: 601, name: `Profile B${sourceBSuffix}` },
          { id: 602, name: `Profile B${getTrashGuideNamespaceSuffix(3)}` },
          { id: 603, name: `Removed Profile${sourceASuffix}` },
        ]
      ),
      INSTANCE_ID,
      true
    );

    assertEquals(
      result.staleCustomFormats.map((item) => item.id),
      [502]
    );
    assertEquals(
      result.staleQualityProfiles.map((item) => item.id),
      [602]
    );
  } finally {
    restore();
  }
});

Deno.test('scanForStaleItems: resolvable TRaSH source with no persisted index keeps every TRaSH item', async () => {
  const restore = withCleanupQueryStubs(() => {
    stubInstance();
    stubPcdSelections([]);
    arrNamespaceQueries.get = () => null;
    arrTrashNamespaceQueries.get = () => null;
    stubTrashHydrations([{ sourceId: TRASH_SOURCE_ID, selectedQualityProfiles: ['P1'] }]);
    trashGuideSourcesQueries.getById = (id: number) => makeTrashSource(id, 'Trash Source');
    trashGuideEntityCacheQueries.getBySource = () => [
      makeTrashProfileRow(TRASH_SOURCE_ID, 'd'.repeat(32), 'P1', 'CF P1'),
    ];
  });

  try {
    const result = await scanForStaleItems(
      remoteClient(
        [
          { id: 501, name: `CF P1${getTrashGuideNamespaceSuffix(1)}` },
          { id: 502, name: `Old Trash CF${getTrashGuideNamespaceSuffix(2)}` },
          { id: 503, name: `DB CF${ZWSP}` },
        ],
        [{ id: 601, name: `P1${getTrashGuideNamespaceSuffix(1)}` }]
      ),
      INSTANCE_ID,
      true
    );

    assertEquals(
      result.staleCustomFormats.map((item) => item.id),
      [503]
    );
    assertEquals(result.staleQualityProfiles, []);
  } finally {
    restore();
  }
});

Deno.test('scanForStaleItems: keeps the namespace of a TRaSH source with a selected profile missing', async () => {
  const SOURCE_X = 23;
  const restore = withCleanupQueryStubs(() => {
    stubInstance();
    stubPcdSelections([]);
    arrNamespaceQueries.get = () => null;
    stubTrashHydrations([{ sourceId: SOURCE_X, selectedQualityProfiles: ['P1', 'P2'] }]);
    trashGuideSourcesQueries.getById = (id: number) => makeTrashSource(id, `Source ${id}`);
    // P2 was synced earlier but no longer exists in the source.
    trashGuideEntityCacheQueries.getBySource = () => [makeTrashProfileRow(SOURCE_X, 'c'.repeat(32), 'P1', 'CF P1')];
  });

  const suffix = getTrashGuideNamespaceSuffix(1);
  try {
    const result = await scanForStaleItems(
      remoteClient(
        [
          { id: 501, name: `CF P1${suffix}` },
          { id: 502, name: `CF Only P2 Used${suffix}` },
          { id: 503, name: `CF Other Trash${getTrashGuideNamespaceSuffix(2)}` },
          { id: 504, name: `DB CF${ZWSP}` },
          { id: 505, name: 'Unrelated CF' },
        ],
        [
          { id: 601, name: `P1${suffix}` },
          { id: 602, name: `P2${suffix}` },
          { id: 603, name: `P2${getTrashGuideNamespaceSuffix(2)}` },
          { id: 604, name: 'Unrelated Profile' },
        ]
      ),
      INSTANCE_ID,
      true
    );

    assertEquals(
      result.staleCustomFormats.map((item) => item.id),
      [503, 504, 505]
    );
    assertEquals(
      result.staleQualityProfiles.map((item) => item.id),
      [603, 604]
    );
  } finally {
    restore();
  }
});

Deno.test('scanForStaleItems: TRaSH source with empty cache keeps every TRaSH-suffixed item', async () => {
  const restore = withCleanupQueryStubs(() => {
    stubInstance();
    stubPcdSelections([]);
    arrNamespaceQueries.get = () => null;
    stubTrashHydrations([{ sourceId: TRASH_SOURCE_ID, selectedQualityProfiles: ['Trash Profile'] }]);
    trashGuideSourcesQueries.getById = (id: number) => makeTrashSource(id, 'Trash Source');
    trashGuideEntityCacheQueries.getBySource = () => [];
  });

  try {
    const result = await scanForStaleItems(
      remoteClient(
        [
          { id: 501, name: `Trash CF${getTrashGuideNamespaceSuffix(1)}` },
          { id: 502, name: `Other Trash CF${getTrashGuideNamespaceSuffix(3)}` },
          { id: 503, name: `DB CF${ZWSP}` },
          { id: 504, name: 'Unsuffixed CF' },
        ],
        [
          { id: 601, name: `Trash Profile${getTrashGuideNamespaceSuffix(1)}` },
          { id: 602, name: `DB Profile${ZWSP}` },
        ]
      ),
      INSTANCE_ID,
      true
    );

    assertEquals(
      result.staleCustomFormats.map((item) => item.id),
      [503, 504]
    );
    assertEquals(
      result.staleQualityProfiles.map((item) => item.id),
      [602]
    );
  } finally {
    restore();
  }
});

function executeFixture(): { restore: () => void; client: BaseArrClient; deleted: { cfs: number[]; qps: number[] } } {
  const restore = withCleanupQueryStubs(() => {
    stubInstance();
    stubPcdSelections([{ databaseId: PCD_DATABASE_ID, profileName: 'Live Profile' }]);
    arrNamespaceQueries.get = () => 1;
    stubTrashHydrations([]);
    setCache(PCD_DATABASE_ID, createFakePcdCache(['Live CF']));
  });
  const deleted = { cfs: [] as number[], qps: [] as number[] };
  const client = {
    getCustomFormats: async () => [
      { id: 501, name: `Live CF${ZWSP}` },
      { id: 502, name: 'Old CF' },
    ],
    getQualityProfiles: async () => [
      { id: 601, name: `Live Profile${ZWSP}` },
      { id: 602, name: 'Old Profile' },
    ],
    deleteCustomFormat: async (id: number) => {
      deleted.cfs.push(id);
    },
    deleteQualityProfile: async (id: number) => {
      deleted.qps.push(id);
    },
  } as unknown as BaseArrClient;
  return { restore, client, deleted };
}

Deno.test('executeCleanup: does not delete requested items that are no longer stale', async () => {
  const { restore, client, deleted } = executeFixture();
  const liveCf = { id: 501, name: `Live CF${ZWSP}`, strippedName: 'Live CF' };
  const liveQp = { id: 601, name: `Live Profile${ZWSP}`, strippedName: 'Live Profile' };
  try {
    const result = await executeCleanup(
      client,
      INSTANCE_ID,
      {
        // Duplicates keep the first entry: neither deleted twice nor reported as rejected.
        staleCustomFormats: [
          liveCf,
          { id: 502, name: 'Old CF', strippedName: 'Old CF' },
          { id: 502, name: 'Old CF', strippedName: 'Old CF' },
          { id: 501, name: 'Mismatched Duplicate', strippedName: 'Mismatched Duplicate' },
        ],
        staleQualityProfiles: [
          liveQp,
          { id: 602, name: 'Old Profile', strippedName: 'Old Profile' },
          { id: 602, name: 'Old Profile', strippedName: 'Old Profile' },
        ],
      },
      true
    );

    assertEquals(deleted, { cfs: [502], qps: [602] });
    assertEquals(result.deletedCustomFormats, [{ id: 502, name: 'Old CF', strippedName: 'Old CF' }]);
    assertEquals(result.deletedQualityProfiles, [{ id: 602, name: 'Old Profile', strippedName: 'Old Profile' }]);
    assertEquals(result.failedCustomFormats, [{ item: liveCf, reason: NO_LONGER_STALE_REASON }]);
    assertEquals(result.skippedQualityProfiles, [{ item: liveQp, reason: NO_LONGER_STALE_REASON }]);
    assertEquals(NO_LONGER_STALE_REASON, 'No longer stale; not deleted');
  } finally {
    restore();
  }
});

Deno.test('executeCleanup: does not delete items whose id and name do not both match a stale item', async () => {
  const { restore, client, deleted } = executeFixture();
  // Replayed scan result from another instance: ids collide with this instance's stale items.
  const replayedCf = { id: 502, name: 'Other Instance CF', strippedName: 'Other Instance CF' };
  const replayedQp = { id: 602, name: 'Other Instance Profile', strippedName: 'Other Instance Profile' };
  try {
    const result = await executeCleanup(
      client,
      INSTANCE_ID,
      {
        staleCustomFormats: [replayedCf],
        staleQualityProfiles: [replayedQp],
      },
      true
    );

    assertEquals(deleted, { cfs: [], qps: [] });
    assertEquals(result.deletedCustomFormats, []);
    assertEquals(result.deletedQualityProfiles, []);
    assertEquals(result.failedCustomFormats, [{ item: replayedCf, reason: NO_LONGER_STALE_REASON }]);
    assertEquals(result.skippedQualityProfiles, [{ item: replayedQp, reason: NO_LONGER_STALE_REASON }]);
  } finally {
    restore();
  }
});

// --- YAN-516: cleanup scoped to the ownership ledger by default ---

/**
 * Live instance state: 'Live CF'/'Live Profile' are expected (current selection),
 * 'Old CF'/'Old Profile' and 'Unrelated CF' are unexpected. `managed` controls
 * which remote ids the ownership ledger claims.
 */
function scopedFixture(managed: Partial<Record<ManagedEntityType, number[]>>): {
  restore: () => void;
  client: BaseArrClient;
  deleted: { entityType: ManagedEntityType; remoteId: number }[];
} {
  const deleted: { entityType: ManagedEntityType; remoteId: number }[] = [];
  const restore = withCleanupQueryStubs(() => {
    stubInstance();
    stubPcdSelections([{ databaseId: PCD_DATABASE_ID, profileName: 'Live Profile' }]);
    arrNamespaceQueries.get = () => 1;
    stubTrashHydrations([]);
    setCache(PCD_DATABASE_ID, createFakePcdCache(['Live CF']));
    arrManagedEntitiesQueries.listForInstance = () =>
      Object.entries(managed).flatMap(([entityType, ids]) =>
        ids.map(
          (remoteId) =>
            ({
              entityType,
              remoteId,
              arrName: remoteId === 502 ? 'Old CF' : remoteId === 602 ? 'Old Profile' : 'Unrelated CF',
            }) as ArrManagedEntity
        )
      );
    arrManagedEntitiesQueries.deleteConfirmed = (
      _instanceId: number,
      entityType: ManagedEntityType,
      remoteId: number
    ) => {
      deleted.push({ entityType, remoteId });
    };
  });
  const client = {
    getCustomFormats: async () => [
      { id: 501, name: `Live CF${ZWSP}` },
      { id: 502, name: 'Old CF' },
      { id: 503, name: 'Unrelated CF' },
    ],
    getQualityProfiles: async () => [
      { id: 601, name: `Live Profile${ZWSP}` },
      { id: 602, name: 'Old Profile' },
    ],
    deleteCustomFormat: async (_id: number) => {},
    deleteQualityProfile: async (_id: number) => {},
  } as unknown as BaseArrClient;
  return { restore, client, deleted };
}

Deno.test('scanForStaleItems: default scope excludes hand-made unexpected items', async () => {
  const { restore, client } = scopedFixture({ customFormat: [502] });
  try {
    const result = await scanForStaleItems(client, INSTANCE_ID);

    // Only the ledger-managed 'Old CF' is stale; hand-made 'Unrelated CF' and the
    // unmanaged 'Old Profile' are outside the default scope.
    assertEquals(result.staleCustomFormats, [{ id: 502, name: 'Old CF', strippedName: 'Old CF' }]);
    assertEquals(result.staleQualityProfiles, []);
  } finally {
    restore();
  }
});

Deno.test('scanForStaleItems: includeUnmanaged lists hand-made unexpected items', async () => {
  const { restore, client } = scopedFixture({ customFormat: [502] });
  try {
    const result = await scanForStaleItems(client, INSTANCE_ID, true);

    assertEquals(
      result.staleCustomFormats.map((item) => item.id),
      [502, 503]
    );
    assertEquals(
      result.staleQualityProfiles.map((item) => item.id),
      [602]
    );
  } finally {
    restore();
  }
});

Deno.test('scanForStaleItems: ledger read failure fails closed with an empty stale list', async () => {
  const restore = withCleanupQueryStubs(() => {
    stubInstance();
    stubPcdSelections([{ databaseId: PCD_DATABASE_ID, profileName: 'Live Profile' }]);
    arrNamespaceQueries.get = () => 1;
    stubTrashHydrations([]);
    setCache(PCD_DATABASE_ID, createFakePcdCache(['Live CF']));
    arrManagedEntitiesQueries.listForInstance = () => {
      throw new Error('ledger unavailable');
    };
  });

  try {
    const result = await scanForStaleItems(remoteClient([{ id: 502, name: 'Old CF' }], []), INSTANCE_ID);

    assertEquals(result.staleCustomFormats, []);
    assertEquals(result.staleQualityProfiles, []);
  } finally {
    restore();
  }
});

Deno.test('executeCleanup: default scope cannot delete an unmanaged id', async () => {
  const { restore, client, deleted } = scopedFixture({ customFormat: [502] });
  try {
    const result = await executeCleanup(client, INSTANCE_ID, {
      staleCustomFormats: [
        { id: 502, name: 'Old CF', strippedName: 'Old CF' },
        { id: 503, name: 'Unrelated CF', strippedName: 'Unrelated CF' },
      ],
      staleQualityProfiles: [{ id: 602, name: 'Old Profile', strippedName: 'Old Profile' }],
    });

    // The fresh re-scan under the same managed-only scope is the deletion authority:
    // only the ledger-owned 'Old CF' is deleted.
    assertEquals(result.deletedCustomFormats, [{ id: 502, name: 'Old CF', strippedName: 'Old CF' }]);
    assertEquals(result.deletedQualityProfiles, []);
    assertEquals(result.failedCustomFormats, [
      { item: { id: 503, name: 'Unrelated CF', strippedName: 'Unrelated CF' }, reason: NO_LONGER_STALE_REASON },
    ]);
    assertEquals(result.skippedQualityProfiles, [
      { item: { id: 602, name: 'Old Profile', strippedName: 'Old Profile' }, reason: NO_LONGER_STALE_REASON },
    ]);
    assertEquals(deleted, [{ entityType: 'customFormat', remoteId: 502 }]);
  } finally {
    restore();
  }
});

Deno.test('scanForStaleItems: ledger id with a different recorded name is not managed', async () => {
  const { restore, client } = scopedFixture({ customFormat: [502], qualityProfile: [602] });
  arrManagedEntitiesQueries.listForInstance = () =>
    [
      { entityType: 'customFormat', remoteId: 502, arrName: 'Original CF' },
      { entityType: 'qualityProfile', remoteId: 602, arrName: 'Original Profile' },
    ] as ArrManagedEntity[];
  try {
    const result = await scanForStaleItems(client, INSTANCE_ID);
    assertEquals(result.staleCustomFormats, []);
    assertEquals(result.staleQualityProfiles, []);
    const execution = await executeCleanup(client, INSTANCE_ID, {
      staleCustomFormats: [{ id: 502, name: 'Old CF', strippedName: 'Old CF' }],
      staleQualityProfiles: [{ id: 602, name: 'Old Profile', strippedName: 'Old Profile' }],
    });
    assertEquals(execution.deletedCustomFormats, []);
    assertEquals(execution.deletedQualityProfiles, []);
  } finally {
    restore();
  }
});

Deno.test('scanForStaleItems: missing selected PCD profile keeps its whole namespace', async () => {
  const restore = withCleanupQueryStubs(() => {
    stubInstance();
    stubPcdSelections([{ databaseId: PCD_DATABASE_ID, profileName: 'Missing' }]);
    arrNamespaceQueries.get = () => 1;
    stubTrashHydrations([]);
    setCache(PCD_DATABASE_ID, createFakePcdCache([], false));
  });
  try {
    const result = await scanForStaleItems(
      remoteClient([{ id: 502, name: `Old CF${ZWSP}` }], [{ id: 602, name: `Missing${ZWSP}` }]),
      INSTANCE_ID,
      true
    );
    assertEquals(result.staleCustomFormats, []);
    assertEquals(result.staleQualityProfiles, []);
  } finally {
    restore();
  }
});

Deno.test('executeCleanup: removes ledger rows for deleted ids in both scopes', async () => {
  // Managed-only: the ledger row for the deleted managed CF is dropped.
  const managedScope = scopedFixture({ customFormat: [502] });
  try {
    await executeCleanup(managedScope.client, INSTANCE_ID, {
      staleCustomFormats: [{ id: 502, name: 'Old CF', strippedName: 'Old CF' }],
      staleQualityProfiles: [],
    });
    assertEquals(managedScope.deleted, [{ entityType: 'customFormat', remoteId: 502 }]);
  } finally {
    managedScope.restore();
  }

  // Unmanaged: rows drop for every deleted id, including hand-made entities.
  const unmanagedScope = scopedFixture({ customFormat: [502, 503], qualityProfile: [602] });
  try {
    await executeCleanup(
      unmanagedScope.client,
      INSTANCE_ID,
      {
        staleCustomFormats: [
          { id: 502, name: 'Old CF', strippedName: 'Old CF' },
          { id: 503, name: 'Unrelated CF', strippedName: 'Unrelated CF' },
        ],
        staleQualityProfiles: [{ id: 602, name: 'Old Profile', strippedName: 'Old Profile' }],
      },
      true
    );
    assertEquals(unmanagedScope.deleted, [
      { entityType: 'customFormat', remoteId: 502 },
      { entityType: 'customFormat', remoteId: 503 },
      { entityType: 'qualityProfile', remoteId: 602 },
    ]);
  } finally {
    unmanagedScope.restore();
  }
});
