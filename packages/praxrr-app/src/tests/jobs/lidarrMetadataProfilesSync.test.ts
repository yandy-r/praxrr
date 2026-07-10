import { assert, assertEquals, assertExists, assertRejects } from '@std/assert';
import { LidarrClient } from '$arr/clients/lidarr.ts';
import { RadarrClient } from '$arr/clients/radarr.ts';
import { SonarrClient } from '$arr/clients/sonarr.ts';
import type {
  LidarrMetadataProfile,
  LidarrMetadataProfileCreatePayload,
  LidarrMetadataProfileSchema,
} from '$arr/types.ts';
import { config } from '$config';
import { db } from '$db/db.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { arrNamespaceQueries } from '$db/queries/arrNamespaces.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';
import type { JobQueueRecord, JobSource } from '$jobs/queueTypes.ts';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import { clearAllCaches, setCache } from '$pcd/database/registry.ts';
import type { PCDCache } from '$pcd/index.ts';
import { metadataProfilesHandler } from '$sync/metadataProfiles/handler.ts';
import { MetadataProfileSyncer } from '$sync/metadataProfiles/syncer.ts';
import { getNamespaceSuffix } from '$sync/namespace.ts';
import type { SectionType } from '$lib/server/sync/types.ts';
import type {
  SyncPreviewEvidenceClass,
  SyncPreviewEvidenceRecorder,
  SyncPreviewPreparedExecutionContext,
  SyncPreviewResult,
  SyncPreviewSection,
} from '$sync/preview/types.ts';
import { generatePreview } from '$sync/preview/orchestrator.ts';
import { previewStore } from '$sync/preview/store.ts';
import { resetPreviewCreateRateLimitForTests } from '$sync/preview/limits.ts';
import { _handleSyncPreviewCreateRequest } from '../../routes/api/v1/sync/preview/+server.ts';
import { _handleSyncPreviewApplyRequest } from '../../routes/api/v1/sync/preview/[previewId]/apply/+server.ts';

import '$jobs/handlers/arrSync.ts';
import '$sync/metadataProfiles/handler.ts';

interface MetadataProfileConfigRow {
  should_sync: number;
  sync_status: string;
  last_error: string | null;
  last_synced_at: string | null;
}

const REVIEW_DATABASE_ID = 234;
const REVIEW_PROFILE_NAME = '  Exact Metadata Profile  ';

type ReviewRow = Record<string, unknown>;

class MetadataEvidenceRecorder implements SyncPreviewEvidenceRecorder {
  readonly evidence: Record<SyncPreviewEvidenceClass, Record<string, unknown>> = { pcd: {}, arr: {} };
  prepared: SyncPreviewPreparedExecutionContext | null = null;

  record(section: SyncPreviewSection, source: SyncPreviewEvidenceClass, key: string, value: unknown): void {
    assertEquals(section, 'metadataProfiles');
    this.evidence[source][key] = value;
  }

  prepare(context: SyncPreviewPreparedExecutionContext): void {
    assertEquals(context.section, 'metadataProfiles');
    this.prepared = context;
  }
}

function metadataReviewCache(rowsByTable: Record<string, ReviewRow[]>): PCDCache {
  const kb = {
    selectFrom(table: string) {
      let whereColumn: string | null = null;
      let whereValue: unknown;
      const builder = {
        select(_columns: unknown) {
          return builder;
        },
        where(column: string, _operator: string, value: unknown) {
          whereColumn = column;
          whereValue = value;
          return builder;
        },
        orderBy(_column: string) {
          return builder;
        },
        execute() {
          return Promise.resolve(
            (rowsByTable[table] ?? [])
              .filter((row) => whereColumn === null || row[whereColumn] === whereValue)
              .map((row) => ({ ...row }))
          );
        },
        async executeTakeFirst() {
          return (await builder.execute())[0];
        },
      };
      return builder;
    },
  };

  return { kb, close() {} } as unknown as PCDCache;
}

function metadataRows(): Record<string, ReviewRow[]> {
  return {
    lidarr_metadata_profiles: [
      {
        id: 8,
        name: REVIEW_PROFILE_NAME,
        description: 'reviewed source',
      },
    ],
    lidarr_metadata_profile_primary_types: [
      {
        metadata_profile_name: REVIEW_PROFILE_NAME,
        type_id: 0,
        name: 'Album',
        allowed: 1,
      },
    ],
    lidarr_metadata_profile_secondary_types: [
      {
        metadata_profile_name: REVIEW_PROFILE_NAME,
        type_id: 0,
        name: 'Studio',
        allowed: 1,
      },
    ],
    lidarr_metadata_profile_release_statuses: [
      {
        metadata_profile_name: REVIEW_PROFILE_NAME,
        status_id: 0,
        name: 'Official',
        allowed: 1,
      },
    ],
  };
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
    api_key_fingerprint: null,
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

Deno.test(
  'metadata profile review freezes exact config, namespace, schema-null evidence, target, and payload',
  async () => {
    const rows = metadataRows();
    setCache(REVIEW_DATABASE_ID, metadataReviewCache(rows));
    const originalGetOrCreate = arrNamespaceQueries.getOrCreate;
    const originalGetSyncConfig = arrSyncQueries.getMetadataProfilesSync;
    arrNamespaceQueries.getOrCreate = (instanceId, databaseId) => {
      assertEquals(instanceId, 701);
      assertEquals(databaseId, REVIEW_DATABASE_ID);
      return 2;
    };

    const targetName = `${REVIEW_PROFILE_NAME}${getNamespaceSuffix(2)}`;
    const target: LidarrMetadataProfile = {
      id: 44,
      name: targetName,
      primaryAlbumTypes: [
        {
          albumType: { id: 0, name: 'Album' },
          allowed: false,
        },
      ],
      secondaryAlbumTypes: [
        {
          albumType: { id: 0, name: 'Studio' },
          allowed: false,
        },
      ],
      releaseStatuses: [
        {
          releaseStatus: { id: 0, name: 'Official' },
          allowed: false,
        },
      ],
    };
    const schema: LidarrMetadataProfileSchema | null = null;
    const previewClient = new LidarrClient('http://lidarr.test', 'key', {
      retries: 0,
    });
    previewClient.getMetadataProfileSchemaOrNull = () => Promise.resolve(schema);
    previewClient.getMetadataProfiles = () => Promise.resolve([structuredClone(target)]);
    previewClient.createMetadataProfile = () => Promise.reject(new Error('preview must not write'));
    previewClient.updateMetadataProfile = () => Promise.reject(new Error('preview must not write'));

    const recorder = new MetadataEvidenceRecorder();
    const syncer = new MetadataProfileSyncer(previewClient, 701, 'Reviewed Lidarr');
    syncer.setPreviewConfig({
      databaseId: REVIEW_DATABASE_ID,
      profileName: REVIEW_PROFILE_NAME,
    });
    syncer.setPreviewEvidenceRecorder(recorder);

    try {
      const preview = await syncer.generatePreview();
      assert(preview.section === 'metadataProfiles');
      assertEquals(preview.profile?.name, REVIEW_PROFILE_NAME);
      assertEquals(recorder.evidence.pcd.selectedConfig, {
        databaseId: REVIEW_DATABASE_ID,
        profileName: REVIEW_PROFILE_NAME,
      });
      assertEquals(recorder.evidence.pcd.namespace, {
        instanceId: 701,
        databaseId: REVIEW_DATABASE_ID,
        index: 2,
        suffix: getNamespaceSuffix(2),
      });
      assertEquals(recorder.evidence.arr.metadataSchema, {
        available: false,
        value: null,
      });
      assertEquals(recorder.evidence.arr.liveTargetProfile, target);
      assertEquals(recorder.evidence.arr.targetIdentity, {
        name: targetName,
        remoteId: 44,
        action: 'update',
      });
      assert(recorder.prepared);
      assert(Object.isFrozen(recorder.prepared));
      assert(Object.isFrozen(recorder.prepared.desired));
      assert(Object.isFrozen((recorder.prepared.currentGuards as { targetProfile: object }).targetProfile));

      rows.lidarr_metadata_profile_primary_types[0].allowed = 0;
      target.primaryAlbumTypes[0].allowed = true;
      clearAllCaches();
      arrSyncQueries.getMetadataProfilesSync = () => {
        throw new Error('reviewed write must not reread saved config');
      };

      let write: {
        id: number;
        payload: LidarrMetadataProfileCreatePayload & { id: number };
      } | null = null;
      const writeClient = new LidarrClient('http://lidarr.test', 'key', {
        retries: 0,
      });
      writeClient.getMetadataProfileSchema = () => Promise.reject(new Error('reviewed write rematerialized schema'));
      writeClient.getMetadataProfiles = () => Promise.reject(new Error('reviewed write rematerialized target'));
      writeClient.createMetadataProfile = () => Promise.reject(new Error('reviewed update changed action'));
      writeClient.updateMetadataProfile = (id, payload) => {
        write = { id, payload: structuredClone(payload) };
        return Promise.resolve(payload);
      };

      const writer = new MetadataProfileSyncer(writeClient, 701, 'Reviewed Lidarr');
      writer.setPreviewConfig({
        databaseId: 999,
        profileName: 'mutated config',
      });
      writer.setPreparedExecutionContext(recorder.prepared);
      try {
        const result = await writer.sync();
        assertEquals(result.success, true);
        assertEquals(result.outcomes[0]?.name, REVIEW_PROFILE_NAME);
        assertEquals(result.outcomes[0]?.remoteId, '44');
        assertEquals(write, {
          id: 44,
          payload: {
            ...(recorder.prepared.desired as LidarrMetadataProfileCreatePayload),
            id: 44,
          },
        });
      } finally {
        writeClient.close();
      }
    } finally {
      previewClient.close();
      clearAllCaches();
      arrNamespaceQueries.getOrCreate = originalGetOrCreate;
      arrSyncQueries.getMetadataProfilesSync = originalGetSyncConfig;
    }
  }
);

Deno.test('Lidarr metadata transient override fails closed when only one selection field is provided', async () => {
  const client = new LidarrClient('http://lidarr.test', 'key', { retries: 0 });
  const syncer = new MetadataProfileSyncer(client, 999_003, 'Invalid Lidarr metadata');
  syncer.setPreviewConfig({ databaseId: REVIEW_DATABASE_ID });

  try {
    await assertRejects(
      () => syncer.generatePreview(),
      Error,
      'Invalid reviewed metadata profile configuration',
      'Lidarr must not fall back to saved metadata-profile config'
    );
  } finally {
    client.close();
  }
});

Deno.test('empty transient metadata selection is skipped and cannot reach reviewed apply writes', async () => {
  resetPreviewCreateRateLimitForTests();
  const instance = createInstance(703, 'lidarr');
  const client = new LidarrClient('http://lidarr.test', 'key', { retries: 0 });
  const originalHasConfig = metadataProfilesHandler.hasConfig;
  let arrReads = 0;
  let arrWrites = 0;
  let reviewedExecutions = 0;
  const nowMs = Date.now();

  metadataProfilesHandler.hasConfig = () => false;
  client.getMetadataProfileSchemaOrNull = () => {
    arrReads += 1;
    return Promise.resolve(null);
  };
  client.getMetadataProfiles = () => {
    arrReads += 1;
    return Promise.resolve([]);
  };
  client.createMetadataProfile = () => {
    arrWrites += 1;
    return Promise.reject(new Error('empty metadata selection must not create'));
  };
  client.updateMetadataProfile = () => {
    arrWrites += 1;
    return Promise.reject(new Error('empty metadata selection must not update'));
  };

  const createRequest = new Request('http://localhost/api/v1/sync/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      instanceId: instance.id,
      sections: ['metadataProfiles'],
      sectionConfigs: {
        metadataProfiles: { databaseId: null, profileName: null },
      },
    }),
  });

  let previewId: string | null = null;
  try {
    const createResponse = await _handleSyncPreviewCreateRequest(createRequest, {
      getInstanceById: (instanceId) => (instanceId === instance.id ? instance : undefined),
      getReviewClient: () =>
        Promise.resolve({
          client,
          credentialIdentity: {
            fingerprint: instance.api_key_fingerprint!,
            keyVersion: 'legacy',
            revision: instance.updated_at,
          },
        }),
      now: () => nowMs,
      generatePreview: (input, options) => generatePreview(input, { ...options, client }),
    });

    assertEquals(createResponse.status, 200, await createResponse.clone().text());
    const preview = (await createResponse.json()) as SyncPreviewResult;
    previewId = preview.id;
    assertEquals(preview.arrType, 'lidarr');
    assertEquals(preview.sections, ['metadataProfiles']);
    assertEquals(preview.sectionOutcomes, [
      {
        section: 'metadataProfiles',
        failure: null,
        skipped: true,
      },
    ]);
    assertEquals(preview.metadataProfiles, null);
    assertEquals(preview.failure, null);
    assertEquals(arrReads, 0);
    assertEquals(arrWrites, 0);

    const applyResponse = await _handleSyncPreviewApplyRequest(
      preview.id,
      new Request(`http://localhost/api/v1/sync/preview/${preview.id}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sections: ['metadataProfiles'] }),
      }),
      {
        getSectionsInProgress: () => [],
        executeReviewedSyncJob: async () => {
          reviewedExecutions += 1;
          throw new Error('ineligible metadata selection must not execute');
        },
        now: () => nowMs + 1_000,
      }
    );

    assertEquals(applyResponse.status, 409);
    assertEquals(await applyResponse.json(), {
      error: 'Cannot apply sections with failed preview generation: metadataProfiles',
    });
    assertEquals(reviewedExecutions, 0);
    assertEquals(arrWrites, 0);
  } finally {
    if (previewId) previewStore.delete(previewId);
    resetPreviewCreateRateLimitForTests();
    metadataProfilesHandler.hasConfig = originalHasConfig;
    client.close();
  }
});

Deno.test('metadata profile review rejects Radarr and Sonarr directly without config or sibling fallback', async () => {
  const originalGetSyncConfig = arrSyncQueries.getMetadataProfilesSync;
  let configReads = 0;
  arrSyncQueries.getMetadataProfilesSync = () => {
    configReads += 1;
    return {
      databaseId: null,
      profileName: null,
      trigger: 'manual',
      cron: null,
    };
  };

  try {
    for (const client of [
      new RadarrClient('http://radarr.test', 'key', { retries: 0 }),
      new SonarrClient('http://sonarr.test', 'key', { retries: 0 }),
    ]) {
      try {
        const syncer = new MetadataProfileSyncer(client, 702, 'Unsupported Arr');
        await assertRejects(
          () => syncer.generatePreview(),
          Error,
          'Metadata profile sync is only supported for Lidarr instances'
        );
        await assertRejects(() => syncer.sync(), Error, 'Metadata profile sync is only supported for Lidarr instances');
      } finally {
        client.close();
      }
    }
    assertEquals(configReads, 0);
  } finally {
    arrSyncQueries.getMetadataProfilesSync = originalGetSyncConfig;
  }
});

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
      assertEquals(lidarrResult.output, 'metadataProfiles: skipped');

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
    const tempBasePath = `/tmp/praxrr-tests/lidarr-metadata-profiles-sync-lifecycle-${crypto.randomUUID()}`;

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
    const tempBasePath = `/tmp/praxrr-tests/lidarr-metadata-profiles-sync-reporter-${crypto.randomUUID()}`;

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
          sync: async () => ({ success: true, itemsSynced: 7, outcomes: [] }),
          generatePreview: async () => ({
            section: 'metadataProfiles',
            profile: null,
          }),
          setPreviewConfig: () => undefined,
          clearPreviewConfig: () => undefined,
        });

        arrSyncQueries.setMetadataProfilesStatusPending(501);
        const successResult = await handler(createMetadataSyncJob(501, 'manual'));
        assertEquals(successResult.status, 'success');
        assertEquals(successResult.output, 'metadataProfiles: 7 item(s)');
        assertEquals(getMetadataProfileRow(501).sync_status, 'idle');
        assertEquals(getMetadataProfileRow(501).should_sync, 0);

        metadataProfilesHandler.createSyncer = () => ({
          sync: async () => ({
            success: false,
            itemsSynced: 0,
            error: 'Metadata profile sync failed for reporting test',
            outcomes: [],
          }),
          generatePreview: async () => ({
            section: 'metadataProfiles',
            profile: null,
          }),
          setPreviewConfig: () => undefined,
          clearPreviewConfig: () => undefined,
        });

        arrSyncQueries.setMetadataProfilesStatusPending(501);
        const failResult = await handler(createMetadataSyncJob(501, 'manual'));
        assertEquals(failResult.status, 'failure');
        assertEquals(failResult.output, 'metadataProfiles: failed');

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
