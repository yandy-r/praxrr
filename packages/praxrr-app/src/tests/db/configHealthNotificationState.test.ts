import { assert, assertEquals, assertExists, assertThrows } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { configHealthNotificationStateQueries } from '$db/queries/configHealthNotificationState.ts';

const FIRST_CLAIM_AT = '2026-07-10T10:00:00.000Z';
const CHANGED_CLAIM_AT = '2026-07-10T10:05:00.000Z';

/** Run each assertion against a fresh database after the complete registered migration chain. */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/config-health-notification-state-${crypto.randomUUID()}`;
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

function seedInstance(name = 'Config Health State'): number {
  return arrInstancesQueries.create({
    name: `${name}-${crypto.randomUUID()}`,
    type: 'radarr',
    url: 'http://localhost:7878',
    apiKey: 'test-api-key',
  });
}

migratedTest('registered migration creates the Config Health notification state table', () => {
  const columns = db.query<{ name: string; notnull: number; pk: number }>(
    'PRAGMA table_info(config_health_notification_state)'
  );

  assertEquals(
    columns.map((column) => column.name),
    [
      'arr_instance_id',
      'last_snapshot_id',
      'notified_signature',
      'notified_at',
      'notified_snapshot_id',
      'created_at',
      'updated_at',
    ]
  );
  assertEquals(columns.find((column) => column.name === 'arr_instance_id')?.pk, 1);
  assertEquals(columns.find((column) => column.name === 'last_snapshot_id')?.notnull, 1);
  assertEquals(columns.find((column) => column.name === 'notified_signature')?.notnull, 0);
  assertEquals(columns.find((column) => column.name === 'notified_at')?.notnull, 0);
});

migratedTest('migration rejects an empty notification signature at the SQLite boundary', () => {
  const instanceId = seedInstance();

  assertThrows(() =>
    db.execute(
      `INSERT INTO config_health_notification_state (
        arr_instance_id, last_snapshot_id, notified_signature, notified_at, notified_snapshot_id
      ) VALUES (?, ?, ?, ?, ?)`,
      instanceId,
      10,
      '',
      FIRST_CLAIM_AT,
      10
    )
  );
  assertEquals(configHealthNotificationStateQueries.get(instanceId), undefined);
});

migratedTest('first claim inserts state and get returns the diagnostic detail', () => {
  const instanceId = seedInstance();

  assertEquals(configHealthNotificationStateQueries.get(instanceId), undefined);
  assertEquals(configHealthNotificationStateQueries.claim(instanceId, 10, 'signature-a', FIRST_CLAIM_AT), true);

  const state = configHealthNotificationStateQueries.get(instanceId);
  assertExists(state);
  assertEquals(state.arrInstanceId, instanceId);
  assertEquals(state.lastSnapshotId, 10);
  assertEquals(state.notifiedSignature, 'signature-a');
  assertEquals(state.notifiedAt, FIRST_CLAIM_AT);
  assertEquals(state.notifiedSnapshotId, 10);
  assert(state.createdAt.length > 0);
  assert(state.updatedAt.length > 0);
});

migratedTest('claim rejects an empty signature and invalid ISO UTC timestamp before writing', () => {
  const instanceId = seedInstance();

  assertThrows(
    () => configHealthNotificationStateQueries.claim(instanceId, 10, '', FIRST_CLAIM_AT),
    TypeError,
    'signature must not be empty'
  );
  assertThrows(
    () => configHealthNotificationStateQueries.claim(instanceId, 10, 'signature-a', 'not-a-timestamp'),
    TypeError,
    'valid ISO-8601 UTC timestamp'
  );
  assertThrows(
    () => configHealthNotificationStateQueries.claim(instanceId, 10, 'signature-a', '2026-07-10T10:00:00+01:00'),
    TypeError,
    'valid ISO-8601 UTC timestamp'
  );
  assertEquals(configHealthNotificationStateQueries.get(instanceId), undefined);
});

migratedTest('identical newer claim advances the high-water mark without dispatching again', () => {
  const instanceId = seedInstance();
  assertEquals(configHealthNotificationStateQueries.claim(instanceId, 10, 'signature-a', FIRST_CLAIM_AT), true);
  const before = configHealthNotificationStateQueries.get(instanceId);
  assertExists(before);

  assertEquals(configHealthNotificationStateQueries.claim(instanceId, 12, 'signature-a', CHANGED_CLAIM_AT), false);
  const after = configHealthNotificationStateQueries.get(instanceId);
  assertExists(after);
  assertEquals(after.lastSnapshotId, 12);
  assertEquals(after.notifiedSignature, before.notifiedSignature);
  assertEquals(after.notifiedAt, before.notifiedAt);
  assertEquals(after.notifiedSnapshotId, before.notifiedSnapshotId);
  assertEquals(after.createdAt, before.createdAt);
});

migratedTest('changed claim updates signature and timestamps while preserving created_at', () => {
  const instanceId = seedInstance();
  assertEquals(configHealthNotificationStateQueries.claim(instanceId, 10, 'signature-a', FIRST_CLAIM_AT), true);

  db.execute(
    `UPDATE config_health_notification_state
		 SET created_at = '2000-01-01 00:00:00', updated_at = '2000-01-01 00:00:00'
		 WHERE arr_instance_id = ?`,
    instanceId
  );

  assertEquals(configHealthNotificationStateQueries.claim(instanceId, 11, 'signature-b', CHANGED_CLAIM_AT), true);
  const changed = configHealthNotificationStateQueries.get(instanceId);
  assertExists(changed);
  assertEquals(changed.lastSnapshotId, 11);
  assertEquals(changed.notifiedSignature, 'signature-b');
  assertEquals(changed.notifiedAt, CHANGED_CLAIM_AT);
  assertEquals(changed.notifiedSnapshotId, 11);
  assertEquals(changed.createdAt, '2000-01-01 00:00:00');
  assert(changed.updatedAt !== '2000-01-01 00:00:00');
});

migratedTest('overlapping identical claims have exactly one winner', async () => {
  const instanceId = seedInstance();

  const results = await Promise.all([
    Promise.resolve().then(() =>
      configHealthNotificationStateQueries.claim(instanceId, 10, 'signature-a', FIRST_CLAIM_AT)
    ),
    Promise.resolve().then(() =>
      configHealthNotificationStateQueries.claim(instanceId, 10, 'signature-a', FIRST_CLAIM_AT)
    ),
  ]);

  assertEquals(results.filter(Boolean).length, 1);
  assertEquals(configHealthNotificationStateQueries.get(instanceId)?.notifiedSignature, 'signature-a');
});

migratedTest('rearm writes a monotonic nullable-signature tombstone and rejects stale transitions', () => {
  const instanceId = seedInstance();
  configHealthNotificationStateQueries.claim(instanceId, 10, 'signature-a', FIRST_CLAIM_AT);

  assertEquals(configHealthNotificationStateQueries.rearm(instanceId, 12), true);
  const rearmed = configHealthNotificationStateQueries.get(instanceId);
  assertExists(rearmed);
  assertEquals(rearmed.lastSnapshotId, 12);
  assertEquals(rearmed.notifiedSignature, null);
  assertEquals(rearmed.notifiedAt, null);
  assertEquals(rearmed.notifiedSnapshotId, null);

  assertEquals(configHealthNotificationStateQueries.claim(instanceId, 11, 'stale', CHANGED_CLAIM_AT), false);
  assertEquals(configHealthNotificationStateQueries.rearm(instanceId, 11), false);
  assertEquals(configHealthNotificationStateQueries.get(instanceId), rearmed);
});

migratedTest('claim enforces the arr_instances foreign key', () => {
  assertThrows(() => configHealthNotificationStateQueries.claim(999_999, 10, 'signature-a', FIRST_CLAIM_AT));
  assertEquals(configHealthNotificationStateQueries.get(999_999), undefined);
});

migratedTest('deleting an Arr instance cascades its notification state', () => {
  const instanceId = seedInstance();
  configHealthNotificationStateQueries.claim(instanceId, 10, 'signature-a', FIRST_CLAIM_AT);
  assertExists(configHealthNotificationStateQueries.get(instanceId));

  assertEquals(arrInstancesQueries.delete(instanceId), true);
  assertEquals(configHealthNotificationStateQueries.get(instanceId), undefined);
});
