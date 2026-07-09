import { assert, assertEquals } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { syncHistoryQueries } from '$db/queries/syncHistory.ts';
import type { SyncHistoryInput, SyncPreviewArrType } from '$sync/syncHistory/types.ts';

/**
 * Point the db singleton at a scratch SQLite file under a fresh temp base path,
 * run the full migration chain (so the sync_history table exists in its real
 * context), invoke the test body, then tear the connection down. Mirrors
 * driftQueries.test.ts verbatim.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/sync-history-retention-${crypto.randomUUID()}`;
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

/** Insert an arr_instances row so sync_history rows carry a valid FK target. */
function seedInstance(type: SyncPreviewArrType): number {
  return arrInstancesQueries.create({
    name: `${type}-${crypto.randomUUID()}`,
    type,
    url: 'http://localhost:7878',
    apiKey: 'test-api-key',
  });
}

function makeInput(instanceId: number, arrType: SyncPreviewArrType, startedAt: string): SyncHistoryInput {
  return {
    arrInstanceId: instanceId,
    instanceName: `${arrType}-instance`,
    arrType,
    jobId: null,
    trigger: 'manual',
    triggerEvent: null,
    sectionsAttempted: [],
    status: 'success',
    sectionsRun: 0,
    itemsSynced: 0,
    failureCount: 0,
    sectionResults: [],
    changes: [],
    error: null,
    startedAt,
    finishedAt: startedAt,
    durationMs: 10,
  };
}

/**
 * Append a row, then force its `started_at` to a controlled ISO instant via a
 * direct UPDATE (the task's prescribed way to age rows into the past).
 */
function seedRowAt(instanceId: number, arrType: SyncPreviewArrType, startedAt: string): number {
  const id = syncHistoryQueries.insert(makeInput(instanceId, arrType, startedAt));
  db.execute('UPDATE sync_history SET started_at = ? WHERE id = ?', startedAt, id);
  return id;
}

function totalRows(): number {
  return syncHistoryQueries.count({});
}

// ---------------------------------------------------------------------------
// pruneOlderThan — age-based retention
// ---------------------------------------------------------------------------

migratedTest('pruneOlderThan deletes only rows older than the cutoff and returns the deleted count', () => {
  // Old rows (radarr) sit well before the cutoff; recent rows (sonarr/lidarr) are
  // near "now". Pruning is per-arr agnostic — assert survivors by arr_type too.
  const radarr = seedInstance('radarr');
  const sonarr = seedInstance('sonarr');
  const lidarr = seedInstance('lidarr');

  const nowIso = new Date().toISOString();
  seedRowAt(radarr, 'radarr', '2020-01-01T00:00:00.000Z');
  seedRowAt(radarr, 'radarr', '2020-02-01T00:00:00.000Z');
  seedRowAt(radarr, 'radarr', '2020-03-01T00:00:00.000Z');
  seedRowAt(sonarr, 'sonarr', nowIso);
  seedRowAt(lidarr, 'lidarr', nowIso);

  assertEquals(totalRows(), 5);

  const deleted = syncHistoryQueries.pruneOlderThan(30);
  assertEquals(deleted, 3);

  // Only the two recent rows survive, and the aged radarr rows are gone.
  assertEquals(totalRows(), 2);
  assertEquals(syncHistoryQueries.count({ arrType: 'radarr' }), 0);
  assertEquals(syncHistoryQueries.count({ arrType: 'sonarr' }), 1);
  assertEquals(syncHistoryQueries.count({ arrType: 'lidarr' }), 1);
});

migratedTest('pruneOlderThan is a no-op when every row is newer than the cutoff', () => {
  const radarr = seedInstance('radarr');
  const sonarr = seedInstance('sonarr');

  const nowIso = new Date().toISOString();
  seedRowAt(radarr, 'radarr', nowIso);
  seedRowAt(sonarr, 'sonarr', nowIso);

  const before = totalRows();
  assertEquals(before, 2);

  assertEquals(syncHistoryQueries.pruneOlderThan(30), 0);
  assertEquals(totalRows(), 2);
});

// ---------------------------------------------------------------------------
// pruneBeyondMaxEntries — count-based retention
// ---------------------------------------------------------------------------

migratedTest('pruneBeyondMaxEntries keeps exactly the newest max rows and deletes the rest', () => {
  const radarr = seedInstance('radarr');

  // Six rows with strictly increasing started_at; the two newest are April/May.
  const ids = [
    seedRowAt(radarr, 'radarr', '2026-01-01T00:00:00.000Z'),
    seedRowAt(radarr, 'radarr', '2026-02-01T00:00:00.000Z'),
    seedRowAt(radarr, 'radarr', '2026-03-01T00:00:00.000Z'),
    seedRowAt(radarr, 'radarr', '2026-04-01T00:00:00.000Z'),
    seedRowAt(radarr, 'radarr', '2026-05-01T00:00:00.000Z'),
    seedRowAt(radarr, 'radarr', '2026-06-01T00:00:00.000Z'),
  ];

  assertEquals(totalRows(), 6);

  const deleted = syncHistoryQueries.pruneBeyondMaxEntries(2);
  assertEquals(deleted, 4);
  assertEquals(totalRows(), 2);

  // The two newest rows (last two inserted) survive; older ids are gone.
  const survivors = syncHistoryQueries.search({}, { limit: 100, offset: 0 }).map((r) => r.id);
  assertEquals(new Set(survivors), new Set([ids[4], ids[5]]));
});

migratedTest('pruneBeyondMaxEntries(0) is a no-op (age-only retention) and deletes nothing', () => {
  const radarr = seedInstance('radarr');

  seedRowAt(radarr, 'radarr', '2026-01-01T00:00:00.000Z');
  seedRowAt(radarr, 'radarr', '2026-02-01T00:00:00.000Z');
  seedRowAt(radarr, 'radarr', '2026-03-01T00:00:00.000Z');

  const before = totalRows();
  assertEquals(before, 3);

  assertEquals(syncHistoryQueries.pruneBeyondMaxEntries(0), 0);
  assertEquals(totalRows(), 3);
});

migratedTest('pruneBeyondMaxEntries is a no-op when row count is at or under the cap', () => {
  const radarr = seedInstance('radarr');

  seedRowAt(radarr, 'radarr', '2026-01-01T00:00:00.000Z');
  seedRowAt(radarr, 'radarr', '2026-02-01T00:00:00.000Z');

  assertEquals(totalRows(), 2);

  // Cap larger than the row count leaves everything intact.
  assertEquals(syncHistoryQueries.pruneBeyondMaxEntries(10), 0);
  assertEquals(totalRows(), 2);
});

// ---------------------------------------------------------------------------
// Combined shrink invariant
// ---------------------------------------------------------------------------

migratedTest('age + count retention together shrink the overall row count', () => {
  const radarr = seedInstance('radarr');
  const sonarr = seedInstance('sonarr');

  const nowIso = new Date().toISOString();
  seedRowAt(radarr, 'radarr', '2019-01-01T00:00:00.000Z');
  seedRowAt(radarr, 'radarr', '2019-06-01T00:00:00.000Z');
  seedRowAt(sonarr, 'sonarr', nowIso);
  seedRowAt(sonarr, 'sonarr', nowIso);
  seedRowAt(sonarr, 'sonarr', nowIso);

  const before = totalRows();
  assertEquals(before, 5);

  const agePruned = syncHistoryQueries.pruneOlderThan(30);
  assertEquals(agePruned, 2);

  const countPruned = syncHistoryQueries.pruneBeyondMaxEntries(1);
  assertEquals(countPruned, 2);

  const after = totalRows();
  assertEquals(after, 1);
  assert(after < before);
});
