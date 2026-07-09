import { assertEquals, assertExists, assertStringIncludes } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { configHealthSnapshotsQueries } from '$db/queries/configHealthSnapshots.ts';
import { configHealthSettingsQueries } from '$db/queries/configHealthSettings.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';
import type { JobHandler, JobQueueRecord } from '$jobs/queueTypes.ts';
import { CONFIG_HEALTH_ENGINE_VERSION, type HealthArrType, type HealthBand, type HealthReport } from '$shared/health/index.ts';

// Side-effect import registers the 'config-health.cleanup' handler.
import '$jobs/handlers/configHealthCleanup.ts';

/**
 * Point the db singleton at a scratch SQLite file under a fresh temp base path and run the full
 * migration chain (so config_health_snapshots / config_health_settings / arr_instances exist), then
 * tear down. Mirrors syncHistoryCleanup.test.ts.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/config-health-cleanup-${crypto.randomUUID()}`;
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
  const handler = jobQueueRegistry.get('config-health.cleanup');
  assertExists(handler, 'config-health.cleanup handler should be registered');
  return handler;
}

/**
 * Build a `config-health.cleanup` job record. `rescheduleAt` is only emitted when
 * `source === 'schedule'`, so tests flip the source to assert manual vs scheduled recurrence.
 */
function createCleanupJob(overrides: Partial<JobQueueRecord> = {}): JobQueueRecord {
  const now = new Date().toISOString();
  return {
    id: 2200,
    jobType: 'config-health.cleanup',
    status: 'running',
    runAt: now,
    payload: {},
    source: 'schedule',
    dedupeKey: 'config-health.cleanup',
    cooldownUntil: null,
    attempts: 1,
    startedAt: now,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function seedInstance(type: HealthArrType): number {
  return arrInstancesQueries.create({
    name: `${type}-${crypto.randomUUID()}`,
    type,
    url: 'http://127.0.0.1:9',
    apiKey: 'test-api-key',
  });
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function insertSnapshot(instanceId: number, arrType: HealthArrType, generatedAt: string, band: HealthBand): void {
  const report: HealthReport = {
    engineVersion: CONFIG_HEALTH_ENGINE_VERSION,
    instanceId,
    instanceName: `${arrType}-instance`,
    arrType,
    generatedAt,
    overall: { score: 75, band, criteria: [], suggestions: [] },
    profiles: [],
  };
  configHealthSnapshotsQueries.insert(report);
}

// ============================================================================
// Registration
// ============================================================================

Deno.test('config-health.cleanup handler is registered in the queue registry', () => {
  assertExists(jobQueueRegistry.get('config-health.cleanup'), 'config-health.cleanup handler should be registered');
});

// ============================================================================
// Disabled settings -> cancelled (short-circuit before any prune)
// ============================================================================

migratedTest('config-health.cleanup returns cancelled when scoring is disabled', async () => {
  const handler = getHandler();
  const radarr = seedInstance('radarr');
  insertSnapshot(radarr, 'radarr', isoDaysAgo(400), 'needs-review');

  configHealthSettingsQueries.update({ enabled: false });

  const result = await handler(createCleanupJob());
  assertEquals(result.status, 'cancelled');
  assertStringIncludes(result.output!, 'disabled');
  // The aged snapshot survives — disabled short-circuits before pruning.
  assertEquals(configHealthSnapshotsQueries.getTrend(radarr).length, 1);
});

// ============================================================================
// Prunable snapshots -> success; rescheduleAt only on scheduled runs
// ============================================================================

migratedTest('config-health.cleanup prunes aged snapshots and reschedules when scheduled', async () => {
  const handler = getHandler();
  const radarr = seedInstance('radarr');
  insertSnapshot(radarr, 'radarr', isoDaysAgo(400), 'needs-review');
  insertSnapshot(radarr, 'radarr', isoDaysAgo(1), 'healthy');

  const result = await handler(createCleanupJob({ source: 'schedule' }));

  assertEquals(result.status, 'success');
  assertStringIncludes(result.output!, 'age');
  assertExists(result.rescheduleAt, 'scheduled runs must reschedule to recur');

  // Only the recent snapshot survives the default 90-day age window.
  const remaining = configHealthSnapshotsQueries.getTrend(radarr);
  assertEquals(remaining.length, 1);
  assertEquals(remaining[0].band, 'healthy');
});

migratedTest('config-health.cleanup prunes on a manual run but does NOT reschedule', async () => {
  const handler = getHandler();
  const radarr = seedInstance('radarr');
  insertSnapshot(radarr, 'radarr', isoDaysAgo(400), 'needs-review');

  const result = await handler(createCleanupJob({ source: 'manual' }));

  assertEquals(result.status, 'success');
  assertEquals(result.rescheduleAt, undefined, 'manual runs must not self-perpetuate');
  assertEquals(configHealthSnapshotsQueries.getTrend(radarr).length, 0);
});

// ============================================================================
// Nothing to prune -> skipped (still reschedules on a scheduled run)
// ============================================================================

migratedTest('config-health.cleanup returns skipped when there is nothing to prune', async () => {
  const handler = getHandler();
  const radarr = seedInstance('radarr');
  insertSnapshot(radarr, 'radarr', isoDaysAgo(1), 'healthy');

  const result = await handler(createCleanupJob({ source: 'schedule' }));

  assertEquals(result.status, 'skipped');
  assertStringIncludes(result.output!, 'No config health snapshots to prune');
  assertExists(result.rescheduleAt, 'a scheduled skip must still reschedule');
  assertEquals(configHealthSnapshotsQueries.getTrend(radarr).length, 1);
});
