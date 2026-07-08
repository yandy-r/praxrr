import { assert, assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { detectAndRecordArrVersion } from '$arr/instanceCompatibility.ts';
import { makeSystemStatusMock, makeUnreachableMock } from '../arr/arrVersionFixtures.ts';

/**
 * Point the db singleton at a scratch SQLite file under a fresh temp base path,
 * run the full migration chain (so migration 20260708 executes in its real
 * context), invoke the test body, then tear the connection down. Mirrors the DB
 * bootstrap used by the jobs/setup-wizard suites.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/arr-instance-version-${crypto.randomUUID()}`;
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

function arrInstanceColumns(): string[] {
  return db.query<{ name: string }>('PRAGMA table_info(arr_instances)').map((row) => row.name);
}

migratedTest('migration 20260708 adds detected_version and detected_at columns to arr_instances', () => {
  const columns = arrInstanceColumns();
  assert(columns.includes('detected_version'), 'detected_version column should exist');
  assert(columns.includes('detected_at'), 'detected_at column should exist');
});

migratedTest('running migrations twice is idempotent and does not error', async () => {
  // The helper already ran the chain once; a second pass must be a clean no-op
  // (the migrations table guards each ADD COLUMN from re-executing).
  await runMigrations();

  const columns = arrInstanceColumns();
  assert(columns.includes('detected_version'));
  assert(columns.includes('detected_at'));
});

migratedTest('detected version round-trips through setDetectedVersion and getById', () => {
  const id = arrInstancesQueries.create({
    name: 'Radarr Main',
    type: 'radarr',
    url: 'http://localhost:7878',
    apiKey: 'test-api-key',
  });

  // Freshly created instances have never been detected.
  const created = arrInstancesQueries.getById(id);
  assertExists(created);
  assertEquals(created.detected_version, null);
  assertEquals(created.detected_at, null);

  const detectedAt = '2026-07-08T12:00:00.000Z';
  assertEquals(arrInstancesQueries.setDetectedVersion(id, { version: '5.14.0.9383', detectedAt }), true);

  const updated = arrInstancesQueries.getById(id);
  assertExists(updated);
  assertEquals(updated.detected_version, '5.14.0.9383');
  assertEquals(updated.detected_at, detectedAt);
});

migratedTest('detectAndRecordArrVersion persists a healthy probe and returns a resolved tier', async () => {
  const id = arrInstancesQueries.create({
    name: 'Radarr Detect',
    type: 'radarr',
    url: 'http://localhost:7878',
    apiKey: 'test-api-key',
  });

  const result = await detectAndRecordArrVersion(id, 'radarr', makeSystemStatusMock('5.14.0.9383', 'Radarr'));

  assertExists(result);
  assertEquals(result.arrType, 'radarr');
  assertEquals(result.detectedVersion, '5.14.0.9383');
  assertEquals(result.tier, 'supported');

  const persisted = arrInstancesQueries.getById(id);
  assertExists(persisted);
  assertEquals(persisted.detected_version, '5.14.0.9383');
  assertExists(persisted.detected_at);
});

migratedTest(
  'detectAndRecordArrVersion returns null and preserves the last-known version when unreachable',
  async () => {
    const id = arrInstancesQueries.create({
      name: 'Radarr Offline',
      type: 'radarr',
      url: 'http://localhost:7878',
      apiKey: 'test-api-key',
    });

    // Seed a last-known good version, then simulate a transient outage.
    arrInstancesQueries.setDetectedVersion(id, { version: '5.0.0.0', detectedAt: '2026-07-01T00:00:00.000Z' });

    const result = await detectAndRecordArrVersion(id, 'radarr', makeUnreachableMock());
    assertEquals(result, null);

    // The failed probe must not overwrite the persisted version.
    const persisted = arrInstancesQueries.getById(id);
    assertExists(persisted);
    assertEquals(persisted.detected_version, '5.0.0.0');
    assertEquals(persisted.detected_at, '2026-07-01T00:00:00.000Z');
  }
);
