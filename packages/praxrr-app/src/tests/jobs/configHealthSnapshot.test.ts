import { assertEquals, assertExists, assertStringIncludes } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { configHealthSettingsQueries } from '$db/queries/configHealthSettings.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';
import type { JobHandler, JobQueueRecord } from '$jobs/queueTypes.ts';

// Side-effect import registers the 'config-health.snapshot' handler.
import '$jobs/handlers/configHealthSnapshot.ts';

/**
 * Point the db singleton at a scratch SQLite file under a fresh temp base path and run the full
 * migration chain (so config_health_settings / arr_instances exist), then tear down. Mirrors
 * syncHistoryCleanup.test.ts.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/config-health-snapshot-${crypto.randomUUID()}`;
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

function getHandler(): JobHandler {
  const handler = jobQueueRegistry.get('config-health.snapshot');
  assertExists(handler, 'config-health.snapshot handler should be registered');
  return handler;
}

/** Build a `config-health.snapshot` job record; source drives scheduled vs manual recurrence. */
function createSnapshotJob(overrides: Partial<JobQueueRecord> = {}): JobQueueRecord {
  const now = new Date().toISOString();
  return {
    id: 2100,
    jobType: 'config-health.snapshot',
    status: 'running',
    runAt: now,
    payload: {},
    source: 'schedule',
    dedupeKey: 'config-health.snapshot',
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

Deno.test('config-health.snapshot handler is registered in the queue registry', () => {
  assertExists(jobQueueRegistry.get('config-health.snapshot'), 'config-health.snapshot handler should be registered');
});

// ============================================================================
// No sync-capable instances -> skipped
// ============================================================================

migratedTest('config-health.snapshot returns skipped and reschedules when scheduled with no instances', async () => {
  const handler = getHandler();

  const result = await handler(createSnapshotJob({ source: 'schedule' }));

  assertEquals(result.status, 'skipped');
  assertStringIncludes(result.output!, 'No sync-capable instances');
  assertExists(result.rescheduleAt, 'a scheduled sweep must reschedule even with nothing to snapshot');

  // A scheduled empty sweep is recorded as a completed run.
  assertExists(configHealthSettingsQueries.get().last_run_at);
});

migratedTest('config-health.snapshot returns skipped without rescheduling on a manual run with no instances', async () => {
  const handler = getHandler();

  const result = await handler(createSnapshotJob({ source: 'manual' }));

  assertEquals(result.status, 'skipped');
  assertEquals(result.rescheduleAt, undefined, 'manual runs must not self-perpetuate');
});

// ============================================================================
// Disabled settings -> cancelled
// ============================================================================

migratedTest('config-health.snapshot returns cancelled when scoring is disabled', async () => {
  const handler = getHandler();
  configHealthSettingsQueries.update({ enabled: false });

  const result = await handler(createSnapshotJob({ source: 'schedule' }));
  assertEquals(result.status, 'cancelled');
  assertStringIncludes(result.output!, 'disabled');
});
