import { assertEquals, assertExists, assertThrows } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import {
  arrSyncQueries,
  type MediaManagementSyncData,
  type MetadataProfilesSyncData,
} from '$db/queries/arrSync.ts';

type ArrSyncMediaManagementRow = {
  instance_id: number;
  naming_database_id: number | null;
  naming_config_name: string | null;
  quality_definitions_database_id: number | null;
  quality_definitions_config_name: string | null;
  media_settings_database_id: number | null;
  media_settings_config_name: string | null;
};

type ArrSyncMetadataProfilesRow = {
  instance_id: number;
  database_id: number | null;
  profile_name: string | null;
};

type ArrSyncMetadataProfilesStatusRow = {
  should_sync: number;
  trigger: string;
  sync_status: string;
  next_run_at: string | null;
  last_error: string | null;
};

type MediaManagementConfigNameColumn =
  | 'naming_config_name'
  | 'quality_definitions_config_name'
  | 'media_settings_config_name';

function bootstrapSchema(): void {
  db.exec(`
    CREATE TABLE arr_instances (
      id INTEGER PRIMARY KEY,
      type TEXT NOT NULL
    );

    CREATE TABLE arr_sync_media_management (
      instance_id INTEGER PRIMARY KEY,
      naming_database_id INTEGER,
      naming_config_name TEXT,
      quality_definitions_database_id INTEGER,
      quality_definitions_config_name TEXT,
      media_settings_database_id INTEGER,
      media_settings_config_name TEXT,
      trigger TEXT NOT NULL DEFAULT 'manual',
      cron TEXT,
      should_sync INTEGER NOT NULL DEFAULT 0,
      next_run_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'idle',
      last_error TEXT,
      last_synced_at TEXT
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

function insertInstance(id: number, type: string): void {
  db.execute('INSERT INTO arr_instances (id, type) VALUES (?, ?)', id, type);
}

function saveMediaManagement(instanceId: number, data: MediaManagementSyncData): void {
  arrSyncQueries.saveMediaManagementSync(instanceId, data);
}

function saveMetadataProfiles(instanceId: number, data: MetadataProfilesSyncData): void {
  arrSyncQueries.saveMetadataProfilesSync(instanceId, data);
}

function getMediaManagementRow(instanceId: number): ArrSyncMediaManagementRow {
  const row = db.queryFirst<ArrSyncMediaManagementRow>(
    `SELECT
      instance_id,
      naming_database_id,
      naming_config_name,
      quality_definitions_database_id,
      quality_definitions_config_name,
      media_settings_database_id,
      media_settings_config_name
     FROM arr_sync_media_management
     WHERE instance_id = ?`,
    instanceId
  );

  assertExists(row);
  return row;
}

function getMetadataProfilesRow(instanceId: number): ArrSyncMetadataProfilesRow {
  const row = db.queryFirst<ArrSyncMetadataProfilesRow>(
    `SELECT
      instance_id,
      database_id,
      profile_name
      FROM arr_sync_metadata_profiles_config
      WHERE instance_id = ?`,
    instanceId
  );

  assertExists(row);
  return row;
}

function getMetadataProfilesStatusRow(instanceId: number): ArrSyncMetadataProfilesStatusRow {
  const row = db.queryFirst<ArrSyncMetadataProfilesStatusRow>(
    `SELECT should_sync, trigger, sync_status, next_run_at, last_error
      FROM arr_sync_metadata_profiles_config
      WHERE instance_id = ?`,
    instanceId
  );

  assertExists(row);
  return row;
}

function getMetadataProfileInstanceIds(profileName: string): number[] {
  return db
    .query<{
      instance_id: number;
    }>('SELECT instance_id FROM arr_sync_metadata_profiles_config WHERE profile_name = ? ORDER BY instance_id', profileName)
    .map((row) => row.instance_id);
}

function getInstanceIdsByConfigName(column: MediaManagementConfigNameColumn, configName: string): number[] {
  return db
    .query<{
      instance_id: number;
    }>(`SELECT instance_id FROM arr_sync_media_management WHERE ${column} = ? ORDER BY instance_id`, configName)
    .map((row) => row.instance_id);
}

function createValidSyncData(): MediaManagementSyncData {
  return {
    namingDatabaseId: 11,
    namingConfigName: 'Lidarr Naming',
    qualityDefinitionsDatabaseId: 12,
    qualityDefinitionsConfigName: 'Lidarr Quality',
    mediaSettingsDatabaseId: 13,
    mediaSettingsConfigName: 'Lidarr Media',
    trigger: 'manual',
    cron: null,
  };
}

function createMetadataSyncData(databaseId = 11, profileName = 'Lidarr Metadata'): MetadataProfilesSyncData {
  return {
    databaseId,
    profileName,
    trigger: 'manual',
    cron: null,
  };
}

Deno.test({
  name: 'arrSync media-management helpers keep Lidarr rename propagation and selection updates deterministic',
  sanitizeResources: false,
  fn: async (t) => {
    const originalBasePath = config.paths.base;
    const tempBasePath = `/tmp/profilarr-tests/arr-sync-lidarr-${crypto.randomUUID()}`;

    await Deno.mkdir(tempBasePath, { recursive: true });

    db.close();
    config.setBasePath(tempBasePath);

    try {
      await db.initialize();
      bootstrapSchema();

      await t.step('saveMediaManagementSync preserves exact names and complete selections', () => {
        insertInstance(1, 'lidarr');

        saveMediaManagement(1, {
          namingDatabaseId: 101,
          namingConfigName: '  Lidarr Naming  ',
          qualityDefinitionsDatabaseId: 102,
          qualityDefinitionsConfigName: '  Lidarr Quality  ',
          mediaSettingsDatabaseId: 103,
          mediaSettingsConfigName: '  Lidarr Media  ',
          trigger: 'schedule',
          cron: '*/15 * * * *',
        });

        const saved = arrSyncQueries.getMediaManagementSync(1);
        assertEquals(saved.namingDatabaseId, 101);
        assertEquals(saved.namingConfigName, '  Lidarr Naming  ');
        assertEquals(saved.qualityDefinitionsDatabaseId, 102);
        assertEquals(saved.qualityDefinitionsConfigName, '  Lidarr Quality  ');
        assertEquals(saved.mediaSettingsDatabaseId, 103);
        assertEquals(saved.mediaSettingsConfigName, '  Lidarr Media  ');
        assertEquals(saved.trigger, 'schedule');
        assertEquals(saved.cron, '*/15 * * * *');
      });

      await t.step('saveMediaManagementSync rejects partial section selections', () => {
        insertInstance(2, 'lidarr');

        assertThrows(
          () =>
            saveMediaManagement(2, {
              ...createValidSyncData(),
              namingDatabaseId: 201,
              namingConfigName: null,
            }),
          Error,
          'database_id and config_name must be set together'
        );

        assertThrows(
          () =>
            saveMediaManagement(2, {
              ...createValidSyncData(),
              qualityDefinitionsDatabaseId: null,
              qualityDefinitionsConfigName: 'orphan-quality-name',
            }),
          Error,
          'database_id and config_name must be set together'
        );

        assertThrows(
          () =>
            saveMediaManagement(2, {
              ...createValidSyncData(),
              mediaSettingsDatabaseId: 203,
              mediaSettingsConfigName: '   ',
            }),
          Error,
          'database_id and config_name must be set together'
        );
      });

      await t.step('Lidarr-scoped rename updates only the targeted section and scope', () => {
        insertInstance(3, 'lidarr');
        insertInstance(4, 'radarr');
        insertInstance(5, 'lidarr');

        saveMediaManagement(3, {
          namingDatabaseId: 301,
          namingConfigName: 'Shared Naming',
          qualityDefinitionsDatabaseId: 301,
          qualityDefinitionsConfigName: 'Shared Quality',
          mediaSettingsDatabaseId: 301,
          mediaSettingsConfigName: 'Shared Media',
          trigger: 'manual',
          cron: null,
        });

        saveMediaManagement(4, {
          namingDatabaseId: 301,
          namingConfigName: 'Shared Naming',
          qualityDefinitionsDatabaseId: 301,
          qualityDefinitionsConfigName: 'Shared Quality',
          mediaSettingsDatabaseId: 301,
          mediaSettingsConfigName: 'Shared Media',
          trigger: 'manual',
          cron: null,
        });

        saveMediaManagement(5, {
          namingDatabaseId: 302,
          namingConfigName: 'Shared Naming',
          qualityDefinitionsDatabaseId: 302,
          qualityDefinitionsConfigName: 'Shared Quality',
          mediaSettingsDatabaseId: 302,
          mediaSettingsConfigName: 'Shared Media',
          trigger: 'manual',
          cron: null,
        });

        assertEquals(
          arrSyncQueries.updateNamingConfigName('Shared Naming', 'Renamed Naming', {
            arrType: 'lidarr',
            databaseId: 301,
          }),
          1
        );
        assertEquals(
          arrSyncQueries.updateQualityDefinitionsConfigName('Shared Quality', 'Renamed Quality', {
            arrType: 'lidarr',
            databaseId: 301,
          }),
          1
        );
        assertEquals(
          arrSyncQueries.updateMediaSettingsConfigName('Shared Media', 'Renamed Media', {
            arrType: 'lidarr',
            databaseId: 301,
          }),
          1
        );
        assertEquals(getInstanceIdsByConfigName('naming_config_name', 'Renamed Naming'), [3]);
        assertEquals(getInstanceIdsByConfigName('quality_definitions_config_name', 'Renamed Quality'), [3]);
        assertEquals(getInstanceIdsByConfigName('media_settings_config_name', 'Renamed Media'), [3]);

        const lidarrTarget = getMediaManagementRow(3);
        assertEquals(lidarrTarget.naming_config_name, 'Renamed Naming');
        assertEquals(lidarrTarget.quality_definitions_config_name, 'Renamed Quality');
        assertEquals(lidarrTarget.media_settings_config_name, 'Renamed Media');

        const radarrUnchanged = getMediaManagementRow(4);
        assertEquals(radarrUnchanged.naming_config_name, 'Shared Naming');
        assertEquals(radarrUnchanged.quality_definitions_config_name, 'Shared Quality');
        assertEquals(radarrUnchanged.media_settings_config_name, 'Shared Media');

        const lidarrOtherDatabase = getMediaManagementRow(5);
        assertEquals(lidarrOtherDatabase.naming_config_name, 'Shared Naming');
        assertEquals(lidarrOtherDatabase.quality_definitions_config_name, 'Shared Quality');
        assertEquals(lidarrOtherDatabase.media_settings_config_name, 'Shared Media');
      });

      await t.step('rename helpers fail fast on invalid names and no-op on equal names', () => {
        assertThrows(
          () =>
            arrSyncQueries.updateNamingConfigName('   ', 'Renamed Naming', {
              arrType: 'lidarr',
              databaseId: 301,
            }),
          Error,
          'oldName is required'
        );

        assertThrows(
          () =>
            arrSyncQueries.updateMediaSettingsConfigName('Shared Media', '   ', {
              arrType: 'lidarr',
              databaseId: 301,
            }),
          Error,
          'newName is required'
        );

        assertEquals(
          arrSyncQueries.updateQualityDefinitionsConfigName('Renamed Quality', 'Renamed Quality', {
            arrType: 'lidarr',
            databaseId: 301,
          }),
          0
        );
      });

      await t.step('metadata profile helpers enforce lidarr-only scope and paired selection validation', () => {
        insertInstance(6, 'lidarr');
        insertInstance(7, 'radarr');
        insertInstance(8, 'lidarr');

        arrSyncQueries.saveMetadataProfilesSync(6, {
          databaseId: 501,
          profileName: '  Shared Metadata  ',
          trigger: 'manual',
          cron: null,
        });

        const savedMetadata = arrSyncQueries.getMetadataProfilesSync(6);
        assertEquals(savedMetadata.databaseId, 501);
        assertEquals(savedMetadata.profileName, '  Shared Metadata  ');
        assertEquals(savedMetadata.trigger, 'manual');
        assertEquals(savedMetadata.cron, null);

        const metadataProfileRow = getMetadataProfilesRow(6);
        assertEquals(metadataProfileRow.database_id, 501);
        assertEquals(metadataProfileRow.profile_name, '  Shared Metadata  ');

        const radarrMetadata = arrSyncQueries.getMetadataProfilesSync(7);
        assertEquals(radarrMetadata.databaseId, null);
        assertEquals(radarrMetadata.profileName, null);

        assertThrows(
          () =>
            saveMetadataProfiles(7, {
              databaseId: 701,
              profileName: 'Radarr Metadata',
              trigger: 'manual',
              cron: null,
            }),
          Error,
          'metadata profile sync is supported only for lidarr instances'
        );

        assertThrows(
          () =>
            saveMetadataProfiles(6, {
              ...createMetadataSyncData(401),
              profileName: null,
            }),
          Error,
          'Invalid metadata profile selection: database_id and profile_name must be set together'
        );

        assertThrows(
          () =>
            saveMetadataProfiles(6, {
              databaseId: null,
              profileName: 'orphan',
              trigger: 'manual',
              cron: null,
            }),
          Error,
          'Invalid metadata profile selection: database_id and profile_name must be set together'
        );

        assertThrows(
          () =>
            saveMetadataProfiles(6, {
              databaseId: 501,
              profileName: '   ',
              trigger: 'manual',
              cron: null,
            }),
          Error,
          'Invalid metadata profile selection: database_id and profile_name must be set together'
        );

        arrSyncQueries.saveMetadataProfilesSync(8, {
          ...createMetadataSyncData(501, 'Shared Metadata'),
          trigger: 'manual',
        });

        assertEquals(
          arrSyncQueries.updateMetadataProfileName('Shared Metadata', 'Renamed Metadata', {
            arrType: 'lidarr',
            databaseId: 501,
          }),
          1
        );
        assertEquals(getMetadataProfileInstanceIds('Renamed Metadata'), [8]);

        assertEquals(
          getMetadataProfileInstanceIds('Shared Metadata'),
          []
        );

        assertEquals(
          getMetadataProfileInstanceIds('  Shared Metadata  '),
          [6]
        );

        assertEquals(
          arrSyncQueries.updateMetadataProfileName('Renamed Metadata', 'Renamed Metadata', {
            arrType: 'lidarr',
            databaseId: 501,
          }),
          0
        );

        assertThrows(
          () =>
            arrSyncQueries.updateMetadataProfileName('   ', 'Fallback Metadata', {
              arrType: 'lidarr',
              databaseId: 501,
            }),
          Error,
          'oldName is required'
        );

        assertThrows(
          () =>
            arrSyncQueries.updateMetadataProfileName('Shared Metadata', '   ', {
              arrType: 'lidarr',
              databaseId: 501,
            }),
          Error,
          'newName is required'
        );

        assertEquals(
          arrSyncQueries.updateMetadataProfileName('Renamed Metadata', 'Final Metadata', {
            arrType: 'radarr',
          }),
          0
        );

        assertEquals(
          getMetadataProfileInstanceIds('Final Metadata'),
          []
        );
      });

      await t.step('metadata profile aggregate selectors and lifecycle helpers stay lidarr-scoped', () => {
        insertInstance(9, 'lidarr');
        insertInstance(10, 'radarr');

        arrSyncQueries.saveMetadataProfilesSync(9, {
          databaseId: 901,
          profileName: 'Scoped Manual',
          trigger: 'manual',
          cron: '*/15 * * * *',
        });
        db.execute(
          `INSERT INTO arr_sync_metadata_profiles_config
            (instance_id, trigger, cron, should_sync, next_run_at, database_id, profile_name, sync_status, last_error, last_synced_at)
            VALUES (10, 'manual', '*/15 * * * *', 1, '2026-02-17T00:00:00.000Z', 901, 'Scoped Manual', 'idle', NULL, NULL)`
        );
        arrSyncQueries.setMetadataProfilesShouldSync(9, true);
        assertEquals(getMetadataProfilesStatusRow(9).should_sync, 1);
        assertEquals(getMetadataProfilesStatusRow(10).should_sync, 1);

        const pendingBefore = [...arrSyncQueries.getPendingSyncs().metadataProfiles].sort((a, b) => a - b);
        assertEquals(pendingBefore.includes(9), true);
        assertEquals(pendingBefore.includes(10), false);

        db.execute("UPDATE arr_sync_metadata_profiles_config SET sync_status = 'pending', should_sync = 1 WHERE instance_id IN (9, 10)");
        const pendingByStatus = [...arrSyncQueries.getPendingSyncsByStatus().metadataProfiles].sort((a, b) => a - b);
        assertEquals(pendingByStatus.includes(9), true);
        assertEquals(pendingByStatus.includes(10), false);

        db.execute(
          "UPDATE arr_sync_metadata_profiles_config SET trigger = 'schedule', should_sync = 0, sync_status = 'idle', next_run_at = '2026-02-18T00:00:00.000Z' WHERE instance_id IN (9, 10)"
        );
        const scheduled = arrSyncQueries.getScheduledConfigs().metadataProfiles
          .map((row) => row.instanceId)
          .sort((a, b) => a - b);
        assertEquals(scheduled.includes(9), true);
        assertEquals(scheduled.includes(10), false);

        assertEquals(arrSyncQueries.getSyncConfigStatus(9).metadataProfiles.trigger, 'schedule');
        assertEquals(arrSyncQueries.getSyncConfigStatus(10).metadataProfiles.trigger, 'manual');

        assertEquals(arrSyncQueries.getSyncConfigStatus(10).metadataProfiles.syncStatus, 'idle');

        const scheduleTriggerIds = arrSyncQueries.getInstanceIdsForTrigger('schedule');
        assertEquals(scheduleTriggerIds.includes(9), true);
        assertEquals(scheduleTriggerIds.includes(10), false);

        arrSyncQueries.setMetadataProfilesStatusPending(10);
        assertEquals(arrSyncQueries.claimMetadataProfilesSync(10), false);
        assertEquals(getMetadataProfilesStatusRow(10).sync_status, 'idle');

        arrSyncQueries.setMetadataProfilesNextRunAt(9, '2026-02-19T00:00:00.000Z');
        arrSyncQueries.setMetadataProfilesNextRunAt(10, '2026-02-20T00:00:00.000Z');
        assertEquals(getMetadataProfilesStatusRow(9).next_run_at, '2026-02-19T00:00:00.000Z');
        assertEquals(getMetadataProfilesStatusRow(10).next_run_at, '2026-02-18T00:00:00.000Z');

        arrSyncQueries.setMetadataProfilesStatusPending(9);
        assertEquals(getMetadataProfilesStatusRow(9).sync_status, 'pending');
        assertEquals(getMetadataProfilesStatusRow(9).should_sync, 1);

        assertEquals(arrSyncQueries.claimMetadataProfilesSync(9), true);
        assertEquals(arrSyncQueries.claimMetadataProfilesSync(9), false);
        arrSyncQueries.failMetadataProfilesSync(9, 'metadata fail');
        assertEquals(getMetadataProfilesStatusRow(9).sync_status, 'failed');
        assertEquals(getMetadataProfilesStatusRow(10).sync_status, 'idle');
      });
    } finally {
      db.close();
      config.setBasePath(originalBasePath);
      await Deno.remove(tempBasePath, { recursive: true }).catch(() => undefined);
    }
  },
});
