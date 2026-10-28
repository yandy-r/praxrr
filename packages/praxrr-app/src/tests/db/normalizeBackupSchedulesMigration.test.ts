import { assert, assertEquals } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { migration as normalizeBackupSchedulesMigration } from '$db/migrations/20261029_normalize_backup_schedules.ts';
import { loadMigrations, migrationRunner, runMigrations } from '$db/migrations.ts';

/**
 * Point the db singleton at a scratch SQLite file under a fresh temp base path, run the full
 * migration chain, invoke the test body, then tear the connection down. Mirrors
 * boundScheduleIntervalsMigration.test.ts.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/normalize-backup-schedules-${crypto.randomUUID()}`;
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

function storedSchedule(): string | undefined {
  return db.queryFirst<{ schedule: string }>('SELECT schedule FROM backup_settings WHERE id = 1')?.schedule;
}

migratedTest('migration 20261029 is registered immediately after 20261028', () => {
  const migrations = loadMigrations();
  const previousIndex = migrations.findIndex((candidate) => candidate.version === 20261028);
  const normalizeIndex = migrations.findIndex((candidate) => candidate.version === 20261029);

  assert(previousIndex >= 0, 'migration 20261028 should be registered');
  assertEquals(normalizeIndex, previousIndex + 1);
  assertEquals(normalizeBackupSchedulesMigration.version, 20261029);
});

migratedTest('migration 20261029 rewrites legacy every-6/12-hours schedules to cron', async () => {
  // The chain already applied 20261029 during setup, so run the raw up/down statements the
  // way the runner would (they are idempotent single-row UPDATEs against backup_settings).
  db.execute(`UPDATE backup_settings SET schedule = '*/6 hours' WHERE id = 1`);
  db.exec(normalizeBackupSchedulesMigration.up);
  assertEquals(storedSchedule(), '0 */6 * * *');

  db.execute(`UPDATE backup_settings SET schedule = '*/12 hours' WHERE id = 1`);
  db.exec(normalizeBackupSchedulesMigration.up);
  assertEquals(storedSchedule(), '0 */12 * * *');

  db.exec(normalizeBackupSchedulesMigration.down!);
  assertEquals(storedSchedule(), '*/12 hours');
});

migratedTest('migration 20261029 leaves valid schedules untouched and down restores the legacy spelling', async () => {
  for (const valid of ['daily', 'weekly', 'monthly', 'hourly', '0 */6 * * *']) {
    db.execute(`UPDATE backup_settings SET schedule = ? WHERE id = 1`, valid);
    await migrationRunner.up([normalizeBackupSchedulesMigration]);
    assertEquals(storedSchedule(), valid, `${valid} must survive the migration`);
  }

  // Roll back through the real runner: the full chain applied 20261029, so a down() to
  // 20261028 reverts only that step (and its migrations-table record).
  db.execute(`UPDATE backup_settings SET schedule = '0 */6 * * *' WHERE id = 1`);
  await migrationRunner.down([normalizeBackupSchedulesMigration], 20261028);
  assertEquals(storedSchedule(), '*/6 hours');
  assertEquals(migrationRunner.isApplied(20261029), false);
});
