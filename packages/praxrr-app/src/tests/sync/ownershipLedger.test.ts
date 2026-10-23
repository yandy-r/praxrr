import { assertEquals } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { arrManagedEntitiesQueries } from '$db/queries/arrManagedEntities.ts';
import { syncCustomFormats } from '$sync/customFormats/syncer.ts';
import type { PcdCustomFormat } from '$sync/customFormats/transformer.ts';
import { recordConfirmedWrite } from '$sync/ownership/record.ts';
import type { SyncEntityOutcome } from '$sync/types.ts';

function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/ownership-ledger-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });
      db.close();
      config.setBasePath(tempBasePath);
      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

function seedInstance(): number {
  return arrInstancesQueries.create({
    name: `radarr-${crypto.randomUUID()}`,
    type: 'radarr',
    url: 'http://localhost:7878',
    apiKey: 'test-api-key',
  });
}

function outcome(overrides: Partial<SyncEntityOutcome> = {}): SyncEntityOutcome {
  return {
    section: 'qualityProfiles',
    arrType: 'radarr',
    entityType: 'customFormat',
    name: 'HDR10',
    action: 'create',
    status: 'success',
    remoteId: '7',
    reason: null,
    ...overrides,
  };
}

const provenance = { sourceKind: 'pcd' as const, databaseId: 3, arrName: 'HDR10\u200b' };

migratedTest('recordConfirmedWrite: a confirmed create inserts a ledger row', () => {
  const instanceId = seedInstance();
  recordConfirmedWrite(instanceId, outcome(), provenance);

  const rows = arrManagedEntitiesQueries.listForInstance(instanceId);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].entityType, 'customFormat');
  assertEquals(rows[0].remoteId, 7);
  assertEquals(rows[0].arrName, 'HDR10\u200b');
  assertEquals(rows[0].pcdName, 'HDR10');
  assertEquals(rows[0].databaseId, 3);
  assertEquals(rows[0].sourceKind, 'pcd');
});

migratedTest('recordConfirmedWrite: an update without a row inserts nothing', () => {
  const instanceId = seedInstance();
  recordConfirmedWrite(instanceId, outcome({ action: 'update' }), provenance);
  assertEquals(arrManagedEntitiesQueries.listForInstance(instanceId).length, 0);
});

migratedTest('recordConfirmedWrite: an update refreshes last_synced_at and keeps first_synced_at', async () => {
  const instanceId = seedInstance();
  recordConfirmedWrite(instanceId, outcome({ entityType: 'qualityProfile', remoteId: '9' }), provenance);
  const [created] = arrManagedEntitiesQueries.listForInstance(instanceId);
  await new Promise((resolve) => setTimeout(resolve, 5));
  recordConfirmedWrite(instanceId, outcome({ entityType: 'qualityProfile', remoteId: '9', action: 'update' }), {
    ...provenance,
    arrName: 'HDR10 renamed\u200b',
  });

  const rows = arrManagedEntitiesQueries.listForInstance(instanceId);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].firstSyncedAt, created.firstSyncedAt);
  assertEquals(rows[0].arrName, 'HDR10 renamed\u200b');
  assertEquals(rows[0].lastSyncedAt > created.lastSyncedAt, true);
});

migratedTest('recordConfirmedWrite: failed and skipped outcomes record nothing', () => {
  const instanceId = seedInstance();
  recordConfirmedWrite(instanceId, outcome({ status: 'failed', reason: 'x' }), provenance);
  recordConfirmedWrite(instanceId, outcome({ status: 'skipped', reason: 'x', remoteId: null }), provenance);
  recordConfirmedWrite(instanceId, outcome({ remoteId: null }), provenance);
  recordConfirmedWrite(instanceId, outcome({ remoteId: '0' }), provenance);
  assertEquals(arrManagedEntitiesQueries.listForInstance(instanceId).length, 0);
});

migratedTest('recordConfirmedWrite: a negative TRaSH database id is stored positive; zero is ignored', () => {
  const instanceId = seedInstance();
  recordConfirmedWrite(instanceId, outcome(), { sourceKind: 'trash', databaseId: -5, arrName: 'HDR10\u200b' });
  recordConfirmedWrite(instanceId, outcome({ remoteId: '8' }), { sourceKind: 'trash', databaseId: 0, arrName: 'x' });

  const rows = arrManagedEntitiesQueries.listForInstance(instanceId);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].databaseId, 5);
  assertEquals(rows[0].sourceKind, 'trash');
});

migratedTest('recordConfirmedWrite: never throws for an unknown instance', () => {
  recordConfirmedWrite(999_999, outcome(), provenance);
});

migratedTest('syncCustomFormats: a confirmed create writes a ledger row with batch provenance', async () => {
  const instanceId = seedInstance();
  const client = {
    getCustomFormats: () => Promise.resolve([]),
    updateCustomFormat: () => Promise.resolve({}),
    createCustomFormat: (fmt: { name: string }) => {
      if (fmt.name.includes('cf-fail')) throw new Error('boom');
      return Promise.resolve({ id: 42 });
    },
  };
  const pcdFormats = new Map<string, PcdCustomFormat>([
    ['cf-ok', { id: 1, name: 'cf-ok', includeInRename: false, conditions: [] }],
    ['cf-fail', { id: 2, name: 'cf-fail', includeInRename: false, conditions: [] }],
  ]);

  await syncCustomFormats(client as never, instanceId, 'radarr', pcdFormats, '\u200b', {
    sourceKind: 'trash',
    databaseId: -2,
  });

  const rows = arrManagedEntitiesQueries.listForInstance(instanceId);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].remoteId, 42);
  assertEquals(rows[0].pcdName, 'cf-ok');
  assertEquals(rows[0].arrName, 'cf-ok\u200b');
  assertEquals(rows[0].databaseId, 2);
  assertEquals(rows[0].sourceKind, 'trash');
});
