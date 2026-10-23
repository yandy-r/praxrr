import { assertEquals, assertThrows } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { db } from '$db/db.ts';
import { migration } from '$db/migrations/20261025_create_arr_managed_entities.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { arrManagedEntitiesQueries } from '$db/queries/arrManagedEntities.ts';
import type { ArrManagedEntity, ManagedEntityType } from '$db/queries/arrManagedEntities.ts';

function ledgerTest(name: string, fn: () => void): void {
  Deno.test(name, () => {
    const database = new Database(':memory:');
    const originalGetDatabase = db.getDatabase;
    db.getDatabase = () => database;
    try {
      database.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE arr_instances (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL,
          url TEXT NOT NULL,
          external_url TEXT,
          api_key TEXT NOT NULL,
          api_key_fingerprint TEXT,
          tags TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          source TEXT NOT NULL DEFAULT 'ui',
          detected_version TEXT,
          detected_at TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
      `);
      db.exec(migration.up);
      fn();
    } finally {
      db.getDatabase = originalGetDatabase;
      database.close();
    }
  });
}

function createInstance(name = 'Main', type = 'radarr', source: 'ui' | 'env' = 'ui'): number {
  return arrInstancesQueries.create({ name, type, url: 'http://arr:7878', apiKey: '', source });
}

const FIRST_SYNC = '2026-10-25T00:00:00.000Z';
const LAST_SYNC = '2026-10-25T01:00:00.000Z';

function createdRow(instanceId: number, entityType: ManagedEntityType = 'customFormat', remoteId = 7) {
  return {
    instanceId,
    section: 'qualityProfiles' as const,
    entityType,
    remoteId,
    arrName: 'Original\u200b',
    pcdName: 'Original',
    databaseId: 1,
    sourceKind: 'pcd' as const,
    at: FIRST_SYNC,
  };
}

ledgerTest('managed entities: create upsert refreshes provenance and preserves first timestamp', () => {
  const instanceId = createInstance();
  const original = createdRow(instanceId);
  arrManagedEntitiesQueries.recordCreated(original);
  arrManagedEntitiesQueries.recordCreated({
    ...original,
    arrName: 'Replacement\u200b',
    pcdName: 'Replacement',
    databaseId: 2,
    sourceKind: 'trash',
    at: LAST_SYNC,
  });
  const expected: ArrManagedEntity = {
    instanceId,
    section: 'qualityProfiles',
    entityType: 'customFormat',
    remoteId: 7,
    arrName: 'Replacement\u200b',
    pcdName: 'Replacement',
    databaseId: 2,
    sourceKind: 'trash',
    firstSyncedAt: FIRST_SYNC,
    lastSyncedAt: LAST_SYNC,
  };
  assertEquals(arrManagedEntitiesQueries.listForInstance(instanceId), [expected]);
});

ledgerTest('managed entities: touchUpdated never inserts and only refreshes the exact owned row', () => {
  const instanceId = createInstance();
  const otherInstanceId = createInstance('Other');
  arrManagedEntitiesQueries.touchUpdated(instanceId, 'customFormat', 7, 'Foreign', 'Foreign', LAST_SYNC);
  assertEquals(arrManagedEntitiesQueries.listForInstance(instanceId), []);

  arrManagedEntitiesQueries.recordCreated(createdRow(instanceId));
  arrManagedEntitiesQueries.recordCreated(createdRow(instanceId, 'qualityProfile'));
  arrManagedEntitiesQueries.recordCreated(createdRow(otherInstanceId));
  arrManagedEntitiesQueries.touchUpdated(instanceId, 'customFormat', 7, 'Renamed\u200b', 'Renamed', LAST_SYNC);
  const [customFormat, qualityProfile] = arrManagedEntitiesQueries.listForInstance(instanceId);
  assertEquals(customFormat, {
    instanceId,
    section: 'qualityProfiles',
    entityType: 'customFormat',
    remoteId: 7,
    arrName: 'Renamed\u200b',
    pcdName: 'Renamed',
    databaseId: 1,
    sourceKind: 'pcd',
    firstSyncedAt: FIRST_SYNC,
    lastSyncedAt: LAST_SYNC,
  });
  assertEquals(qualityProfile.lastSyncedAt, FIRST_SYNC);
  assertEquals(arrManagedEntitiesQueries.listForInstance(otherInstanceId)[0].lastSyncedAt, FIRST_SYNC);
});

ledgerTest('managed entities: remote ids and confirmed deletion are instance and entity scoped', () => {
  const instanceId = createInstance();
  const otherInstanceId = createInstance('Other');
  arrManagedEntitiesQueries.recordCreated(createdRow(instanceId));
  arrManagedEntitiesQueries.recordCreated(createdRow(instanceId, 'qualityProfile'));
  arrManagedEntitiesQueries.recordCreated(createdRow(instanceId, 'customFormat', 8));
  arrManagedEntitiesQueries.recordCreated(createdRow(otherInstanceId));
  assertEquals(arrManagedEntitiesQueries.listRemoteIds(instanceId, 'customFormat'), new Set([7, 8]));
  assertEquals(arrManagedEntitiesQueries.listRemoteIds(instanceId, 'qualityProfile'), new Set([7]));

  arrManagedEntitiesQueries.deleteConfirmed(instanceId, 'customFormat', 7);
  assertEquals(arrManagedEntitiesQueries.listRemoteIds(instanceId, 'customFormat'), new Set([8]));
  assertEquals(arrManagedEntitiesQueries.listRemoteIds(instanceId, 'qualityProfile'), new Set([7]));
  assertEquals(arrManagedEntitiesQueries.listRemoteIds(otherInstanceId, 'customFormat'), new Set([7]));
  arrManagedEntitiesQueries.clearInstance(instanceId);
  assertEquals(arrManagedEntitiesQueries.listForInstance(instanceId), []);
  assertEquals(arrManagedEntitiesQueries.listForInstance(otherInstanceId).length, 1);
  arrInstancesQueries.delete(otherInstanceId);
  assertEquals(arrManagedEntitiesQueries.listForInstance(otherInstanceId), []);
});

for (const arrType of ['radarr', 'sonarr', 'lidarr']) {
  ledgerTest(`managed entities: ${arrType} URL change clears ownership but unchanged identity keeps it`, () => {
    const instanceId = createInstance('Main', arrType);
    const otherInstanceId = createInstance('Other', arrType);
    assertEquals(arrInstancesQueries.getById(instanceId)?.prune_removed_managed, 0);
    arrManagedEntitiesQueries.recordCreated(createdRow(instanceId));
    arrManagedEntitiesQueries.recordCreated(createdRow(instanceId, 'qualityProfile'));
    arrManagedEntitiesQueries.recordCreated(createdRow(otherInstanceId));

    assertEquals(
      arrInstancesQueries.update(instanceId, {
        url: 'http://arr:7878',
        type: arrType,
        pruneRemovedManaged: true,
        name: 'Renamed instance',
      }),
      true
    );
    assertEquals(arrInstancesQueries.getById(instanceId)?.prune_removed_managed, 1);
    assertEquals(arrManagedEntitiesQueries.listForInstance(instanceId).length, 2);

    assertEquals(arrInstancesQueries.update(instanceId, { url: 'http://replacement:7878' }), true);
    assertEquals(arrManagedEntitiesQueries.listForInstance(instanceId), []);
    assertEquals(arrManagedEntitiesQueries.listForInstance(otherInstanceId).length, 1);
  });
}

ledgerTest('managed entities: type changes clear ownership, including env update paths', () => {
  const instanceId = createInstance('UI');
  arrManagedEntitiesQueries.recordCreated(createdRow(instanceId));
  arrInstancesQueries.update(instanceId, { type: 'sonarr' });
  assertEquals(arrManagedEntitiesQueries.listForInstance(instanceId), []);

  const envInstanceId = createInstance('Env', 'sonarr', 'env');
  arrManagedEntitiesQueries.recordCreated(createdRow(envInstanceId));
  arrInstancesQueries.updateEnvInstanceById(envInstanceId, { type: 'lidarr' });
  assertEquals(arrManagedEntitiesQueries.listForInstance(envInstanceId), []);

  arrInstancesQueries.update(envInstanceId, { apiKeyFingerprint: 'env-fingerprint' });
  arrManagedEntitiesQueries.recordCreated(createdRow(envInstanceId));
  arrInstancesQueries.updateEnvInstanceByApiKey('env-fingerprint', { url: 'http://env-repointed:8686' });
  assertEquals(arrManagedEntitiesQueries.listForInstance(envInstanceId), []);
});

ledgerTest('managed entities: schema rejects invalid ids and rollback drops table and policy column', () => {
  const instanceId = createInstance();
  assertThrows(() => arrManagedEntitiesQueries.recordCreated({ ...createdRow(instanceId), remoteId: 0 }));
  assertThrows(() => arrManagedEntitiesQueries.recordCreated({ ...createdRow(instanceId), databaseId: -1 }));
  assertThrows(() => db.execute('UPDATE arr_instances SET prune_removed_managed = 2 WHERE id = ?', instanceId));
  db.exec(migration.down!);
  assertEquals(
    db
      .query<{ name: string }>('PRAGMA table_info(arr_instances)')
      .some((column) => column.name === 'prune_removed_managed'),
    false
  );
  assertEquals(db.queryFirst('SELECT name FROM sqlite_master WHERE name = ?', 'arr_managed_entities'), undefined);
});
