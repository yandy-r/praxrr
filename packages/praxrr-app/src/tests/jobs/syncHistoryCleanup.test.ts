import { assertEquals, assertExists, assertStringIncludes } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { syncHistoryQueries } from '$db/queries/syncHistory.ts';
import { syncHistorySettingsQueries } from '$db/queries/syncHistorySettings.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';
import type { JobHandler, JobQueueRecord } from '$jobs/queueTypes.ts';
import type { SyncPreviewArrType } from '$sync/syncHistory/types.ts';

// Side-effect import registers the 'sync.history.cleanup' handler.
import '$jobs/handlers/syncHistoryCleanup.ts';

// ============================================================================
// DB bootstrap: point the db singleton at a scratch SQLite file under a fresh
// temp base path and run the full migration chain (so sync_history /
// sync_history_settings / arr_instances all exist), then tear down. Mirrors the
// driftCheck suite's migratedTest helper.
// ============================================================================

function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/sync-history-cleanup-${crypto.randomUUID()}`;
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
  const handler = jobQueueRegistry.get('sync.history.cleanup');
  assertExists(handler, 'sync.history.cleanup handler should be registered');
  return handler;
}

/**
 * Build a `sync.history.cleanup` job record. `rescheduleAt` is only emitted when
 * `source === 'schedule'` (the recurring dispatcher), so tests flip the source to
 * assert manual vs scheduled recurrence.
 */
function createCleanupJob(overrides: Partial<JobQueueRecord> = {}): JobQueueRecord {
  const now = new Date().toISOString();
  return {
    id: 1700,
    jobType: 'sync.history.cleanup',
    status: 'running',
    runAt: now,
    payload: {},
    source: 'schedule',
    dedupeKey: 'sync.history.cleanup:global',
    cooldownUntil: null,
    attempts: 1,
    startedAt: now,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Create an enabled instance of the given Arr type; returns its id. */
function seedInstance(type: SyncPreviewArrType): number {
  return arrInstancesQueries.create({
    name: `Sync History ${type} ${crypto.randomUUID()}`,
    type,
    url: 'http://127.0.0.1:1',
    apiKey: `sh-key-${crypto.randomUUID()}`,
  });
}

/** Append one sync_history row for the given instance/arr_type at `startedAt`. */
function insertRow(arrInstanceId: number, arrType: SyncPreviewArrType, startedAt: string): void {
  syncHistoryQueries.insert({
    arrInstanceId,
    instanceName: `${arrType}-run`,
    arrType,
    jobId: null,
    trigger: 'schedule',
    triggerEvent: null,
    sectionsAttempted: ['qualityProfiles'],
    status: 'success',
    sectionsRun: 1,
    itemsSynced: 1,
    failureCount: 0,
    sectionResults: [],
    changes: [],
    error: null,
    startedAt,
    finishedAt: startedAt,
    durationMs: 10,
  });
}

const ANCIENT = '2000-01-01T00:00:00.000Z';

// ============================================================================
// Registration
// ============================================================================

Deno.test('sync.history.cleanup handler is registered in the queue registry', () => {
  const handler = jobQueueRegistry.get('sync.history.cleanup');
  assertExists(handler, 'sync.history.cleanup handler should be registered');
});

// ============================================================================
// Disabled settings -> cancelled (short-circuit before any prune)
// ============================================================================

migratedTest('sync.history.cleanup returns cancelled when history recording is disabled', async () => {
  const handler = getHandler();

  // Prunable rows across every Arr type; the disabled short-circuit must leave them intact.
  insertRow(seedInstance('radarr'), 'radarr', ANCIENT);
  insertRow(seedInstance('sonarr'), 'sonarr', ANCIENT);
  insertRow(seedInstance('lidarr'), 'lidarr', ANCIENT);

  syncHistorySettingsQueries.update({ enabled: false });

  const result = await handler(createCleanupJob());

  assertEquals(result.status, 'cancelled');
  assertStringIncludes(result.output!, 'disabled');
  // Disabled short-circuits before any pruning — every row survives, per Arr type.
  assertEquals(syncHistoryQueries.count({ arrType: 'radarr' }), 1);
  assertEquals(syncHistoryQueries.count({ arrType: 'sonarr' }), 1);
  assertEquals(syncHistoryQueries.count({ arrType: 'lidarr' }), 1);
});

// ============================================================================
// Prunable rows -> success; rescheduleAt only on scheduled runs
// ============================================================================

migratedTest('sync.history.cleanup prunes aged rows across Arr types and reschedules when scheduled', async () => {
  const handler = getHandler();

  const radarrId = seedInstance('radarr');
  const sonarrId = seedInstance('sonarr');
  const lidarrId = seedInstance('lidarr');
  insertRow(radarrId, 'radarr', ANCIENT);
  insertRow(sonarrId, 'sonarr', ANCIENT);
  insertRow(lidarrId, 'lidarr', ANCIENT);

  const result = await handler(createCleanupJob({ source: 'schedule' }));

  assertEquals(result.status, 'success');
  assertExists(result.output);
  assertStringIncludes(result.output!, 'age');
  // A scheduled run self-perpetuates: rescheduleAt is present.
  assertExists(result.rescheduleAt, 'scheduled runs must reschedule to recur');

  // Every aged row is gone — verified per Arr type (no cross-Arr parity assumed).
  assertEquals(syncHistoryQueries.count({ arrType: 'radarr' }), 0);
  assertEquals(syncHistoryQueries.count({ arrType: 'sonarr' }), 0);
  assertEquals(syncHistoryQueries.count({ arrType: 'lidarr' }), 0);
});

migratedTest('sync.history.cleanup prunes on a manual run but does NOT reschedule', async () => {
  const handler = getHandler();

  insertRow(seedInstance('radarr'), 'radarr', ANCIENT);
  insertRow(seedInstance('sonarr'), 'sonarr', ANCIENT);

  const result = await handler(createCleanupJob({ source: 'manual' }));

  assertEquals(result.status, 'success');
  // A manual "Run now" must not self-perpetuate.
  assertEquals(result.rescheduleAt, undefined, 'manual runs must not reschedule');

  assertEquals(syncHistoryQueries.count({ arrType: 'radarr' }), 0);
  assertEquals(syncHistoryQueries.count({ arrType: 'sonarr' }), 0);
});

// ============================================================================
// Nothing to prune -> skipped
// ============================================================================

migratedTest('sync.history.cleanup returns skipped when there is nothing to prune', async () => {
  const handler = getHandler();

  // Fresh rows well inside the default 90-day age window and under the max cap.
  const now = new Date().toISOString();
  insertRow(seedInstance('radarr'), 'radarr', now);
  insertRow(seedInstance('sonarr'), 'sonarr', now);
  insertRow(seedInstance('lidarr'), 'lidarr', now);

  const result = await handler(createCleanupJob({ source: 'schedule' }));

  assertEquals(result.status, 'skipped');
  assertStringIncludes(result.output!, 'No sync history rows to prune');
  // Skipped still reschedules on a scheduled run so retention keeps recurring.
  assertExists(result.rescheduleAt, 'a scheduled skip must still reschedule');

  // Nothing was deleted — every recent row remains, per Arr type.
  assertEquals(syncHistoryQueries.count({ arrType: 'radarr' }), 1);
  assertEquals(syncHistoryQueries.count({ arrType: 'sonarr' }), 1);
  assertEquals(syncHistoryQueries.count({ arrType: 'lidarr' }), 1);
});
