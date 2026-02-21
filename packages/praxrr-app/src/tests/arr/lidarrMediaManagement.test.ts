import { assertEquals, assertMatch } from '@std/assert';
import { isRedirect } from '@sveltejs/kit';
import { BaseTest, type TestContext } from '../base/BaseTest.ts';
import { load as namingListLoad } from '../../routes/media-management/[databaseId]/naming/+page.server.ts';
import { actions as namingNewActions } from '../../routes/media-management/[databaseId]/naming/new/+page.server.ts';
import {
  actions as namingLidarrEditActions,
  load as namingLidarrEditLoad,
} from '../../routes/media-management/[databaseId]/naming/lidarr/[name]/+page.server.ts';
import { load as mediaSettingsListLoad } from '../../routes/media-management/[databaseId]/media-settings/+page.server.ts';
import { actions as mediaSettingsNewActions } from '../../routes/media-management/[databaseId]/media-settings/new/+page.server.ts';
import { actions as mediaSettingsLidarrEditActions } from '../../routes/media-management/[databaseId]/media-settings/lidarr/[name]/+page.server.ts';
import { load as qualityDefinitionsListLoad } from '../../routes/media-management/[databaseId]/quality-definitions/+page.server.ts';
import { actions as qualityDefinitionsNewActions } from '../../routes/media-management/[databaseId]/quality-definitions/new/+page.server.ts';
import { actions as qualityDefinitionsLidarrEditActions } from '../../routes/media-management/[databaseId]/quality-definitions/lidarr/[name]/+page.server.ts';
import { PCDCache } from '$pcd/database/cache.ts';
import { deleteCache, getCache, setCache } from '$pcd/database/registry.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { pcdOpsQueries, type PcdOp } from '$db/queries/pcdOps.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import type { PCDDatabase } from '$shared/pcd/types.ts';

interface ActionFailure {
  status: number;
  data: {
    status?: number;
    code?: string;
    message?: string;
    error: string;
  };
}

interface Restore {
  (): void;
}

type FixtureRequest = Parameters<typeof namingNewActions.default>[0];

type PcdOpFixture = Omit<PcdOp, 'id'>;

class LidarrMediaManagementTest extends BaseTest {
  private static readonly DATABASE_ID = 901;
  private static readonly DATABASE_PATH = '/tmp/lidarr-media-management-fixture';

  private pcdPath = '';
  private restores: Restore[] = [];

  private patch<T extends object, K extends keyof T>(target: T, key: K, replacement: T[K]): void {
    const original = target[key];
    target[key] = replacement;
    this.restores.push(() => {
      target[key] = original;
    });
  }

  private createRequest(path: string, fields: Record<string, string>): Request {
    const formData = new FormData();
    for (const [name, value] of Object.entries(fields)) {
      formData.set(name, value);
    }

    return new Request(`http://localhost/${path}`, {
      method: 'POST',
      body: formData,
    });
  }

  private async expectRedirect(action: () => Promise<unknown>, location: string): Promise<void> {
    try {
      await action();
      throw new Error('Expected redirect response');
    } catch (error) {
      if (!isRedirect(error)) {
        throw error;
      }

      assertEquals(error.status, 303);
      assertEquals(error.location, location);
    }
  }

  private async expectFailure(
    action: () => Promise<unknown>,
    expectedStatus: number,
    expectedError: string,
    expectedMessage?: string
  ): Promise<ActionFailure> {
    const result = await action();
    const failure = result as ActionFailure;

    assertEquals(failure.status, expectedStatus);
    assertEquals(failure.data.error.includes(expectedError), true);

    if (expectedMessage !== undefined) {
      assertEquals(failure.data.message?.includes(expectedMessage), true);
    }

    return failure;
  }

  private async expectKitError(
    action: () => Promise<unknown>,
    expectedStatus: number,
    expectedMessage: string
  ): Promise<void> {
    try {
      await action();
      throw new Error('Expected SvelteKit error response');
    } catch (error) {
      const kitError = error as { status?: number; body?: { message?: string } };
      assertEquals(kitError.status, expectedStatus);
      assertEquals(kitError.body?.message, expectedMessage);
    }
  }

  private async readNamingList() {
    return (await namingListLoad({
      params: {
        databaseId: `${LidarrMediaManagementTest.DATABASE_ID}`,
      },
    } as unknown as Parameters<typeof namingListLoad>[0])) as {
      namingConfigs: Array<{ name: string; arr_type: string }>;
    };
  }

  private async readMediaSettingsList() {
    return (await mediaSettingsListLoad({
      params: {
        databaseId: `${LidarrMediaManagementTest.DATABASE_ID}`,
      },
    } as unknown as Parameters<typeof mediaSettingsListLoad>[0])) as {
      mediaSettingsConfigs: Array<{ name: string; arr_type: string }>;
    };
  }

  private async readQualityDefinitionsList() {
    return (await qualityDefinitionsListLoad({
      params: {
        databaseId: `${LidarrMediaManagementTest.DATABASE_ID}`,
      },
    } as unknown as Parameters<typeof qualityDefinitionsListLoad>[0])) as {
      qualityDefinitionsConfigs: Array<{ name: string; arr_type: string; quality_count: number }>;
    };
  }

  private installDatabaseInstanceMock(): void {
    const now = new Date().toISOString();

    this.patch(databaseInstancesQueries, 'getById', (id: number) => {
      if (id !== LidarrMediaManagementTest.DATABASE_ID) {
        return undefined;
      }

      return {
        id,
        uuid: 'lidarr-media-management-fixture',
        name: 'lidarr-media-management-fixture',
        repository_url: 'file:///tmp/lidarr-media-management-fixture',
        local_path: this.pcdPath,
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
  }

  private installPcdQueryMocks(): void {
    const operations: PcdOp[] = [];
    let nextId = 1;

    this.patch(pcdOpsQueries, 'create', (input) => {
      const now = new Date().toISOString();
      const record: PcdOp = {
        id: nextId++,
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
        created_at: now,
        updated_at: now,
      };
      operations.push(record);
      return record.id;
    });

    this.patch(pcdOpsQueries, 'listByDatabase', (databaseId) => {
      return operations.filter((operation) => operation.database_id === databaseId).sort((a, b) => a.id - b.id);
    });

    this.patch(pcdOpsQueries, 'listByDatabaseAndOrigin', (databaseId, _origin, options) => {
      const queryOptions = options ?? {};
      let rows = operations.filter((operation) => operation.database_id === databaseId && operation.origin === _origin);

      const states = queryOptions.states as string[] | undefined;

      if (states && states.length > 0) {
        rows = rows.filter((row) => states.includes(row.state));
      }

      if (queryOptions.source) {
        rows = rows.filter((row) => row.source === queryOptions.source);
      }

      return rows.sort((a, b) => a.id - b.id);
    });

    this.patch(pcdOpsQueries, 'update', (id, update) => {
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
  }

  private installPcdOpHistoryMocks(): void {
    let nextHistoryId = 1;

    this.patch(pcdOpHistoryQueries, 'create', () => {
      return nextHistoryId++;
    });

    this.patch(pcdOpHistoryQueries, 'listLatestConflictsByDatabase', () => []);
    this.patch(pcdOpHistoryQueries, 'listLatestByDatabaseWithOps', () => []);
    this.patch(pcdOpHistoryQueries, 'listByDatabase', () => []);
    this.patch(pcdOpHistoryQueries, 'listByOp', () => []);
  }

  private async buildFixtureCache(): Promise<void> {
    const schemaSql = `
CREATE TABLE IF NOT EXISTS radarr_naming (
  name TEXT NOT NULL PRIMARY KEY,
  rename INTEGER NOT NULL DEFAULT 0,
  movie_format TEXT NOT NULL DEFAULT '',
  movie_folder_format TEXT NOT NULL DEFAULT '',
  replace_illegal_characters INTEGER NOT NULL DEFAULT 1,
  colon_replacement_format TEXT NOT NULL DEFAULT 'delete',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sonarr_naming (
  name TEXT NOT NULL PRIMARY KEY,
  rename INTEGER NOT NULL DEFAULT 0,
  standard_episode_format TEXT NOT NULL DEFAULT '',
  daily_episode_format TEXT NOT NULL DEFAULT '',
  anime_episode_format TEXT NOT NULL DEFAULT '',
  series_folder_format TEXT NOT NULL DEFAULT '',
  season_folder_format TEXT NOT NULL DEFAULT '',
  replace_illegal_characters INTEGER NOT NULL DEFAULT 1,
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
  replace_illegal_characters INTEGER NOT NULL DEFAULT 1,
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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

INSERT OR REPLACE INTO radarr_naming (name, rename, movie_format, movie_folder_format, replace_illegal_characters, colon_replacement_format)
VALUES ('R-Naming-Seed', 0, 'Movie Format', 'Movie Folder', 0, 'delete');

INSERT OR REPLACE INTO lidarr_naming
  (name, rename, standard_track_format, artist_name, multi_disc_track_format,
   artist_folder_format, replace_illegal_characters, colon_replacement_format,
   custom_colon_replacement_format)
VALUES
  ('Lidarr-Naming-Seed', 1, '{Artist Name} - {Album Title} - {Track Title}', '{Artist Name}',
   '{Artist Name} - CD{medium:00} - {Track Title}', '{Artist Name}', 0, 4, NULL);

INSERT OR REPLACE INTO radarr_media_settings (name, propers_repacks, enable_media_info)
VALUES ('R-Media-Seed', 'doNotPrefer', 1);

INSERT OR REPLACE INTO lidarr_media_settings (name, propers_repacks, enable_media_info)
VALUES ('Lidarr-Media-Seed', 'preferAndUpgrade', 1);

INSERT OR REPLACE INTO quality_api_mappings (quality_name, arr_type, api_name)
VALUES
  ('FLAC', 'lidarr', 'FLAC'),
  ('AAC-192', 'lidarr', 'AAC-192'),
  ('Unknown', 'lidarr', 'Unknown');

INSERT OR REPLACE INTO lidarr_quality_definitions
  (name, quality_name, min_size, max_size, preferred_size)
VALUES
  ('Lidarr-QD-Mixed', 'FLAC', 0, 1200, 300),
  ('Lidarr-QD-Mixed', 'Unknown', 0, 800, 200);

INSERT OR REPLACE INTO sonarr_quality_definitions
  (name, quality_name, min_size, max_size, preferred_size)
VALUES ('S-QD-Seed', 'FLAC', 0, 512, 128);

INSERT OR REPLACE INTO radarr_quality_definitions
  (name, quality_name, min_size, max_size, preferred_size)
VALUES ('R-QD-Seed', 'FLAC', 0, 1024, 256);
`;

    await Deno.mkdir(`${this.pcdPath}/deps/schema/ops`, { recursive: true });
    await Deno.writeTextFile(`${this.pcdPath}/deps/schema/ops/0.schema.sql`, schemaSql);

    const cache = new PCDCache(this.pcdPath, LidarrMediaManagementTest.DATABASE_ID);
    await cache.build();
    setCache(LidarrMediaManagementTest.DATABASE_ID, cache);
  }

  protected override beforeEach(_context: TestContext): void {
    this.restores = [];
    this.pcdPath = `${LidarrMediaManagementTest.DATABASE_PATH}/${crypto.randomUUID()}`;

    this.installDatabaseInstanceMock();
    this.installPcdQueryMocks();
    this.installPcdOpHistoryMocks();
    this.patch(Promise, 'resolve', Promise.resolve.bind(Promise));
  }

  protected override afterEach(_context: TestContext): void {
    for (const restore of this.restores.reverse()) {
      restore();
    }

    const existing = getCache(LidarrMediaManagementTest.DATABASE_ID);
    if (existing) {
      existing.close();
    }

    deleteCache(LidarrMediaManagementTest.DATABASE_ID);
  }

  private async bootstrapFixture(): Promise<void> {
    await this.buildFixtureCache();
  }

  runTests(): void {
    // Matrix: Naming (NM-01..NM-09)
    this.test('[NM-01] naming list includes Lidarr config from dedicated lidarr_naming table', async () => {
      await this.bootstrapFixture();

      const { namingConfigs } = await this.readNamingList();
      const lidarrListing = namingConfigs.find((item) => item.name === 'Lidarr-Naming-Seed');

      assertEquals(lidarrListing?.arr_type, 'lidarr');
    });

    this.test('[NM-02] naming create lidarr writes to lidarr_naming table and redirects', async () => {
      await this.bootstrapFixture();

      await this.expectRedirect(async () => {
        await namingNewActions.default({
          request: this.createRequest('media-management/901/naming/new', {
            arrType: 'lidarr',
            name: 'Lidarr-Naming-New',
            layer: 'user',
            rename: 'true',
            standardTrackFormat: '{Artist Name} - {Album Title}',
            artistName: '{Artist Name}',
            multiDiscTrackFormat: '{Artist Name} - CD{medium:00}',
            artistFolderFormat: '{Artist Name}',
            replaceIllegalCharacters: 'true',
            colonReplacementFormat: 'delete',
          }),
          params: {
            databaseId: `${LidarrMediaManagementTest.DATABASE_ID}`,
          },
        } as unknown as FixtureRequest);
      }, `/media-management/${LidarrMediaManagementTest.DATABASE_ID}/naming`);

      const { namingConfigs } = await this.readNamingList();
      const created = namingConfigs.find((item) => item.arr_type === 'lidarr' && item.name === 'Lidarr-Naming-New');
      assertEquals(!!created, true);

      // Verify no sonarr_naming row was created
      const sonarrNamingCount = namingConfigs.filter(
        (item) => item.arr_type === 'sonarr' && item.name === 'Lidarr-Naming-New'
      ).length;
      assertEquals(sonarrNamingCount, 0);
    });

    this.test('[NM-03] naming create duplicate lidarr name fails with 400 and no state change', async () => {
      await this.bootstrapFixture();

      const before = (await this.readNamingList()).namingConfigs.filter(
        (config) => config.arr_type === 'lidarr'
      ).length;
      const failureRaw = await namingNewActions.default({
        request: this.createRequest('media-management/901/naming/new', {
          arrType: 'lidarr',
          name: 'Lidarr-Naming-Seed',
          layer: 'user',
          rename: 'false',
          standardTrackFormat: '{Artist Name} - {Album Title}',
          artistName: '{Artist Name}',
          multiDiscTrackFormat: '{Artist Name} - CD{medium:00}',
          artistFolderFormat: '{Artist Name}',
        }),
        params: {
          databaseId: `${LidarrMediaManagementTest.DATABASE_ID}`,
        },
      } as unknown as FixtureRequest);
      const failure = failureRaw as ActionFailure;

      assertEquals(failure.status, 400);
      assertEquals(failure.data.error, 'A lidarr naming config with name "Lidarr-Naming-Seed" already exists');

      const after = (await this.readNamingList()).namingConfigs.filter((config) => config.arr_type === 'lidarr').length;
      assertEquals(before, after);
    });

    this.test('[NM-03b] naming create lidarr name does not collide with sonarr name of same value', async () => {
      await this.bootstrapFixture();

      // Create a sonarr naming config
      await this.expectRedirect(async () => {
        await namingNewActions.default({
          request: this.createRequest('media-management/901/naming/new', {
            arrType: 'sonarr',
            name: 'Shared-Naming-Seed',
            layer: 'user',
            rename: 'true',
            standardEpisodeFormat: 'S{season:00}E{episode:00}',
            dailyEpisodeFormat: '{Series Title}',
            animeEpisodeFormat: '{Episode Title}',
            seriesFolderFormat: '{Series Title}',
            seasonFolderFormat: 'Season {season:00}',
            customColonReplacementFormat: ':-',
            multiEpisodeStyle: 'extend',
          }),
          params: {
            databaseId: `${LidarrMediaManagementTest.DATABASE_ID}`,
          },
        } as unknown as FixtureRequest);
      }, `/media-management/${LidarrMediaManagementTest.DATABASE_ID}/naming`);

      // Create lidarr naming with same name -- should succeed since tables are isolated
      await this.expectRedirect(async () => {
        await namingNewActions.default({
          request: this.createRequest('media-management/901/naming/new', {
            arrType: 'lidarr',
            name: 'Shared-Naming-Seed',
            layer: 'user',
            rename: 'false',
            standardTrackFormat: '{Artist Name} - {Album Title}',
            artistName: '{Artist Name}',
            multiDiscTrackFormat: '{Artist Name} - CD{medium:00}',
            artistFolderFormat: '{Artist Name}',
          }),
          params: {
            databaseId: `${LidarrMediaManagementTest.DATABASE_ID}`,
          },
        } as unknown as FixtureRequest);
      }, `/media-management/${LidarrMediaManagementTest.DATABASE_ID}/naming`);

      const { namingConfigs } = await this.readNamingList();
      const lidarrShared = namingConfigs.filter(
        (config) => config.arr_type === 'lidarr' && config.name === 'Shared-Naming-Seed'
      );
      const sonarrShared = namingConfigs.filter(
        (config) => config.arr_type === 'sonarr' && config.name === 'Shared-Naming-Seed'
      );
      assertEquals(lidarrShared.length, 1);
      assertEquals(sonarrShared.length, 1);
    });

    this.test('[NM-03c] naming create invalid arr type fails with deterministic 400', async () => {
      await this.bootstrapFixture();

      const failureRaw = await namingNewActions.default({
        request: this.createRequest('media-management/901/naming/new', {
          arrType: 'invalid',
          name: 'Invalid-Arr-Type',
          layer: 'user',
        }),
        params: {
          databaseId: `${LidarrMediaManagementTest.DATABASE_ID}`,
        },
      } as unknown as FixtureRequest);
      const failure = failureRaw as ActionFailure;

      assertEquals(failure.status, 400);
      assertEquals(failure.data.error, 'Invalid arr type');
    });

    this.test('[NM-03d] naming create lidarr base layer denied without write permission', async () => {
      await this.bootstrapFixture();

      const getById = databaseInstancesQueries.getById;
      this.patch(databaseInstancesQueries, 'getById', (id: number) => {
        const instance = getById(id);
        if (!instance) {
          return undefined;
        }

        return {
          ...instance,
          local_ops_enabled: 1,
        };
      });

      const failureRaw = await namingNewActions.default({
        request: this.createRequest('media-management/901/naming/new', {
          arrType: 'lidarr',
          name: 'Lidarr-Base-Denied',
          layer: 'base',
          rename: 'true',
          standardTrackFormat: '{Artist Name} - {Album Title}',
          artistName: '{Artist Name}',
          multiDiscTrackFormat: '{Artist Name} - CD{medium:00}',
          artistFolderFormat: '{Artist Name}',
        }),
        params: {
          databaseId: `${LidarrMediaManagementTest.DATABASE_ID}`,
        },
      } as unknown as FixtureRequest);
      const failure = failureRaw as ActionFailure;

      assertEquals(failure.status, 403);
      assertEquals(failure.data.error, 'Cannot write to base layer without personal access token');
    });

    this.test('[NM-04] naming edit lidarr rename persists and updates sync mapping reference', async () => {
      await this.bootstrapFixture();
      const validationFailure = await this.expectFailure(
        async () =>
          await namingLidarrEditActions.update({
            request: this.createRequest(`media-management/901/naming/lidarr/Lidarr-Naming-Seed`, {
              arrType: 'lidarr',
            }),
            params: {
              databaseId: `${LidarrMediaManagementTest.DATABASE_ID}`,
              name: 'Lidarr-Naming-Seed',
            },
          } as unknown as Parameters<typeof namingLidarrEditActions.update>[0]),
        400,
        'Name is required'
      );

      assertEquals(validationFailure.data.error, 'Name is required');

      const renameCalls: Array<{
        oldName: string;
        newName: string;
        scope: { arrType?: string; databaseId?: number; instanceId?: number };
      }> = [];
      this.patch(arrSyncQueries, 'updateNamingConfigName', (oldName: string, newName: string, scope = {}) => {
        renameCalls.push({ oldName, newName, scope });
        return 1;
      });

      await this.expectRedirect(async () => {
        await namingLidarrEditActions.update({
          request: this.createRequest(`media-management/901/naming/lidarr/Lidarr-Naming-Seed`, {
            layer: 'user',
            name: 'Lidarr-Naming-Renamed',
            rename: 'true',
            standardTrackFormat: '{Artist Name} - {Album Title} - {Track Title}',
            artistName: '{Artist Name}',
            multiDiscTrackFormat: '{Artist Name} - CD{medium:00} - {Track Title}',
            artistFolderFormat: '{Artist Name}',
            customColonReplacementFormat: ':-',
          }),
          params: {
            databaseId: `${LidarrMediaManagementTest.DATABASE_ID}`,
            name: 'Lidarr-Naming-Seed',
          },
        } as unknown as Parameters<typeof namingLidarrEditActions.update>[0]);
      }, `/media-management/${LidarrMediaManagementTest.DATABASE_ID}/naming`);

      const { namingConfigs } = await this.readNamingList();
      assertEquals(renameCalls.length, 1);
      assertEquals(renameCalls[0], {
        oldName: 'Lidarr-Naming-Seed',
        newName: 'Lidarr-Naming-Renamed',
        scope: {
          arrType: 'lidarr',
          databaseId: LidarrMediaManagementTest.DATABASE_ID,
        },
      });
      assertEquals(
        namingConfigs.find((item) => item.arr_type === 'lidarr' && item.name === 'Lidarr-Naming-Renamed') !== undefined,
        true
      );
      assertEquals(
        namingConfigs.find((item) => item.arr_type === 'lidarr' && item.name === 'Lidarr-Naming-Seed'),
        undefined
      );
    });

    this.test('[NM-05] naming edit lidarr base layer denied without write permission', async () => {
      await this.bootstrapFixture();

      const getById = databaseInstancesQueries.getById;
      this.patch(databaseInstancesQueries, 'getById', (id: number) => {
        const instance = getById(id);
        if (!instance) {
          return undefined;
        }

        return {
          ...instance,
          local_ops_enabled: 1,
        };
      });

      const failureRaw = await namingLidarrEditActions.update({
        request: this.createRequest(`media-management/901/naming/lidarr/Lidarr-Naming-Seed`, {
          layer: 'base',
          name: 'Lidarr-Naming-Seed',
          rename: 'true',
          standardTrackFormat: '{Artist Name} - {Album Title} - {Track Title}',
          artistName: '{Artist Name}',
          multiDiscTrackFormat: '{Artist Name} - CD{medium:00} - {Track Title}',
          artistFolderFormat: '{Artist Name}',
          customColonReplacementFormat: ':-',
        }),
        params: {
          databaseId: `${LidarrMediaManagementTest.DATABASE_ID}`,
          name: 'Lidarr-Naming-Seed',
        },
      } as unknown as Parameters<typeof namingLidarrEditActions.update>[0]);
      const failure = failureRaw as ActionFailure;

      assertEquals(failure.status, 403);
      assertEquals(failure.data.error, 'Cannot write to base layer without personal access token');
    });

    this.test('[NM-06] naming lidarr deep-link load returns Lidarr-native fields', async () => {
      await this.bootstrapFixture();

      await this.expectRedirect(async () => {
        await namingNewActions.default({
          request: this.createRequest('media-management/901/naming/new', {
            arrType: 'lidarr',
            name: 'Lidarr Naming Deep Link',
            layer: 'user',
            rename: 'true',
            standardTrackFormat: '{Artist Name} - {Album Title} - {Track Title}',
            artistName: '{Artist Name}',
            multiDiscTrackFormat: '{Artist Name} - CD{medium:00} - {Track Title}',
            artistFolderFormat: '{Artist Name}',
            colonReplacementFormat: 'delete',
          }),
          params: {
            databaseId: `${LidarrMediaManagementTest.DATABASE_ID}`,
          },
        } as unknown as FixtureRequest);
      }, `/media-management/${LidarrMediaManagementTest.DATABASE_ID}/naming`);

      const loaded = (await namingLidarrEditLoad({
        params: {
          databaseId: `${LidarrMediaManagementTest.DATABASE_ID}`,
          name: encodeURIComponent('Lidarr Naming Deep Link'),
        },
        parent: async () => ({
          canWriteToBase: false,
        }),
      } as unknown as Parameters<typeof namingLidarrEditLoad>[0])) as {
        namingConfig: { name: string; standard_track_format: string; artist_name: string };
        canWriteToBase: boolean;
      };

      assertEquals(loaded.namingConfig.name, 'Lidarr Naming Deep Link');
      assertEquals(loaded.namingConfig.standard_track_format, '{Artist Name} - {Album Title} - {Track Title}');
      assertEquals(loaded.namingConfig.artist_name, '{Artist Name}');
      assertEquals(loaded.canWriteToBase, false);
    });

    this.test('[NM-07] naming lidarr deep-link missing name fails deterministically with 400', async () => {
      await this.bootstrapFixture();

      await this.expectKitError(
        async () =>
          await namingLidarrEditLoad({
            params: {
              databaseId: `${LidarrMediaManagementTest.DATABASE_ID}`,
              name: '',
            },
            parent: async () => ({
              canWriteToBase: false,
            }),
          } as unknown as Parameters<typeof namingLidarrEditLoad>[0]),
        400,
        'Missing parameters'
      );
    });

    this.test('[NM-08] naming list returns only lidarr entries from lidarr_naming table', async () => {
      await this.bootstrapFixture();

      const { namingConfigs } = await this.readNamingList();
      const lidarrNames = namingConfigs.filter((config) => config.arr_type === 'lidarr').map((c) => c.name);

      // Only the seed row from lidarr_naming should appear
      assertEquals(lidarrNames, ['Lidarr-Naming-Seed']);

      // Sonarr names should not leak into lidarr results
      const sonarrAsLidarr = namingConfigs.filter(
        (config) => config.arr_type === 'lidarr' && config.name === 'S-Naming-Seed'
      );
      assertEquals(sonarrAsLidarr.length, 0);
    });

    // Matrix: Media-settings (MS-01..MS-05)
    this.test('[MS-01] media-settings list includes Lidarr config from dedicated lidarr_media_settings', async () => {
      await this.bootstrapFixture();

      const { mediaSettingsConfigs } = await this.readMediaSettingsList();
      const lidarrListing = mediaSettingsConfigs.find((item) => item.name === 'Lidarr-Media-Seed');

      assertEquals(lidarrListing?.arr_type, 'lidarr');
    });

    this.test('[MS-02] media-settings create lidarr writes to lidarr_media_settings and redirects', async () => {
      await this.bootstrapFixture();

      await this.expectRedirect(async () => {
        await mediaSettingsNewActions.default({
          request: this.createRequest('media-management/901/media-settings/new', {
            arrType: 'lidarr',
            name: 'Lidarr-Media-New',
            propersRepacks: 'preferAndUpgrade',
            enableMediaInfo: 'true',
            layer: 'user',
          }),
          params: {
            databaseId: `${LidarrMediaManagementTest.DATABASE_ID}`,
          },
        } as unknown as Parameters<typeof mediaSettingsNewActions.default>[0]);
      }, `/media-management/${LidarrMediaManagementTest.DATABASE_ID}/media-settings`);

      const { mediaSettingsConfigs } = await this.readMediaSettingsList();
      const created = mediaSettingsConfigs.find(
        (item) => item.arr_type === 'lidarr' && item.name === 'Lidarr-Media-New'
      );
      assertEquals(!!created, true);

      // Verify no sonarr_media_settings row was created
      const sonarrCount = mediaSettingsConfigs.filter(
        (item) => item.arr_type === 'sonarr' && item.name === 'Lidarr-Media-New'
      ).length;
      assertEquals(sonarrCount, 0);
    });

    this.test('[MS-03] media-settings create invalid arr type fails with 400', async () => {
      await this.bootstrapFixture();

      const failureRaw = await mediaSettingsNewActions.default({
        request: this.createRequest('media-management/901/media-settings/new', {
          arrType: 'invalid',
          name: 'Any-Media',
          propersRepacks: 'doNotPrefer',
          enableMediaInfo: 'false',
          layer: 'user',
        }),
        params: {
          databaseId: `${LidarrMediaManagementTest.DATABASE_ID}`,
        },
      } as unknown as Parameters<typeof mediaSettingsNewActions.default>[0]);
      const failure = failureRaw as ActionFailure;

      assertEquals(failure.status, 400);
      assertEquals(failure.data.error, 'Invalid arr type');
    });

    this.test('[MS-04] media-settings edit lidarr rename updates persisted state and sync mapping', async () => {
      await this.bootstrapFixture();

      const loadFailureRaw = await mediaSettingsLidarrEditActions.update({
        request: this.createRequest(`media-management/901/media-settings/lidarr/Lidarr-Media-Seed`, {
          propersRepacks: 'doNotPrefer',
        }),
        params: {
          databaseId: `${LidarrMediaManagementTest.DATABASE_ID}`,
          name: 'Lidarr-Media-Seed',
        },
      } as unknown as Parameters<typeof mediaSettingsLidarrEditActions.update>[0]);
      const loadResult = loadFailureRaw as ActionFailure;

      assertEquals(loadResult.status, 400);
      assertEquals(loadResult.data.error.includes('Name is required'), true);

      const renameCalls: Array<{ oldName: string; newName: string }> = [];
      this.patch(arrSyncQueries, 'updateMediaSettingsConfigName', (oldName: string, newName: string) => {
        renameCalls.push({ oldName, newName });
        return 1;
      });

      await this.expectRedirect(async () => {
        await mediaSettingsLidarrEditActions.update({
          request: this.createRequest(`media-management/901/media-settings/lidarr/Lidarr-Media-Seed`, {
            layer: 'user',
            name: 'Lidarr-Media-Renamed',
            propersRepacks: 'preferAndUpgrade',
            enableMediaInfo: 'false',
          }),
          params: {
            databaseId: `${LidarrMediaManagementTest.DATABASE_ID}`,
            name: 'Lidarr-Media-Seed',
          },
        } as unknown as Parameters<typeof mediaSettingsLidarrEditActions.update>[0]);
      }, `/media-management/${LidarrMediaManagementTest.DATABASE_ID}/media-settings`);

      const { mediaSettingsConfigs } = await this.readMediaSettingsList();
      assertEquals(renameCalls.length, 1);
      assertEquals(renameCalls[0], {
        oldName: 'Lidarr-Media-Seed',
        newName: 'Lidarr-Media-Renamed',
      });
      assertEquals(
        mediaSettingsConfigs.find((item) => item.arr_type === 'lidarr' && item.name === 'Lidarr-Media-Renamed') !==
          undefined,
        true
      );
      assertEquals(
        mediaSettingsConfigs.find((item) => item.arr_type === 'lidarr' && item.name === 'Lidarr-Media-Seed'),
        undefined
      );
    });

    this.test('[MS-05] media-settings list returns only lidarr entries from lidarr_media_settings', async () => {
      await this.bootstrapFixture();

      const { mediaSettingsConfigs } = await this.readMediaSettingsList();
      const lidarrNames = mediaSettingsConfigs.filter((c) => c.arr_type === 'lidarr').map((c) => c.name);

      assertEquals(lidarrNames, ['Lidarr-Media-Seed']);
    });

    // Matrix: Quality-definitions (QD-01..QD-07)
    this.test('[QD-01] quality-definitions list includes Lidarr projected count with mapped filter', async () => {
      await this.bootstrapFixture();

      const { qualityDefinitionsConfigs } = await this.readQualityDefinitionsList();
      const mixed = qualityDefinitionsConfigs.find((item) => item.name === 'Lidarr-QD-Mixed');

      assertEquals(mixed?.arr_type, 'lidarr');
      assertEquals(mixed?.quality_count, 2);
    });

    this.test('[QD-02] quality-definitions create lidarr redirects and persists mapped entries', async () => {
      await this.bootstrapFixture();

      await this.expectRedirect(async () => {
        await qualityDefinitionsNewActions.default({
          request: this.createRequest('media-management/901/quality-definitions/new', {
            arrType: 'lidarr',
            name: 'Lidarr-QD-New',
            layer: 'user',
            entries: JSON.stringify([
              {
                quality_name: 'FLAC',
                min_size: 0,
                max_size: 2000,
                preferred_size: 500,
              },
              {
                quality_name: 'AAC-192',
                min_size: 0,
                max_size: 2000,
                preferred_size: 600,
              },
            ]),
          }),
          params: {
            databaseId: `${LidarrMediaManagementTest.DATABASE_ID}`,
          },
        } as unknown as Parameters<typeof qualityDefinitionsNewActions.default>[0]);
      }, `/media-management/${LidarrMediaManagementTest.DATABASE_ID}/quality-definitions`);

      const { qualityDefinitionsConfigs } = await this.readQualityDefinitionsList();
      const created = qualityDefinitionsConfigs.find(
        (item) => item.arr_type === 'lidarr' && item.name === 'Lidarr-QD-New'
      );
      assertEquals(created?.quality_count, 2);

      // Verify no sonarr_quality_definitions row was created
      const sonarrCount = qualityDefinitionsConfigs.filter(
        (item) => item.arr_type === 'sonarr' && item.name === 'Lidarr-QD-New'
      ).length;
      assertEquals(sonarrCount, 0);
    });

    this.test('[QD-03] quality-definitions mapping-gated unmapped input returns 400 domain failure', async () => {
      await this.bootstrapFixture();

      const failureRaw = await qualityDefinitionsNewActions.default({
        request: this.createRequest('media-management/901/quality-definitions/new', {
          arrType: 'lidarr',
          name: 'Lidarr-QD-Unmapped',
          layer: 'user',
          entries: JSON.stringify([
            {
              quality_name: 'Unmapped-Audio',
              min_size: 0,
              max_size: 1000,
              preferred_size: 400,
            },
          ]),
        }),
        params: {
          databaseId: `${LidarrMediaManagementTest.DATABASE_ID}`,
        },
      } as unknown as Parameters<typeof qualityDefinitionsNewActions.default>[0]);
      const failure = failureRaw as ActionFailure;

      assertEquals(failure.status, 400);
      assertMatch(failure.data.error, /Unsupported quality names for quality definitions/);
      assertEquals(failure.data.code, 'quality_definitions_unmapped');
      assertEquals(failure.data.message?.includes('Unmapped-Audio'), true);

      const { qualityDefinitionsConfigs } = await this.readQualityDefinitionsList();
      assertEquals(
        qualityDefinitionsConfigs.find((item) => item.name === 'Lidarr-QD-Unmapped' && item.arr_type === 'lidarr'),
        undefined
      );
    });

    this.test(
      '[QD-04] quality-definitions edit lidarr updates rename and entries with sync mapping callback',
      async () => {
        await this.bootstrapFixture();

        const editLoadRaw = await qualityDefinitionsLidarrEditActions.update({
          request: this.createRequest(`media-management/901/quality-definitions/lidarr/Lidarr-QD-Mixed`, {
            name: 'Lidarr-QD-Mixed',
            entries: JSON.stringify([
              {
                quality_name: 'Unmapped-Audio',
                min_size: 0,
                max_size: 1000,
                preferred_size: 300,
              },
            ]),
          }),
          params: {
            databaseId: `${LidarrMediaManagementTest.DATABASE_ID}`,
            name: 'Lidarr-QD-Mixed',
          },
        } as unknown as Parameters<typeof qualityDefinitionsLidarrEditActions.update>[0]);
        const editLoad = editLoadRaw as ActionFailure;

        assertEquals(editLoad.status, 400);
        assertEquals(editLoad.data.code, 'quality_definitions_unmapped');

        const renameCalls: Array<{ oldName: string; newName: string }> = [];
        this.patch(arrSyncQueries, 'updateQualityDefinitionsConfigName', (oldName: string, newName: string) => {
          renameCalls.push({ oldName, newName });
          return 1;
        });

        await this.expectRedirect(async () => {
          await qualityDefinitionsLidarrEditActions.update({
            request: this.createRequest(`media-management/901/quality-definitions/lidarr/Lidarr-QD-Mixed`, {
              layer: 'user',
              name: 'Lidarr-QD-Renamed',
              entries: JSON.stringify([
                {
                  quality_name: 'FLAC',
                  min_size: 100,
                  max_size: 1200,
                  preferred_size: 320,
                },
                {
                  quality_name: 'AAC-192',
                  min_size: 128,
                  max_size: 1300,
                  preferred_size: 420,
                },
              ]),
            }),
            params: {
              databaseId: `${LidarrMediaManagementTest.DATABASE_ID}`,
              name: 'Lidarr-QD-Mixed',
            },
          } as unknown as Parameters<typeof qualityDefinitionsLidarrEditActions.update>[0]);
        }, `/media-management/${LidarrMediaManagementTest.DATABASE_ID}/quality-definitions`);

        const { qualityDefinitionsConfigs } = await this.readQualityDefinitionsList();
        assertEquals(renameCalls.length, 1);
        assertEquals(renameCalls[0], {
          oldName: 'Lidarr-QD-Mixed',
          newName: 'Lidarr-QD-Renamed',
        });
        const updated = qualityDefinitionsConfigs.find(
          (item) => item.arr_type === 'lidarr' && item.name === 'Lidarr-QD-Renamed'
        );
        assertEquals(updated?.quality_count, 2);
        assertEquals(
          qualityDefinitionsConfigs.find((item) => item.arr_type === 'lidarr' && item.name === 'Lidarr-QD-Mixed'),
          undefined
        );
      }
    );

    this.test('[QD-05] quality-definitions create duplicate lidarr mapped name fails with 400', async () => {
      await this.bootstrapFixture();

      const failureRaw = await qualityDefinitionsNewActions.default({
        request: this.createRequest('media-management/901/quality-definitions/new', {
          arrType: 'lidarr',
          name: 'Lidarr-QD-Mixed',
          layer: 'user',
          entries: JSON.stringify([
            {
              quality_name: 'FLAC',
              min_size: 1,
              max_size: 2,
              preferred_size: 1,
            },
          ]),
        }),
        params: {
          databaseId: `${LidarrMediaManagementTest.DATABASE_ID}`,
        },
      } as unknown as Parameters<typeof qualityDefinitionsNewActions.default>[0]);
      const failure = failureRaw as ActionFailure;

      assertEquals(failure.status, 400);
      assertEquals(failure.data.code, 'quality_definitions_duplicate_name');
      assertMatch(failure.data.error, /already exists/i);
    });

    this.test('[QD-06] quality-definitions create duplicate quality names returns explicit 400 code', async () => {
      await this.bootstrapFixture();

      const failureRaw = await qualityDefinitionsNewActions.default({
        request: this.createRequest('media-management/901/quality-definitions/new', {
          arrType: 'lidarr',
          name: 'Lidarr-QD-Duplicate-Entries',
          layer: 'user',
          entries: JSON.stringify([
            {
              quality_name: 'FLAC',
              min_size: 1,
              max_size: 2,
              preferred_size: 1,
            },
            {
              quality_name: 'flac',
              min_size: 3,
              max_size: 4,
              preferred_size: 2,
            },
          ]),
        }),
        params: {
          databaseId: `${LidarrMediaManagementTest.DATABASE_ID}`,
        },
      } as unknown as Parameters<typeof qualityDefinitionsNewActions.default>[0]);
      const failure = failureRaw as ActionFailure;

      assertEquals(failure.status, 400);
      assertEquals(failure.data.code, 'quality_definitions_duplicate_qualities');
      assertMatch(failure.data.error, /duplicate quality names/i);
    });

    this.test(
      '[QD-07] quality-definitions list returns only lidarr entries from lidarr_quality_definitions',
      async () => {
        await this.bootstrapFixture();

        const { qualityDefinitionsConfigs } = await this.readQualityDefinitionsList();
        const lidarrNames = qualityDefinitionsConfigs.filter((c) => c.arr_type === 'lidarr').map((c) => c.name);

        // Only Lidarr-QD-Mixed from lidarr_quality_definitions
        assertEquals(lidarrNames, ['Lidarr-QD-Mixed']);

        // Sonarr seed should not appear as lidarr
        const sonarrAsLidarr = qualityDefinitionsConfigs.filter(
          (c) => c.arr_type === 'lidarr' && c.name === 'S-QD-Seed'
        );
        assertEquals(sonarrAsLidarr.length, 0);
      }
    );
  }
}

const test = new LidarrMediaManagementTest();
await test.runTests();
