import { assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';
import type { JobQueueRecord, JobSource } from '$jobs/queueTypes.ts';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import { metadataProfilesHandler } from '$sync/metadataProfiles/handler.ts';
import type { SectionType } from '$lib/server/sync/types.ts';

import '$jobs/handlers/arrSync.ts';
import '$sync/metadataProfiles/handler.ts';

interface MetadataProfileConfigRow {
  should_sync: number;
  sync_status: string;
  last_error: string | null;
  last_synced_at: string | null;
}

function bootstrapSchema(): void {
  db.exec(`
    CREATE TABLE arr_instances (
      id INTEGER PRIMARY KEY,
      type TEXT NOT NULL
    );

    CREATE TABLE arr_sync_quality_profiles_config (
      instance_id INTEGER PRIMARY KEY,
      trigger TEXT NOT NULL DEFAULT 'manual',
      cron TEXT,
      next_run_at TEXT,
      should_sync INTEGER NOT NULL DEFAULT 0,
      sync_status TEXT NOT NULL DEFAULT 'idle',
      last_error TEXT,
      last_synced_at TEXT
    );

    CREATE TABLE arr_sync_delay_profiles_config (
      instance_id INTEGER PRIMARY KEY,
      trigger TEXT NOT NULL DEFAULT 'manual',
      cron TEXT,
      next_run_at TEXT,
      database_id INTEGER,
      profile_name TEXT,
      should_sync INTEGER NOT NULL DEFAULT 0,
      sync_status TEXT NOT NULL DEFAULT 'idle',
      last_error TEXT,
      last_synced_at TEXT
    );

    CREATE TABLE arr_sync_media_management (
      instance_id INTEGER PRIMARY KEY,
      trigger TEXT NOT NULL DEFAULT 'manual',
      cron TEXT,
      next_run_at TEXT,
      should_sync INTEGER NOT NULL DEFAULT 0,
      sync_status TEXT NOT NULL DEFAULT 'idle',
      last_error TEXT,
      last_synced_at TEXT,
      naming_database_id INTEGER,
      naming_config_name TEXT,
      quality_definitions_database_id INTEGER,
      quality_definitions_config_name TEXT,
      media_settings_database_id INTEGER,
      media_settings_config_name TEXT
    );

    CREATE TABLE arr_sync_metadata_profiles_config (
      instance_id INTEGER PRIMARY KEY,
      trigger TEXT NOT NULL DEFAULT 'manual',
      cron TEXT,
      should_sync INTEGER NOT NULL DEFAULT 0,
      next_run_at TEXT,
      database_id INTEGER,
      profile_name TEXT,
      sync_status TEXT NOT NULL DEFAULT 'idle',
      last_error TEXT,
      last_synced_at TEXT
    );
  `);
}

function createInstance(id: number, type: ArrInstance['type']): ArrInstance {
  return {
    id,
    name: `${type}-${id}`,
    type,
    external_url: null,
    url: 'http://127.0.0.1:8989',
    api_key: `${type}-key`,
    tags: null,
    enabled: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function insertInstance(id: number, type: ArrInstance['type']): void {
  db.execute('INSERT INTO arr_instances (id, type) VALUES (?, ?)', id, type);
}

function createMetadataSyncJob(instanceId: number, source: JobSource): JobQueueRecord {
  const now = new Date().toISOString();
  return {
    id: instanceId,
    jobType: 'arr.sync',
    status: 'queued',
    runAt: now,
    payload: {
      instanceId,
      section: 'metadataProfiles' as SectionType,
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

function getMetadataProfileRow(instanceId: number): MetadataProfileConfigRow {
  const row = db.queryFirst<MetadataProfileConfigRow>(
    'SELECT should_sync, sync_status, last_error, last_synced_at FROM arr_sync_metadata_profiles_config WHERE instance_id = ?',
    instanceId
  );
  assertExists(row);
  return row;
}

function baselineSyncConfigStatus(syncStatus = 'idle') {
  return {
    qualityProfiles: {
      trigger: 'manual' as const,
      cron: null,
      nextRunAt: null,
      syncStatus,
    },
    delayProfiles: {
      trigger: 'manual' as const,
      cron: null,
      nextRunAt: null,
      syncStatus,
    },
    mediaManagement: {
      trigger: 'manual' as const,
      cron: null,
      nextRunAt: null,
      syncStatus,
    },
    metadataProfiles: {
      trigger: 'manual' as const,
      cron: null,
      nextRunAt: null,
      syncStatus,
    },
  };
}

Deno.test({
  name: 'arr.sync metadataProfiles: is supported for lidarr and rejected for non-lidarr',
  sanitizeResources: false,
  fn: async () => {
    const handler = jobQueueRegistry.get('arr.sync');
    assertExists(handler);

    const instances = new Map<number, ArrInstance>([
      [301, createInstance(301, 'lidarr')],
      [302, createInstance(302, 'radarr')],
      [303, createInstance(303, 'sonarr')],
    ]);

    const originalGetById = arrInstancesQueries.getById;
    const originalGetSyncConfigStatus = arrSyncQueries.getSyncConfigStatus;
    const originalGetMetadataProfilesSync = arrSyncQueries.getMetadataProfilesSync;
    const originalGetQualityProfilesSync = arrSyncQueries.getQualityProfilesSync;
    const originalGetDelayProfilesSync = arrSyncQueries.getDelayProfilesSync;
    const originalGetMediaManagementSync = arrSyncQueries.getMediaManagementSync;

    arrInstancesQueries.getById = (id: number) => instances.get(id);
    arrSyncQueries.getSyncConfigStatus = () => baselineSyncConfigStatus();
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

    try {
      const lidarrResult = await handler(createMetadataSyncJob(301, 'manual'));
      assertEquals(lidarrResult.status, 'skipped');
      assertEquals(
        lidarrResult.output,
        'metadataProfiles: skipped'
      );

      const radarrResult = await handler(createMetadataSyncJob(302, 'manual'));
      assertEquals(radarrResult.status, 'skipped');
      assertEquals(
        radarrResult.output,
        'metadataProfiles: skipped (Section metadataProfiles is not supported for radarr)'
      );

      const sonarrResult = await handler(createMetadataSyncJob(303, 'manual'));
      assertEquals(sonarrResult.status, 'skipped');
      assertEquals(
        sonarrResult.output,
        'metadataProfiles: skipped (Section metadataProfiles is not supported for sonarr)'
      );
    } finally {
      arrInstancesQueries.getById = originalGetById;
      arrSyncQueries.getSyncConfigStatus = originalGetSyncConfigStatus;
      arrSyncQueries.getMetadataProfilesSync = originalGetMetadataProfilesSync;
      arrSyncQueries.getQualityProfilesSync = originalGetQualityProfilesSync;
      arrSyncQueries.getDelayProfilesSync = originalGetDelayProfilesSync;
      arrSyncQueries.getMediaManagementSync = originalGetMediaManagementSync;
    }
  },
});

Deno.test({
  name: 'arrSyncQueries metadataProfiles section lifecycle transitions move through pending/claimed/complete/fail',
  sanitizeResources: false,
  fn: async () => {
    const originalBasePath = config.paths.base;
    const tempBasePath = `/tmp/profilarr-tests/lidarr-metadata-profiles-sync-lifecycle-${crypto.randomUUID()}`;

    await Deno.mkdir(tempBasePath, { recursive: true });

    db.close();
    config.setBasePath(tempBasePath);

    try {
      await db.initialize();
      bootstrapSchema();

      insertInstance(401, 'lidarr');
      arrSyncQueries.saveMetadataProfilesSync(401, {
        databaseId: 101,
        profileName: 'Lifecycle-Profile',
        trigger: 'manual',
        cron: null,
      });

      let row = getMetadataProfileRow(401);
      assertEquals(row.sync_status, 'idle');
      assertEquals(row.should_sync, 0);

      arrSyncQueries.setMetadataProfilesStatusPending(401);
      row = getMetadataProfileRow(401);
      assertEquals(row.sync_status, 'pending');
      assertEquals(row.should_sync, 1);
      assertEquals(arrSyncQueries.getPendingSyncsByStatus().metadataProfiles, [401]);

      assertEquals(arrSyncQueries.claimMetadataProfilesSync(401), true);
      assertEquals(arrSyncQueries.claimMetadataProfilesSync(401), false);

      arrSyncQueries.completeMetadataProfilesSync(401);
      row = getMetadataProfileRow(401);
      assertEquals(row.sync_status, 'idle');
      assertEquals(row.should_sync, 0);
      assertEquals(row.last_error, null);
      assertEquals(typeof row.last_synced_at, 'string');

      arrSyncQueries.setMetadataProfilesStatusPending(401);
      arrSyncQueries.failMetadataProfilesSync(401, 'metadata profile sync failed');
      row = getMetadataProfileRow(401);
      assertEquals(row.sync_status, 'failed');
      assertEquals(row.should_sync, 0);
      assertEquals(row.last_error, 'metadata profile sync failed');
    } finally {
      db.close();
      config.setBasePath(originalBasePath);
      await Deno.remove(tempBasePath, { recursive: true }).catch(() => undefined);
    }
  },
});

Deno.test({
  name: 'arr.sync metadataProfiles: reports sync success and failure and persists status',
  sanitizeResources: false,
  fn: async () => {
    const handler = jobQueueRegistry.get('arr.sync');
    assertExists(handler);

    const originalBasePath = config.paths.base;
    const tempBasePath = `/tmp/profilarr-tests/lidarr-metadata-profiles-sync-reporter-${crypto.randomUUID()}`;

    await Deno.mkdir(tempBasePath, { recursive: true });

    db.close();
    config.setBasePath(tempBasePath);

    try {
      await db.initialize();
      bootstrapSchema();

      const lidarr = createInstance(501, 'lidarr');
      insertInstance(501, 'lidarr');
      arrSyncQueries.saveMetadataProfilesSync(501, {
        databaseId: 202,
        profileName: 'Reporter-Profile',
        trigger: 'manual',
        cron: null,
      });

      const originalGetById = arrInstancesQueries.getById;
      const originalGetSyncConfigStatus = arrSyncQueries.getSyncConfigStatus;
      const originalGetQualityProfilesSync = arrSyncQueries.getQualityProfilesSync;
      const originalGetDelayProfilesSync = arrSyncQueries.getDelayProfilesSync;
      const originalGetMediaManagementSync = arrSyncQueries.getMediaManagementSync;
      const originalSetStatusPending = metadataProfilesHandler.setStatusPending;
      const originalClaimSync = metadataProfilesHandler.claimSync;
      const originalCreateSyncer = metadataProfilesHandler.createSyncer;

      arrInstancesQueries.getById = () => lidarr;
      arrSyncQueries.getSyncConfigStatus = () => baselineSyncConfigStatus();
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

      metadataProfilesHandler.setStatusPending = (instanceId: number): void => {
        arrSyncQueries.setMetadataProfilesStatusPending(instanceId);
      };
      metadataProfilesHandler.claimSync = (instanceId: number): boolean => {
        return arrSyncQueries.claimMetadataProfilesSync(instanceId);
      };

      try {
        metadataProfilesHandler.createSyncer = () => ({
          sync: async () => ({ success: true, itemsSynced: 7 }),
        });

        arrSyncQueries.setMetadataProfilesStatusPending(501);
        const successResult = await handler(createMetadataSyncJob(501, 'manual'));
        assertEquals(successResult.status, 'success');
        assertEquals(
          successResult.output,
          'metadataProfiles: 7 item(s)'
        );
        assertEquals(getMetadataProfileRow(501).sync_status, 'idle');
        assertEquals(getMetadataProfileRow(501).should_sync, 0);

        metadataProfilesHandler.createSyncer = () => ({
          sync: async () => ({
            success: false,
            itemsSynced: 0,
            error: 'Metadata profile sync failed for reporting test',
          }),
        });

        arrSyncQueries.setMetadataProfilesStatusPending(501);
        const failResult = await handler(createMetadataSyncJob(501, 'manual'));
        assertEquals(failResult.status, 'failure');
        assertEquals(
          failResult.output,
          'metadataProfiles: failed'
        );

        const failedRow = getMetadataProfileRow(501);
        assertEquals(failedRow.sync_status, 'failed');
        assertEquals(failedRow.should_sync, 0);
        assertEquals(failedRow.last_error, 'Metadata profile sync failed for reporting test');
      } finally {
        metadataProfilesHandler.setStatusPending = originalSetStatusPending;
        metadataProfilesHandler.claimSync = originalClaimSync;
        metadataProfilesHandler.createSyncer = originalCreateSyncer;
      }

      arrInstancesQueries.getById = originalGetById;
      arrSyncQueries.getSyncConfigStatus = originalGetSyncConfigStatus;
      arrSyncQueries.getQualityProfilesSync = originalGetQualityProfilesSync;
      arrSyncQueries.getDelayProfilesSync = originalGetDelayProfilesSync;
      arrSyncQueries.getMediaManagementSync = originalGetMediaManagementSync;
    } finally {
      db.close();
      config.setBasePath(originalBasePath);
      await Deno.remove(tempBasePath, { recursive: true }).catch(() => undefined);
    }
  },
});
