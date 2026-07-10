import { assert, assertEquals, assertExists, assertStringIncludes } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { backupSettingsQueries } from '$db/queries/backupSettings.ts';
import { logSettingsQueries } from '$db/queries/logSettings.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';
import type { JobHandler, JobQueueRecord, JobType } from '$jobs/queueTypes.ts';

// Side-effect imports register the backup/logs handlers under test.
import '$jobs/handlers/backupCreate.ts';
import '$jobs/handlers/backupCleanup.ts';
import '$jobs/handlers/logsCleanup.ts';

// ============================================================================
// DB bootstrap: point the db singleton at a scratch SQLite file under a fresh
// temp base path and run the full migration chain (so backup_settings /
// log_settings exist with their seeded id=1 defaults), then tear down. Mirrors
// syncHistoryCleanup.test.ts. Each case gets an isolated DB + base path so the
// filesystem-driven branches (empty vs. absent backups/logs dir) never collide
// with a sibling run.
// ============================================================================

function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/backup-logs-evidence-${crypto.randomUUID()}`;
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

function getHandler(jobType: JobType): JobHandler {
  const handler = jobQueueRegistry.get(jobType);
  assertExists(handler, `${jobType} handler should be registered`);
  return handler;
}

/**
 * Build a job record for one of the backup/logs cleanup handlers. `source`
 * defaults to `manual`; none of the evidence branches asserted here depend on
 * `rescheduleAt`, which is only emitted on a scheduled run.
 */
function createJob(jobType: JobType, overrides: Partial<JobQueueRecord> = {}): JobQueueRecord {
  const now = new Date().toISOString();
  return {
    id: 3100,
    jobType,
    status: 'running',
    runAt: now,
    payload: {},
    source: 'manual',
    dedupeKey: `${jobType}:global`,
    cooldownUntil: null,
    attempts: 1,
    startedAt: now,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ============================================================================
// Registration
// ============================================================================

Deno.test('backup/logs cleanup handlers are registered in the queue registry', () => {
  assertExists(jobQueueRegistry.get('backup.create'), 'backup.create handler should be registered');
  assertExists(jobQueueRegistry.get('backup.cleanup'), 'backup.cleanup handler should be registered');
  assertExists(jobQueueRegistry.get('logs.cleanup'), 'logs.cleanup handler should be registered');
});

// ============================================================================
// backup.create — settings-driven cancel (createBackup is a non-mockable direct
// import, so only the disabled short-circuit is exercised here).
// ============================================================================

migratedTest('backup.create returns cancelled when backups are disabled', async () => {
  const handler = getHandler('backup.create');

  backupSettingsQueries.update({ enabled: false });

  const result = await handler(createJob('backup.create'));

  assertEquals(result.status, 'cancelled');
  assertStringIncludes(result.decision!, 'Backups disabled');
});

// ============================================================================
// backup.cleanup — cancel (disabled), skip (empty dir), failure (absent dir).
// ============================================================================

migratedTest('backup.cleanup returns cancelled when backups are disabled', async () => {
  const handler = getHandler('backup.cleanup');

  backupSettingsQueries.update({ enabled: false });

  const result = await handler(createJob('backup.cleanup'));

  assertEquals(result.status, 'cancelled');
  assertStringIncludes(result.decision!, 'Backups disabled');
});

migratedTest('backup.cleanup returns skipped when the backups dir is empty', async () => {
  const handler = getHandler('backup.cleanup');

  backupSettingsQueries.update({ enabled: true });
  // An empty but readable backups dir: readDir yields nothing -> deletedCount 0.
  await Deno.mkdir(config.paths.backups, { recursive: true });

  const result = await handler(createJob('backup.cleanup'));

  assertEquals(result.status, 'skipped');
  assertStringIncludes(result.decision!, 'No old backups');
});

migratedTest('backup.cleanup fails with failureCode filesystem when the backups dir is missing', async () => {
  const handler = getHandler('backup.cleanup');

  backupSettingsQueries.update({ enabled: true });
  // Guarantee the backups dir does not exist so Deno.readDir throws (ENOENT),
  // exercising the handler's readDir catch -> typed filesystem failure.
  await Deno.remove(config.paths.backups, { recursive: true }).catch(() => {});

  const result = await handler(createJob('backup.cleanup'));

  assertEquals(result.status, 'failure');
  // Union is discriminated by status; narrow before reading failureCode.
  assert(result.status === 'failure');
  assertEquals(result.failureCode, 'filesystem');
});

// ============================================================================
// logs.cleanup — cancel (file logging disabled), skip (empty dir).
// (cleanupLogs is a non-mockable direct import; the readDir-throws failure path
// is already covered structurally by backup.cleanup above.)
// ============================================================================

migratedTest('logs.cleanup returns cancelled when file logging is disabled', async () => {
  const handler = getHandler('logs.cleanup');

  logSettingsQueries.update({ fileLogging: false });

  const result = await handler(createJob('logs.cleanup'));

  assertEquals(result.status, 'cancelled');
  assertStringIncludes(result.decision!, 'File logging disabled');
});

migratedTest('logs.cleanup returns skipped when the logs dir has no aged log files', async () => {
  const handler = getHandler('logs.cleanup');

  logSettingsQueries.update({ fileLogging: true });
  // A readable logs dir with no aged YYYY-MM-DD.log entries -> deletedCount 0.
  await Deno.mkdir(config.paths.logs, { recursive: true });

  const result = await handler(createJob('logs.cleanup'));

  assertEquals(result.status, 'skipped');
  assertStringIncludes(result.decision!, 'No old log files');
});
