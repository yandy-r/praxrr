import { assert, assertEquals } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { backupSettingsQueries } from '$db/queries/backupSettings.ts';
import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { scheduleBackupJobs } from '$jobs/schedule.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';

/**
 * Real scratch SQLite DB per test with the full migration chain (backup_settings is seeded),
 * mirroring backupLogsEvidence.test.ts. The dispatcher wake is stubbed so upserting a due-now
 * row never fires an actual job run under test.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/backup-schedule-restart-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);

      const originalNotify = jobDispatcher.notifyJobEnqueued;
      jobDispatcher.notifyJobEnqueued = () => {};

      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        jobDispatcher.notifyJobEnqueued = originalNotify;
        jobDispatcher.stop();
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

const SCHEDULE_12H = '0 */12 * * *';

function seedQueuedBackupCreate(
  runAt: string,
  payload: Record<string, unknown>,
  source: 'schedule' | 'manual' = 'schedule'
): void {
  db.execute(
    `INSERT INTO job_queue (job_type, status, run_at, payload, source, dedupe_key)
		 VALUES ('backup.create', 'queued', ?, ?, ?, 'backup.create')`,
    runAt,
    JSON.stringify(payload),
    source
  );
}

function backupCreateRunAt(): string | undefined {
  return jobQueueQueries.getByDedupeKey('backup.create')?.runAt;
}

function enableBackups(schedule: string): void {
  assert(backupSettingsQueries.update({ enabled: true, schedule }));
}

migratedTest('scheduleBackupJobs stores the schedule in the backup.create payload', () => {
  enableBackups(SCHEDULE_12H);

  scheduleBackupJobs();

  const job = jobQueueQueries.getByDedupeKey('backup.create');
  assert(job, 'backup.create slot should exist');
  assertEquals(job.source, 'schedule');
  assertEquals(job.payload?.schedule, SCHEDULE_12H);
});

migratedTest('restart does not postpone a queued overdue backup.create under the same schedule', () => {
  enableBackups(SCHEDULE_12H);
  // Simulate the pre-restart state: an overdue scheduled slot carrying the same schedule.
  const overdue = new Date(Date.now() - 3_600_000).toISOString();
  seedQueuedBackupCreate(overdue, { schedule: SCHEDULE_12H });

  scheduleBackupJobs(); // restart #1
  scheduleBackupJobs(); // restart #2 — must still not move the overdue run_at later

  assertEquals(backupCreateRunAt(), overdue, 'a queued overdue backup must keep its earlier run_at');
});

migratedTest('a schedule change recomputes run_at even when the old slot was earlier', () => {
  enableBackups(SCHEDULE_12H);
  const overdue = new Date(Date.now() - 3_600_000).toISOString();
  seedQueuedBackupCreate(overdue, { schedule: SCHEDULE_12H });

  enableBackups('daily');
  scheduleBackupJobs();

  const runAt = backupCreateRunAt();
  assert(runAt && runAt !== overdue, 'changing the schedule must recompute run_at');
  const next = new Date(runAt!);
  assertEquals(next.getHours(), 0, 'daily schedule must anchor on local midnight');
  assert(next.getTime() > Date.now(), 'recomputed run_at must be in the future');
  assertEquals(jobQueueQueries.getByDedupeKey('backup.create')?.payload?.schedule, 'daily');
});

migratedTest('a pre-upgrade scheduled slot without a payload schedule is not postponed (L1)', () => {
  enableBackups(SCHEDULE_12H);
  const overdue = new Date(Date.now() - 3_600_000).toISOString();
  seedQueuedBackupCreate(overdue, {});

  scheduleBackupJobs(); // first restart after upgrading

  assertEquals(backupCreateRunAt(), overdue, 'a legacy payload-less slot must keep its earlier run_at');
});

migratedTest('a manual-source queued slot is not treated as the scheduled slot', () => {
  enableBackups(SCHEDULE_12H);
  const overdue = new Date(Date.now() - 3_600_000).toISOString();
  seedQueuedBackupCreate(overdue, { schedule: SCHEDULE_12H }, 'manual');

  scheduleBackupJobs();

  const runAt = backupCreateRunAt();
  assert(runAt !== overdue, 'a manual queued row must not pin run_at');
  assert(new Date(runAt!).getTime() > Date.now());
});
