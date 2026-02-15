import { assertEquals, assertExists } from '@std/assert';
import { isRedirect } from '@sveltejs/kit';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import type { PCDCache } from '$pcd/index.ts';
import { PCDCache as RuntimePCDCache } from '$pcd/database/cache.ts';
import { deleteCache, getCache, setCache } from '$pcd/database/registry.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { type PcdOp, pcdOpsQueries } from '$db/queries/pcdOps.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import { arrSyncQueries, type MediaManagementSyncData } from '$db/queries/arrSync.ts';
import { logger } from '$logger/logger.ts';
import type { LogOptions } from '$logger/types.ts';
import { BaseArrClient } from '$arr/base.ts';
import type { ArrMediaManagementConfig, ArrQualityDefinition } from '$arr/types.ts';
import { MediaManagementSyncer } from '$sync/mediaManagement/syncer.ts';
import { actions as mediaSettingsNewActions } from '../../routes/media-management/[databaseId]/media-settings/new/+page.server.ts';
import { actions as namingNewActions } from '../../routes/media-management/[databaseId]/naming/new/+page.server.ts';
import { load as namingLidarrLoad } from '../../routes/media-management/[databaseId]/naming/lidarr/[name]/+page.server.ts';
import { POST as importPortablePost } from '../../routes/api/v1/pcd/import/+server.ts';
import { GET as exportPortableGet } from '../../routes/api/v1/pcd/export/+server.ts';

const ROUTE_DATABASE_ID = 2244;
const IMPORT_EXPORT_DATABASE_ID = 2245;
const SYNC_DATABASE_ID = 2246;

interface CacheFixture {
  cache: PCDCache;
  destroy: () => Promise<void>;
}

interface WriteHarness {
  cache: RuntimePCDCache;
  cleanup: () => Promise<void>;
}

interface CapturedLog {
  message: string;
  options?: LogOptions;
}

function getMeta(log: CapturedLog): Record<string, unknown> {
  if (!log.options?.meta || typeof log.options.meta !== 'object' || log.options.meta === null) {
    return {};
  }

  return log.options.meta as Record<string, unknown>;
}

async function withMutedLogger<T>(fn: () => Promise<T>): Promise<T> {
  const originalDebug = logger.debug;
  const originalWarn = logger.warn;
  const originalInfo = logger.info;
  const originalError = logger.error;

  logger.debug = (_message: string, _options?: LogOptions) => Promise.resolve();
  logger.warn = (_message: string, _options?: LogOptions) => Promise.resolve();
  logger.info = (_message: string, _options?: LogOptions) => Promise.resolve();
  logger.error = (_message: string, _options?: LogOptions) => Promise.resolve();

  try {
    return await fn();
  } finally {
    logger.debug = originalDebug;
    logger.warn = originalWarn;
    logger.info = originalInfo;
    logger.error = originalError;
  }
}

function createCacheFixture(schemaAndDataSql: string): CacheFixture {
  const db = new Database(':memory:', { int64: true });
  const kb = new Kysely<PCDDatabase>({
    dialect: new DenoSqlite3Dialect({
      database: db,
    }),
  });

  db.exec(schemaAndDataSql);

  return {
    cache: { kb } as unknown as PCDCache,
    destroy: async () => {
      await kb.destroy();
      db.close();
    },
  };
}

function baseMediaManagementSchema(extraInserts = ''): string {
  return `
CREATE TABLE IF NOT EXISTS sonarr_naming (
  name TEXT NOT NULL PRIMARY KEY,
  rename INTEGER NOT NULL DEFAULT 0,
  standard_episode_format TEXT NOT NULL DEFAULT '',
  daily_episode_format TEXT NOT NULL DEFAULT '',
  anime_episode_format TEXT NOT NULL DEFAULT '',
  series_folder_format TEXT NOT NULL DEFAULT '',
  season_folder_format TEXT NOT NULL DEFAULT '',
  replace_illegal_characters INTEGER NOT NULL DEFAULT 0,
  colon_replacement_format INTEGER NOT NULL DEFAULT 4,
  custom_colon_replacement_format TEXT,
  multi_episode_style INTEGER NOT NULL DEFAULT 5,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lidarr_naming (
  name TEXT NOT NULL PRIMARY KEY,
  rename INTEGER NOT NULL DEFAULT 0,
  standard_track_format TEXT NOT NULL DEFAULT '',
  artist_name TEXT NOT NULL DEFAULT '',
  multi_disc_track_format TEXT NOT NULL DEFAULT '',
  artist_folder_format TEXT NOT NULL DEFAULT '',
  replace_illegal_characters INTEGER NOT NULL DEFAULT 0,
  colon_replacement_format INTEGER NOT NULL DEFAULT 4,
  custom_colon_replacement_format TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS radarr_media_settings (
  name TEXT NOT NULL PRIMARY KEY,
  propers_repacks TEXT NOT NULL,
  enable_media_info INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sonarr_media_settings (
  name TEXT NOT NULL PRIMARY KEY,
  propers_repacks TEXT NOT NULL,
  enable_media_info INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lidarr_media_settings (
  name TEXT NOT NULL PRIMARY KEY,
  propers_repacks TEXT NOT NULL,
  enable_media_info INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quality_api_mappings (
  quality_name TEXT NOT NULL,
  arr_type TEXT NOT NULL,
  api_name TEXT NOT NULL,
  PRIMARY KEY (quality_name, arr_type)
);

CREATE TABLE IF NOT EXISTS radarr_quality_definitions (
  name TEXT NOT NULL,
  quality_name TEXT NOT NULL,
  min_size INTEGER NOT NULL,
  max_size INTEGER NOT NULL,
  preferred_size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (name, quality_name)
);

CREATE TABLE IF NOT EXISTS sonarr_quality_definitions (
  name TEXT NOT NULL,
  quality_name TEXT NOT NULL,
  min_size INTEGER NOT NULL,
  max_size INTEGER NOT NULL,
  preferred_size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (name, quality_name)
);

CREATE TABLE IF NOT EXISTS lidarr_quality_definitions (
  name TEXT NOT NULL,
  quality_name TEXT NOT NULL,
  min_size INTEGER NOT NULL,
  max_size INTEGER NOT NULL,
  preferred_size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (name, quality_name)
);

${extraInserts}
`;
}

async function createWriteHarness(databaseId: number, schemaSql: string): Promise<WriteHarness> {
  const tempPath = `/tmp/profilarr-tests/lidarr-route-sync-cutover-${databaseId}-${crypto.randomUUID()}`;
  await Deno.mkdir(`${tempPath}/deps/schema/ops`, { recursive: true });
  await Deno.writeTextFile(`${tempPath}/deps/schema/ops/0.schema.sql`, schemaSql);

  const operations: PcdOp[] = [];
  const restores: Array<() => void> = [];
  let nextOpId = 1;

  function patch<T extends object, K extends keyof T>(target: T, key: K, replacement: T[K]): void {
    const original = target[key];
    target[key] = replacement;
    restores.push(() => {
      target[key] = original;
    });
  }

  const now = new Date().toISOString();
  patch(databaseInstancesQueries, 'getById', (id: number) => {
    if (id !== databaseId) {
      return undefined;
    }

    return {
      id,
      uuid: `lidarr-route-sync-cutover-${databaseId}`,
      name: `lidarr-route-sync-cutover-${databaseId}`,
      repository_url: 'file:///tmp/lidarr-route-sync-cutover',
      local_path: tempPath,
      sync_strategy: 0,
      auto_pull: 1,
      enabled: 1,
      personal_access_token: 'token',
      is_private: 0,
      local_ops_enabled: 0,
      git_user_name: null,
      git_user_email: null,
      conflict_strategy: 'override',
      last_synced_at: null,
      created_at: now,
      updated_at: now,
    };
  });

  patch(pcdOpsQueries, 'create', (input) => {
    const opNow = new Date().toISOString();
    const record: PcdOp = {
      id: nextOpId++,
      database_id: input.databaseId,
      origin: input.origin,
      state: input.state,
      source: input.source,
      filename: input.filename ?? null,
      op_number: input.opNumber ?? null,
      sequence: input.sequence ?? null,
      sql: input.sql,
      metadata: input.metadata ?? null,
      desired_state: input.desiredState ?? null,
      content_hash: input.contentHash ?? null,
      last_seen_in_repo_at: input.lastSeenInRepoAt ?? null,
      superseded_by_op_id: input.supersededByOpId ?? null,
      pushed_at: input.pushedAt ?? null,
      pushed_commit: input.pushedCommit ?? null,
      created_at: opNow,
      updated_at: opNow,
    };
    operations.push(record);
    return record.id;
  });

  patch(pcdOpsQueries, 'listByDatabase', (id: number) =>
    operations.filter((operation) => operation.database_id === id).sort((a, b) => a.id - b.id)
  );

  patch(pcdOpsQueries, 'listByDatabaseAndOrigin', (id, origin, options) => {
    const queryOptions = options ?? {};
    let rows = operations.filter((operation) => operation.database_id === id && operation.origin === origin);

    if (queryOptions.states && queryOptions.states.length > 0) {
      rows = rows.filter((row) => queryOptions.states?.includes(row.state));
    }

    if (queryOptions.source) {
      rows = rows.filter((row) => row.source === queryOptions.source);
    }

    return rows.sort((a, b) => a.id - b.id);
  });

  patch(pcdOpsQueries, 'update', (id, update) => {
    const row = operations.find((operation) => operation.id === id);
    if (!row) {
      return false;
    }

    if (update.state !== undefined) {
      row.state = update.state;
    }
    if (update.metadata !== undefined) {
      row.metadata = update.metadata;
    }
    if (update.desiredState !== undefined) {
      row.desired_state = update.desiredState;
    }
    return true;
  });

  let nextHistoryId = 1;
  patch(pcdOpHistoryQueries, 'create', () => nextHistoryId++);
  patch(pcdOpHistoryQueries, 'listLatestConflictsByDatabase', () => []);
  patch(pcdOpHistoryQueries, 'listLatestByDatabaseWithOps', () => []);
  patch(pcdOpHistoryQueries, 'listByDatabase', () => []);
  patch(pcdOpHistoryQueries, 'listByOp', () => []);

  const cache = new RuntimePCDCache(tempPath, databaseId);
  await cache.build();
  setCache(databaseId, cache);

  return {
    cache,
    cleanup: async () => {
      for (const restore of restores.reverse()) {
        restore();
      }

      const cached = getCache(databaseId);
      if (cached) {
        cached.close();
      }
      deleteCache(databaseId);

      await Deno.remove(tempPath, { recursive: true });
    },
  };
}

function cloneQualityDefinitions(definitions: ArrQualityDefinition[]): ArrQualityDefinition[] {
  return definitions.map((definition) => ({
    ...definition,
    quality: { ...definition.quality },
  }));
}

class MockLidarrSyncClient extends BaseArrClient {
  readonly mediaUpdates: ArrMediaManagementConfig[] = [];
  readonly qualityUpdates: ArrQualityDefinition[][] = [];

  constructor() {
    super('http://127.0.0.1:8686', 'test-key');
  }

  override getMediaManagementConfig(): Promise<ArrMediaManagementConfig> {
    return Promise.resolve({
      id: 11,
      enableMediaInfo: false,
      downloadPropersAndRepacks: 'doNotPrefer',
      createEmptySeriesFolders: true,
      deleteEmptyFolders: false,
      fileDate: 'none',
      rescanAfterRefresh: 'always',
      autoUnmonitorPreviouslyDownloadedEpisodes: false,
      recycleBin: '',
      recycleBinCleanupDays: 7,
      setPermissionsLinux: false,
      chmodFolder: '755',
      chownGroup: '',
      skipFreeSpaceCheckWhenImporting: false,
      minimumFreeSpaceWhenImporting: 100,
      copyUsingHardlinks: true,
      importExtraFiles: false,
      extraFileExtensions: '',
      enableScriptImport: false,
      scriptImportPath: '',
      episodeTitleRequired: 'always',
      skipEpisodesWithFiles: true,
      minimumDiskSpace: 0,
      copyUsingHardlinksForSingleFiles: true,
    } as ArrMediaManagementConfig);
  }

  override updateMediaManagementConfig(config: ArrMediaManagementConfig): Promise<ArrMediaManagementConfig> {
    this.mediaUpdates.push({ ...config });
    return Promise.resolve(config);
  }

  override getQualityDefinitions(): Promise<ArrQualityDefinition[]> {
    return Promise.resolve(
      cloneQualityDefinitions([
        {
          id: 1,
          quality: { id: 1, name: 'FLAC', source: 'audio', resolution: 0 },
          title: 'FLAC',
          weight: 1,
          minSize: 0,
          maxSize: null,
          preferredSize: null,
        },
      ])
    );
  }

  override updateQualityDefinitions(definitions: ArrQualityDefinition[]): Promise<ArrQualityDefinition[]> {
    const cloned = cloneQualityDefinitions(definitions);
    this.qualityUpdates.push(cloned);
    return Promise.resolve(cloned);
  }
}

Deno.test('lidarr media-settings new route writes to dedicated lidarr entity', async () => {
  const harness = await createWriteHarness(ROUTE_DATABASE_ID, baseMediaManagementSchema());

  try {
    await withMutedLogger(async () => {
      const formData = new FormData();
      formData.set('arrType', 'lidarr');
      formData.set('name', 'Lidarr-Route-Cutover');
      formData.set('layer', 'user');
      formData.set('propersRepacks', 'preferAndUpgrade');
      formData.set('enableMediaInfo', 'true');

      const request = new Request(`http://localhost/media-management/${ROUTE_DATABASE_ID}/media-settings/new`, {
        method: 'POST',
        body: formData,
      });

      try {
        await mediaSettingsNewActions.default({
          request,
          params: { databaseId: String(ROUTE_DATABASE_ID) },
        } as unknown as Parameters<typeof mediaSettingsNewActions.default>[0]);
        throw new Error('Expected redirect response');
      } catch (error) {
        if (!isRedirect(error)) {
          throw error;
        }

        assertEquals(error.status, 303);
        assertEquals(error.location, `/media-management/${ROUTE_DATABASE_ID}/media-settings`);
      }
    });

    const cache = getCache(ROUTE_DATABASE_ID);
    assertExists(cache);

    const lidarrRow = await cache.kb
      .selectFrom('lidarr_media_settings' as keyof PCDDatabase)
      .select(['name', 'propers_repacks', 'enable_media_info'])
      .where('name', '=', 'Lidarr-Route-Cutover')
      .executeTakeFirst();
    assertExists(lidarrRow);
    assertEquals(lidarrRow.propers_repacks, 'preferAndUpgrade');
    assertEquals(lidarrRow.enable_media_info, 1);

    const sonarrRow = await cache.kb
      .selectFrom('sonarr_media_settings')
      .select(['name'])
      .where('name', '=', 'Lidarr-Route-Cutover')
      .executeTakeFirst();
    assertEquals(sonarrRow, undefined);
  } finally {
    await harness.cleanup();
  }
});

Deno.test('lidarr naming routes load native lidarr_naming rows without Sonarr alias fallback', async () => {
  const harness = await createWriteHarness(
    ROUTE_DATABASE_ID,
    baseMediaManagementSchema(`
INSERT INTO lidarr_naming (
  name,
  rename,
  standard_track_format,
  artist_name,
  multi_disc_track_format,
  artist_folder_format,
  replace_illegal_characters,
  colon_replacement_format,
  custom_colon_replacement_format
) VALUES (
  'Lidarr',
  1,
  '{Artist Name} - {Album Title} - {Track Title}',
  '{Artist Name}',
  '{Artist Name} - CD{medium:00} - {Track Title}',
  '{Artist Name}',
  1,
  4,
  NULL
);
`)
  );

  try {
    const loaded = (await namingLidarrLoad({
      params: {
        databaseId: String(ROUTE_DATABASE_ID),
        name: encodeURIComponent('Lidarr'),
      },
      parent: async () => ({ canWriteToBase: false }),
    } as unknown as Parameters<typeof namingLidarrLoad>[0])) as {
      namingConfig: {
        name: string;
        standard_track_format: string;
        artist_name: string;
      };
    };

    assertEquals(loaded.namingConfig.name, 'Lidarr');
    assertEquals(loaded.namingConfig.standard_track_format, '{Artist Name} - {Album Title} - {Track Title}');
    assertEquals(loaded.namingConfig.artist_name, '{Artist Name}');

    await withMutedLogger(async () => {
      const formData = new FormData();
      formData.set('arrType', 'lidarr');
      formData.set('name', 'Lidarr-Native-Naming');
      formData.set('layer', 'user');
      formData.set('rename', 'true');
      formData.set('standardTrackFormat', '{Artist Name} - {Album Title} - {Track Title}');
      formData.set('artistName', '{Artist Name}');
      formData.set('multiDiscTrackFormat', '{Artist Name} - CD{medium:00} - {Track Title}');
      formData.set('artistFolderFormat', '{Artist Name}');
      formData.set('replaceIllegalCharacters', 'true');
      formData.set('colonReplacementFormat', 'delete');

      const request = new Request(`http://localhost/media-management/${ROUTE_DATABASE_ID}/naming/new`, {
        method: 'POST',
        body: formData,
      });

      try {
        await namingNewActions.default({
          request,
          params: { databaseId: String(ROUTE_DATABASE_ID) },
        } as unknown as Parameters<typeof namingNewActions.default>[0]);
        throw new Error('Expected redirect response');
      } catch (error) {
        if (!isRedirect(error)) {
          throw error;
        }

        assertEquals(error.status, 303);
        assertEquals(error.location, `/media-management/${ROUTE_DATABASE_ID}/naming`);
      }
    });

    const cache = getCache(ROUTE_DATABASE_ID);
    assertExists(cache);

    const lidarrRow = await cache.kb
      .selectFrom('lidarr_naming' as keyof PCDDatabase)
      .select(['name', 'standard_track_format', 'artist_name'])
      .where('name', '=', 'Lidarr-Native-Naming')
      .executeTakeFirst();
    assertExists(lidarrRow);
    assertEquals(lidarrRow.standard_track_format, '{Artist Name} - {Album Title} - {Track Title}');
    assertEquals(lidarrRow.artist_name, '{Artist Name}');

    const sonarrRow = await cache.kb
      .selectFrom('sonarr_naming')
      .select(['name'])
      .where('name', '=', 'Lidarr-Native-Naming')
      .executeTakeFirst();
    assertEquals(sonarrRow, undefined);
  } finally {
    await harness.cleanup();
  }
});

Deno.test('lidarr naming create accepts request without artistName and defaults artist_name', async () => {
  const harness = await createWriteHarness(ROUTE_DATABASE_ID, baseMediaManagementSchema());

  try {
    await withMutedLogger(async () => {
      const formData = new FormData();
      formData.set('arrType', 'lidarr');
      formData.set('name', 'Lidarr-No-ArtistName-Field');
      formData.set('layer', 'user');
      formData.set('rename', 'true');
      formData.set('standardTrackFormat', '{Artist Name} - {Album Title}');
      formData.set('multiDiscTrackFormat', '{Artist Name} - CD{medium:00}');
      formData.set('artistFolderFormat', '{Artist Name}');
      formData.set('replaceIllegalCharacters', 'true');
      formData.set('colonReplacementFormat', 'delete');
      // omit artistName to assert server-side default

      const request = new Request(`http://localhost/media-management/${ROUTE_DATABASE_ID}/naming/new`, {
        method: 'POST',
        body: formData,
      });

      try {
        await namingNewActions.default({
          request,
          params: { databaseId: String(ROUTE_DATABASE_ID) },
        } as unknown as Parameters<typeof namingNewActions.default>[0]);
        throw new Error('Expected redirect response');
      } catch (error) {
        if (!isRedirect(error)) {
          throw error;
        }
        assertEquals(error.status, 303);
      }
    });

    const cache = getCache(ROUTE_DATABASE_ID);
    assertExists(cache);
    const row = await cache.kb
      .selectFrom('lidarr_naming' as keyof PCDDatabase)
      .select(['name', 'artist_name'])
      .where('name', '=', 'Lidarr-No-ArtistName-Field')
      .executeTakeFirst();
    assertExists(row);
    assertEquals(row.artist_name, '{Artist Name}');
  } finally {
    await harness.cleanup();
  }
});

Deno.test('portable import/export for lidarr_quality_definitions resolves dedicated lidarr entity', async () => {
  const harness = await createWriteHarness(
    IMPORT_EXPORT_DATABASE_ID,
    baseMediaManagementSchema(`
INSERT INTO quality_api_mappings (quality_name, arr_type, api_name)
VALUES
  ('FLAC', 'lidarr', 'FLAC'),
  ('FLAC', 'sonarr', 'FLAC');
`)
  );

  try {
    await withMutedLogger(async () => {
      const importRequest = new Request('http://localhost/api/v1/pcd/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          databaseId: IMPORT_EXPORT_DATABASE_ID,
          layer: 'user',
          entityType: 'lidarr_quality_definitions',
          data: {
            name: 'Lidarr-QD-Cutover',
            entries: [
              {
                quality_name: 'FLAC',
                min_size: 128,
                max_size: 0,
                preferred_size: 320,
              },
            ],
          },
        }),
      });

      const importResponse = await importPortablePost({
        request: importRequest,
      } as unknown as Parameters<typeof importPortablePost>[0]);

      assertEquals(importResponse.status, 200);
      assertEquals((await importResponse.json())?.success, true);

      const exportUrl = new URL('http://localhost/api/v1/pcd/export');
      exportUrl.searchParams.set('databaseId', String(IMPORT_EXPORT_DATABASE_ID));
      exportUrl.searchParams.set('entityType', 'lidarr_quality_definitions');
      exportUrl.searchParams.set('name', 'Lidarr-QD-Cutover');

      const exportResponse = await exportPortableGet({
        url: exportUrl,
      } as unknown as Parameters<typeof exportPortableGet>[0]);

      assertEquals(exportResponse.status, 200);

      const exportedPayload = (await exportResponse.json()) as {
        entityType: string;
        data: {
          name: string;
          entries: Array<{ quality_name: string; min_size: number }>;
        };
      };

      assertEquals(exportedPayload.entityType, 'lidarr_quality_definitions');
      assertEquals(exportedPayload.data.name, 'Lidarr-QD-Cutover');
      assertEquals(exportedPayload.data.entries.length, 1);
      assertEquals(exportedPayload.data.entries[0].quality_name, 'FLAC');
      assertEquals(exportedPayload.data.entries[0].min_size, 128);
    });

    const cache = getCache(IMPORT_EXPORT_DATABASE_ID);
    assertExists(cache);

    const lidarrRows = await cache.kb
      .selectFrom('lidarr_quality_definitions' as keyof PCDDatabase)
      .select(['name', 'quality_name', 'min_size', 'max_size', 'preferred_size'])
      .where('name', '=', 'Lidarr-QD-Cutover')
      .execute();
    assertEquals(lidarrRows.length, 1);
    assertEquals(lidarrRows[0].quality_name, 'FLAC');

    const sonarrRows = await cache.kb
      .selectFrom('sonarr_quality_definitions')
      .select(['name'])
      .where('name', '=', 'Lidarr-QD-Cutover')
      .execute();
    assertEquals(sonarrRows.length, 0);
  } finally {
    await harness.cleanup();
  }
});

Deno.test({
  name: 'syncer resolves lidarr media settings and quality definitions from dedicated lidarr entities only',
  sanitizeResources: false,
  fn: async () => {
    const debugLogs: CapturedLog[] = [];
    const originalDebug = logger.debug;
    const originalWarn = logger.warn;
    const originalInfo = logger.info;
    const originalError = logger.error;
    const originalGetMediaManagementSync = arrSyncQueries.getMediaManagementSync;

    logger.debug = (message: string, options?: LogOptions) => {
      debugLogs.push({ message, options });
      return Promise.resolve();
    };
    logger.warn = (_message: string, _options?: LogOptions) => Promise.resolve();
    logger.info = (_message: string, _options?: LogOptions) => Promise.resolve();
    logger.error = (_message: string, _options?: LogOptions) => Promise.resolve();

    arrSyncQueries.getMediaManagementSync = (_instanceId: number): MediaManagementSyncData => ({
      namingDatabaseId: null,
      namingConfigName: null,
      qualityDefinitionsDatabaseId: SYNC_DATABASE_ID,
      qualityDefinitionsConfigName: 'Fallback-Only',
      mediaSettingsDatabaseId: SYNC_DATABASE_ID,
      mediaSettingsConfigName: 'Fallback-Only',
      trigger: 'manual',
      cron: null,
    });

    const fixture = createCacheFixture(`
CREATE TABLE sonarr_media_settings (
  name TEXT NOT NULL PRIMARY KEY,
  propers_repacks TEXT NOT NULL,
  enable_media_info INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE lidarr_media_settings (
  name TEXT NOT NULL PRIMARY KEY,
  propers_repacks TEXT NOT NULL,
  enable_media_info INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE quality_api_mappings (
  quality_name TEXT NOT NULL,
  arr_type TEXT NOT NULL,
  api_name TEXT NOT NULL,
  PRIMARY KEY (quality_name, arr_type)
);

CREATE TABLE sonarr_quality_definitions (
  name TEXT NOT NULL,
  quality_name TEXT NOT NULL,
  min_size INTEGER NOT NULL,
  max_size INTEGER NOT NULL,
  preferred_size INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (name, quality_name)
);

CREATE TABLE lidarr_quality_definitions (
  name TEXT NOT NULL,
  quality_name TEXT NOT NULL,
  min_size INTEGER NOT NULL,
  max_size INTEGER NOT NULL,
  preferred_size INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (name, quality_name)
);

INSERT INTO sonarr_media_settings (name, propers_repacks, enable_media_info)
VALUES ('Fallback-Only', 'preferAndUpgrade', 1);

INSERT INTO quality_api_mappings (quality_name, arr_type, api_name)
VALUES
  ('FLAC', 'lidarr', 'FLAC'),
  ('FLAC', 'sonarr', 'FLAC');

INSERT INTO sonarr_quality_definitions (name, quality_name, min_size, max_size, preferred_size)
VALUES ('Fallback-Only', 'FLAC', 64, 1024, 320);
`);

    try {
      setCache(SYNC_DATABASE_ID, fixture.cache);

      const client = new MockLidarrSyncClient();
      const syncer = new MediaManagementSyncer(client, 991, 'Lidarr Cutover', 'lidarr');
      const result = await syncer.sync();

      assertEquals(result.success, true);
      assertEquals(result.itemsSynced, 0);
      assertEquals(client.mediaUpdates.length, 0);
      assertEquals(client.qualityUpdates.length, 0);

      const mediaMissingLog = debugLogs.find(
        (entry) => entry.message === 'Media settings config "Fallback-Only" not found in lidarr_media_settings'
      );
      assertExists(mediaMissingLog);
      assertEquals(getMeta(mediaMissingLog).entityType, 'lidarr_media_settings');

      const qualityMissingLog = debugLogs.find(
        (entry) =>
          entry.message === 'Quality definitions config "Fallback-Only" not found in lidarr_quality_definitions'
      );
      assertExists(qualityMissingLog);
      assertEquals(getMeta(qualityMissingLog).entityType, 'lidarr_quality_definitions');

      const hasReuseLog = debugLogs.some((entry) => entry.message.toLowerCase().includes('reused'));
      assertEquals(hasReuseLog, false);
    } finally {
      logger.debug = originalDebug;
      logger.warn = originalWarn;
      logger.info = originalInfo;
      logger.error = originalError;
      arrSyncQueries.getMediaManagementSync = originalGetMediaManagementSync;

      deleteCache(SYNC_DATABASE_ID);
      await fixture.destroy();
    }
  },
});
