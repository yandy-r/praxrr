import { assertEquals, assertExists } from '@std/assert';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';
import type { JobQueueRecord, JobSource } from '$jobs/queueTypes.ts';
import {
  isSyncSectionSupported,
  getUnsupportedSyncSectionReason,
  SYNC_SECTION_ORDER,
  type SyncArrType,
} from '$lib/server/sync/mappings.ts';
import type { SectionType } from '$lib/server/sync/types.ts';

import '$jobs/handlers/arrSync.ts';
import '$sync/metadataProfiles/handler.ts';

function createInstance(id: number, type: ArrInstance['type']): ArrInstance {
  const now = new Date().toISOString();
  return {
    id,
    name: `${type}-${id}`,
    type,
    external_url: null,
    url: 'http://127.0.0.1:8989',
    api_key: `${type}-key`,
    tags: null,
    enabled: 1,
    created_at: now,
    updated_at: now,
  };
}

function createSyncJob(instanceId: number, source: JobSource, section?: SectionType): JobQueueRecord {
  const now = new Date().toISOString();
  return {
    id: instanceId,
    jobType: 'arr.sync',
    status: 'queued',
    runAt: now,
    payload: {
      instanceId,
      section: section ?? 'qualityProfiles',
    },
    source,
    dedupeKey: null,
    cooldownUntil: null,
    attempts: 0,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function createAllSectionsSyncJob(instanceId: number, source: JobSource): JobQueueRecord {
  const job = createSyncJob(instanceId, source);
  delete job.payload.section;
  return job;
}

// =============================================================================
// Sync mapping unit tests (pure functions, no handler mocking needed)
// =============================================================================

Deno.test('isSyncSectionSupported: lidarr supports delayProfiles', () => {
  assertEquals(isSyncSectionSupported('lidarr', 'delayProfiles'), true);
});

Deno.test('isSyncSectionSupported: lidarr supports mediaManagement', () => {
  assertEquals(isSyncSectionSupported('lidarr', 'mediaManagement'), true);
});

Deno.test('isSyncSectionSupported: lidarr supports qualityProfiles', () => {
  assertEquals(isSyncSectionSupported('lidarr', 'qualityProfiles'), true);
});

Deno.test('isSyncSectionSupported: lidarr supports metadataProfiles', () => {
  assertEquals(isSyncSectionSupported('lidarr', 'metadataProfiles'), true);
});

const BASE_SECTION_ORDER: SectionType[] = ['qualityProfiles', 'delayProfiles', 'mediaManagement'];

Deno.test('isSyncSectionSupported: radarr supports base sections', () => {
  for (const section of BASE_SECTION_ORDER) {
    assertEquals(isSyncSectionSupported('radarr', section), true);
  }
});

Deno.test('isSyncSectionSupported: sonarr supports base sections', () => {
  for (const section of BASE_SECTION_ORDER) {
    assertEquals(isSyncSectionSupported('sonarr', section), true);
  }
});

Deno.test('isSyncSectionSupported: radarr and sonarr do not support metadataProfiles', () => {
  assertEquals(isSyncSectionSupported('radarr', 'metadataProfiles'), false);
  assertEquals(isSyncSectionSupported('sonarr', 'metadataProfiles'), false);
});

Deno.test('getUnsupportedSyncSectionReason: returns null for supported sections', () => {
  const supportedCases: Array<[SyncArrType, SectionType]> = [
    ['radarr', 'qualityProfiles'],
    ['radarr', 'delayProfiles'],
    ['radarr', 'mediaManagement'],
    ['sonarr', 'qualityProfiles'],
    ['sonarr', 'delayProfiles'],
    ['sonarr', 'mediaManagement'],
    ['lidarr', 'qualityProfiles'],
    ['lidarr', 'delayProfiles'],
    ['lidarr', 'mediaManagement'],
    ['lidarr', 'metadataProfiles'],
  ];

  for (const [arrType, section] of supportedCases) {
    const reason = getUnsupportedSyncSectionReason(arrType, section);
    assertEquals(reason, null, `${arrType}/${section} should be null`);
  }
});

Deno.test('getUnsupportedSyncSectionReason: lidarr metadataProfiles has no unsupported reason', () => {
  assertEquals(getUnsupportedSyncSectionReason('lidarr', 'metadataProfiles'), null);
});

Deno.test('getUnsupportedSyncSectionReason: explicit unsupported metadataProfiles reason for radarr/sonarr', () => {
  assertEquals(
    getUnsupportedSyncSectionReason('radarr', 'metadataProfiles'),
    'Section metadataProfiles is not supported for radarr'
  );
  assertEquals(
    getUnsupportedSyncSectionReason('sonarr', 'metadataProfiles'),
    'Section metadataProfiles is not supported for sonarr'
  );
});

Deno.test('getUnsupportedSyncSectionReason: lidarr qualityProfiles has no unsupported reason', () => {
  assertEquals(getUnsupportedSyncSectionReason('lidarr', 'qualityProfiles'), null);
});

Deno.test('SYNC_SECTION_ORDER: includes metadataProfiles as fourth section', () => {
  assertEquals(SYNC_SECTION_ORDER, ['qualityProfiles', 'delayProfiles', 'mediaManagement', 'metadataProfiles']);
});

// =============================================================================
// Handler integration tests (mock DB queries, exercise handler logic)
// =============================================================================

Deno.test({
  name: 'arr.sync qualityProfiles: lidarr has parity behavior with radarr/sonarr skip semantics',
  sanitizeResources: false,
  fn: async () => {
    const handler = jobQueueRegistry.get('arr.sync');
    assertExists(handler);

    const instances = new Map<number, ArrInstance>([
      [101, createInstance(101, 'lidarr')],
      [102, createInstance(102, 'radarr')],
      [103, createInstance(103, 'sonarr')],
    ]);

    const originalGetById = arrInstancesQueries.getById;
    const originalGetSyncConfigStatus = arrSyncQueries.getSyncConfigStatus;
    const originalGetQualityProfilesSync = arrSyncQueries.getQualityProfilesSync;
    const originalGetNextScheduledRunAt = arrSyncQueries.getNextScheduledRunAt;

    arrInstancesQueries.getById = (id: number) => instances.get(id);
    arrSyncQueries.getSyncConfigStatus = () => ({
      qualityProfiles: {
        trigger: 'manual',
        cron: null,
        nextRunAt: null,
        syncStatus: 'idle',
      },
      delayProfiles: {
        trigger: 'manual',
        cron: null,
        nextRunAt: null,
        syncStatus: 'idle',
      },
      mediaManagement: {
        trigger: 'manual',
        cron: null,
        nextRunAt: null,
        syncStatus: 'idle',
      },
      metadataProfiles: {
        trigger: 'manual',
        cron: null,
        nextRunAt: null,
        syncStatus: 'idle',
      },
    });
    arrSyncQueries.getQualityProfilesSync = () => ({
      selections: [],
      config: {
        trigger: 'manual',
        cron: null,
      },
    });
    arrSyncQueries.getNextScheduledRunAt = () => null;

    try {
      const lidarrResult = await handler(createSyncJob(101, 'manual'));
      assertEquals(lidarrResult.status, 'skipped');
      assertEquals(lidarrResult.output, 'qualityProfiles: skipped');

      for (const supportedId of [102, 103]) {
        const supportedResult = await handler(createSyncJob(supportedId, 'schedule'));
        assertEquals(supportedResult.status, 'skipped');
        assertEquals(supportedResult.output, 'qualityProfiles: skipped');
      }
    } finally {
      arrInstancesQueries.getById = originalGetById;
      arrSyncQueries.getSyncConfigStatus = originalGetSyncConfigStatus;
      arrSyncQueries.getQualityProfilesSync = originalGetQualityProfilesSync;
      arrSyncQueries.getNextScheduledRunAt = originalGetNextScheduledRunAt;
    }
  },
});

Deno.test({
  name: 'arr.sync: metadataProfiles is skipped with explicit unsupported reason for non-lidarr instances',
  sanitizeResources: false,
  fn: async () => {
    const handler = jobQueueRegistry.get('arr.sync');
    assertExists(handler);

    const instances = new Map<number, ArrInstance>([
      [102, createInstance(102, 'radarr')],
      [103, createInstance(103, 'sonarr')],
    ]);

    const originalGetById = arrInstancesQueries.getById;
    const originalGetSyncConfigStatus = arrSyncQueries.getSyncConfigStatus;
    const originalGetQualityProfilesSync = arrSyncQueries.getQualityProfilesSync;
    const originalGetDelayProfilesSync = arrSyncQueries.getDelayProfilesSync;
    const originalGetMediaManagementSync = arrSyncQueries.getMediaManagementSync;
    const originalGetMetadataProfilesSync = arrSyncQueries.getMetadataProfilesSync;
    const originalGetNextScheduledRunAt = arrSyncQueries.getNextScheduledRunAt;

    arrInstancesQueries.getById = (id: number) => instances.get(id);
    arrSyncQueries.getSyncConfigStatus = () => ({
      qualityProfiles: {
        trigger: 'manual',
        cron: null,
        nextRunAt: null,
        syncStatus: 'idle',
      },
      delayProfiles: {
        trigger: 'manual',
        cron: null,
        nextRunAt: null,
        syncStatus: 'idle',
      },
      mediaManagement: {
        trigger: 'manual',
        cron: null,
        nextRunAt: null,
        syncStatus: 'idle',
      },
      metadataProfiles: {
        trigger: 'manual',
        cron: null,
        nextRunAt: null,
        syncStatus: 'idle',
      },
    });
    arrSyncQueries.getQualityProfilesSync = () => ({
      selections: [],
      config: {
        trigger: 'manual',
        cron: null,
      },
    });
    arrSyncQueries.getDelayProfilesSync = () => ({
      databaseId: null,
      profileName: null,
      trigger: 'manual',
      cron: null,
    });
    arrSyncQueries.getMediaManagementSync = () => ({
      namingDatabaseId: null,
      namingConfigName: null,
      qualityDefinitionsDatabaseId: null,
      qualityDefinitionsConfigName: null,
      mediaSettingsDatabaseId: null,
      mediaSettingsConfigName: null,
      trigger: 'manual',
      cron: null,
    });
    arrSyncQueries.getMetadataProfilesSync = () => ({
      databaseId: null,
      profileName: null,
      trigger: 'manual',
      cron: null,
    });
    arrSyncQueries.getNextScheduledRunAt = () => null;

    try {
      const radarrResult = await handler(createAllSectionsSyncJob(102, 'manual'));
      assertEquals(
        radarrResult.output,
        'qualityProfiles: skipped, delayProfiles: skipped, mediaManagement: skipped, metadataProfiles: skipped (Section metadataProfiles is not supported for radarr)'
      );
      assertEquals(radarrResult.status, 'skipped');

      const sonarrResult = await handler(createAllSectionsSyncJob(103, 'manual'));
      assertEquals(
        sonarrResult.output,
        'qualityProfiles: skipped, delayProfiles: skipped, mediaManagement: skipped, metadataProfiles: skipped (Section metadataProfiles is not supported for sonarr)'
      );
      assertEquals(sonarrResult.status, 'skipped');
    } finally {
      arrInstancesQueries.getById = originalGetById;
      arrSyncQueries.getSyncConfigStatus = originalGetSyncConfigStatus;
      arrSyncQueries.getQualityProfilesSync = originalGetQualityProfilesSync;
      arrSyncQueries.getDelayProfilesSync = originalGetDelayProfilesSync;
      arrSyncQueries.getMediaManagementSync = originalGetMediaManagementSync;
      arrSyncQueries.getMetadataProfilesSync = originalGetMetadataProfilesSync;
      arrSyncQueries.getNextScheduledRunAt = originalGetNextScheduledRunAt;
    }
  },
});

Deno.test({
  name: 'arr.sync disabled instance: returns cancelled for all arr types',
  sanitizeResources: false,
  fn: async () => {
    const handler = jobQueueRegistry.get('arr.sync');
    assertExists(handler);

    const disabledInstance: ArrInstance = {
      ...createInstance(201, 'lidarr'),
      enabled: 0,
    };

    const originalGetById = arrInstancesQueries.getById;
    arrInstancesQueries.getById = () => disabledInstance;

    try {
      const result = await handler(createSyncJob(201, 'manual'));
      assertEquals(result.status, 'cancelled');
      assertEquals(result.output, 'Arr instance disabled');
    } finally {
      arrInstancesQueries.getById = originalGetById;
    }
  },
});
