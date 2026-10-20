import { assertEquals, assertRejects, assertThrows } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { DatabaseInstanceValidationError, databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { pcdManager } from '$pcd/index.ts';

const RANGE_ERROR = 'syncStrategy must be an integer between 0 and 525600';

/**
 * Point the db singleton at a scratch SQLite file under a fresh temp base path, run the full
 * migration chain, invoke the test body, then tear the connection down. Mirrors
 * canaryMigration.test.ts.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/database-instances-sync-strategy-${crypto.randomUUID()}`;
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

function createInstance(syncStrategy: number): number {
  return databaseInstancesQueries.create({
    uuid: crypto.randomUUID(),
    name: `db-${crypto.randomUUID()}`,
    repositoryUrl: 'https://example.com/db.git',
    localPath: '/tmp/praxrr-tests/unused',
    syncStrategy,
  });
}

function instanceCount(): number {
  return db.queryFirst<{ count: number }>('SELECT COUNT(*) AS count FROM database_instances')?.count ?? 0;
}

migratedTest('databaseInstancesQueries.create rejects out-of-range syncStrategy without inserting', () => {
  const before = instanceCount();
  for (const syncStrategy of [525_601, 200_000_000_000, -1, Number.NaN]) {
    const error = assertThrows(() => createInstance(syncStrategy), DatabaseInstanceValidationError);
    assertEquals(error.message, RANGE_ERROR);
  }
  assertEquals(instanceCount(), before);

  const id = createInstance(525_600);
  assertEquals(databaseInstancesQueries.getById(id)?.sync_strategy, 525_600);
});

migratedTest('databaseInstancesQueries.update rejects out-of-range syncStrategy and leaves the row unchanged', () => {
  const id = createInstance(60);

  for (const syncStrategy of [525_601, Number.NaN]) {
    const error = assertThrows(
      () => databaseInstancesQueries.update(id, { syncStrategy }),
      DatabaseInstanceValidationError
    );
    assertEquals(error.message, RANGE_ERROR);
  }
  assertEquals(databaseInstancesQueries.getById(id)?.sync_strategy, 60);

  assertEquals(databaseInstancesQueries.update(id, { syncStrategy: 525_600 }), true);
  assertEquals(databaseInstancesQueries.getById(id)?.sync_strategy, 525_600);
});

migratedTest('pcdManager.link rejects out-of-range syncStrategy before cloning or inserting', async () => {
  const before = instanceCount();
  const error = await assertRejects(
    () =>
      pcdManager.link({
        name: 'Huge Interval DB',
        // Unreachable on purpose: validation must fail before any clone is attempted.
        repositoryUrl: 'https://invalid.example.invalid/db.git',
        syncStrategy: 525_601,
      }),
    DatabaseInstanceValidationError
  );
  assertEquals(error.message, RANGE_ERROR);
  assertEquals(instanceCount(), before);
});
