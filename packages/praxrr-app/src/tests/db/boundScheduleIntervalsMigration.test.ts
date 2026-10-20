import { assert, assertEquals, assertExists, assertThrows } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { migration as boundScheduleIntervalsMigration } from '$db/migrations/20261024_bound_schedule_intervals.ts';
import { loadMigrations, runMigrations } from '$db/migrations.ts';

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
      const tempBasePath = `/tmp/praxrr-tests/bound-schedule-intervals-${crypto.randomUUID()}`;
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

function driftIntervalMinutes(): number | undefined {
  return db.queryFirst<{ interval_minutes: number }>('SELECT interval_minutes FROM drift_check_settings WHERE id = 1')
    ?.interval_minutes;
}

migratedTest('migration 20261024 is registered immediately after 20261023', () => {
  const migrations = loadMigrations();
  const previousIndex = migrations.findIndex((candidate) => candidate.version === 20261023);
  const boundIndex = migrations.findIndex((candidate) => candidate.version === 20261024);

  assert(previousIndex >= 0, 'migration 20261023 should be registered');
  assertEquals(boundIndex, previousIndex + 1);
});

migratedTest('drift_check_settings CHECK rejects intervals above the cap and accepts the cap', () => {
  assertThrows(() => db.execute('UPDATE drift_check_settings SET interval_minutes = ? WHERE id = 1', 525_601));
  assertThrows(() => db.execute('UPDATE drift_check_settings SET interval_minutes = ? WHERE id = 1', 4));

  db.execute('UPDATE drift_check_settings SET interval_minutes = ? WHERE id = 1', 525_600);
  assertEquals(driftIntervalMinutes(), 525_600);
});

migratedTest('migration 20261024 up clamps persisted out-of-range intervals', () => {
  const down = boundScheduleIntervalsMigration.down;
  assertExists(down);
  db.exec(down);

  // Pre-fix state: only the >= 5 CHECK exists, so an overflowing interval could be persisted.
  db.execute(
    'UPDATE drift_check_settings SET interval_minutes = ?, enabled = 0, error_count = 2 WHERE id = 1',
    200_000_000_000
  );
  db.execute(
    `INSERT INTO trash_guide_sources (name, repository_url, local_path, arr_type, sync_strategy)
		VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,
    'Huge',
    'https://example.com/a.git',
    '/tmp/a',
    'radarr',
    200_000_000_000,
    'Negative',
    'https://example.com/b.git',
    '/tmp/b',
    'sonarr',
    -10,
    'Normal',
    'https://example.com/c.git',
    '/tmp/c',
    'radarr',
    60
  );
  db.execute(
    `INSERT INTO database_instances (uuid, name, repository_url, local_path, sync_strategy)
		VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,
    'uuid-huge',
    'Huge DB',
    'https://example.com/db.git',
    '/tmp/db-huge',
    200_000_000_000,
    'uuid-normal',
    'Normal DB',
    'https://example.com/db2.git',
    '/tmp/db-normal',
    120
  );

  db.exec(boundScheduleIntervalsMigration.up);

  const drift = db.queryFirst<{ interval_minutes: number; enabled: number; error_count: number }>(
    'SELECT interval_minutes, enabled, error_count FROM drift_check_settings WHERE id = 1'
  );
  assertEquals(drift, { interval_minutes: 525_600, enabled: 0, error_count: 2 });
  assertThrows(() => db.execute('UPDATE drift_check_settings SET interval_minutes = ? WHERE id = 1', 525_601));

  const sources = db.query<{ name: string; sync_strategy: number }>(
    'SELECT name, sync_strategy FROM trash_guide_sources ORDER BY name'
  );
  assertEquals(sources, [
    { name: 'Huge', sync_strategy: 525_600 },
    { name: 'Negative', sync_strategy: 0 },
    { name: 'Normal', sync_strategy: 60 },
  ]);

  const databases = db.query<{ name: string; sync_strategy: number }>(
    "SELECT name, sync_strategy FROM database_instances WHERE uuid IN ('uuid-huge', 'uuid-normal') ORDER BY name"
  );
  assertEquals(databases, [
    { name: 'Huge DB', sync_strategy: 525_600 },
    { name: 'Normal DB', sync_strategy: 120 },
  ]);
});
