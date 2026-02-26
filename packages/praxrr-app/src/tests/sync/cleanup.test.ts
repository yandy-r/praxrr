import { assertEquals, assertRejects } from '@std/assert';
import { HttpError } from '$http/types.ts';
import { getTrashGuideNamespaceSuffix, getNamespaceSuffix } from '$sync/namespace.ts';
import type { BaseArrClient } from '$utils/arr/base.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { arrNamespaceQueries } from '$db/queries/arrNamespaces.ts';
import { trashGuideSyncQueries } from '$db/queries/trashGuideSync.ts';
import { trashGuideSourcesQueries } from '$db/queries/trashGuideSources.ts';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import type { TrashGuideEntityCache } from '$db/queries/trashGuideEntityCache.ts';
import type { PCDCache } from '$pcd/index.ts';
import { clearAllCaches, setCache } from '$pcd/database/registry.ts';
import { logger } from '$logger/logger.ts';
import { deleteStaleItems, scanForStaleItems } from '$sync/cleanup.ts';

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
  const originalTrashSources = trashGuideSyncQueries.getQualityProfileSourceHydrationByInstance;
  const originalTrashSourceById = trashGuideSourcesQueries.getById;
  const originalTrashCacheBySource = trashGuideEntityCacheQueries.getBySource;
  const restoreLogger = withNoopLogger();

  setup();

  return () => {
    arrInstancesQueries.getById = originalInstanceById;
    arrSyncQueries.getQualityProfilesSync = originalQualitySyncSelections;
    arrNamespaceQueries.get = originalNamespaceIndex;
    trashGuideSyncQueries.getQualityProfileSourceHydrationByInstance = originalTrashSources;
    trashGuideSourcesQueries.getById = originalTrashSourceById;
    trashGuideEntityCacheQueries.getBySource = originalTrashCacheBySource;
    clearAllCaches();
    restoreLogger();
  };
}

function createFakePcdCache(customFormatNames: string[]): PCDCache {
  const names = [...customFormatNames];
  return {
    kb: {
      selectFrom: () => ({
        select: () => ({
          where: () => ({
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

    const result = await scanForStaleItems(client, INSTANCE_ID);

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
    assertEquals(result.skippedQualityProfiles, [
      {
        item: { id: 1001, name: 'QP 1', strippedName: 'QP 1' },
        reason: 'Profile is assigned to media',
      },
      {
        item: { id: 1002, name: 'QP 2', strippedName: 'QP 2' },
        reason: 'failed quality profile delete',
      },
    ]);
  } finally {
    restoreLogger();
  }
});
