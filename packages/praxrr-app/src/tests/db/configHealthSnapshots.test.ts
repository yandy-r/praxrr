import { assertEquals } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { configHealthSnapshotsQueries } from '$db/queries/configHealthSnapshots.ts';
import { CONFIG_HEALTH_ENGINE_VERSION, type HealthArrType, type HealthBand, type HealthReport } from '$shared/health/index.ts';

/**
 * Point the db singleton at a scratch SQLite file under a fresh temp base path, run the full
 * migration chain (so config_health_snapshots exists with its FK + CHECK constraints in real
 * context), invoke the body, then tear the connection down. Mirrors syncHistoryRetention.test.ts.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/config-health-snapshots-${crypto.randomUUID()}`;
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

/** Create an arr_instances row so config_health_snapshots.arr_instance_id has a valid FK target. */
function seedInstance(type: HealthArrType): number {
  return arrInstancesQueries.create({
    name: `${type}-${crypto.randomUUID()}`,
    type,
    url: 'http://127.0.0.1:9',
    apiKey: 'test-api-key',
  });
}

/** ISO-8601 UTC instant `days` before now, to exercise the datetime()-wrapped age windows. */
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Build a minimal, valid HealthReport for one instance at a controlled `generatedAt`. */
function makeReport(
  instanceId: number,
  arrType: HealthArrType,
  generatedAt: string,
  score: number,
  band: HealthBand
): HealthReport {
  return {
    engineVersion: CONFIG_HEALTH_ENGINE_VERSION,
    instanceId,
    instanceName: `${arrType}-instance`,
    arrType,
    generatedAt,
    overall: { score, band, criteria: [], suggestions: [] },
    profiles: [{ name: 'HD', score, band, criteria: [], suggestions: [] }],
  };
}

// ---------------------------------------------------------------------------
// getTrend — ordering + days bound
// ---------------------------------------------------------------------------

migratedTest('getTrend returns snapshots oldest -> newest regardless of insert order', () => {
  const radarr = seedInstance('radarr');
  const tOld = isoDaysAgo(10);
  const tMid = isoDaysAgo(5);
  const tNew = isoDaysAgo(1);

  // Insert scrambled; getTrend must reorder ascending by generated_at.
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', tMid, 60, 'attention'));
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', tNew, 90, 'healthy'));
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', tOld, 40, 'needs-review'));

  const trend = configHealthSnapshotsQueries.getTrend(radarr);
  assertEquals(trend.length, 3);
  assertEquals(
    trend.map((s) => s.generatedAt),
    [tOld, tMid, tNew]
  );
  assertEquals(
    trend.map((s) => s.overallScore),
    [40, 60, 90]
  );
  // Parsed profile blob round-trips.
  assertEquals(trend[0].profileScores, [{ name: 'HD', score: 40, band: 'needs-review' }]);
});

migratedTest('getTrend(days) excludes snapshots older than the window', () => {
  const radarr = seedInstance('radarr');
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', isoDaysAgo(10), 40, 'needs-review'));
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', isoDaysAgo(5), 60, 'attention'));
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', isoDaysAgo(1), 90, 'healthy'));

  const bounded = configHealthSnapshotsQueries.getTrend(radarr, 7);
  assertEquals(bounded.length, 2, 'the 10-day-old snapshot falls outside a 7-day window');
  assertEquals(
    bounded.map((s) => s.overallScore),
    [60, 90]
  );

  // No bound returns the full series.
  assertEquals(configHealthSnapshotsQueries.getTrend(radarr).length, 3);
});

migratedTest('getTrend is scoped to one instance', () => {
  const radarr = seedInstance('radarr');
  const sonarr = seedInstance('sonarr');
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', isoDaysAgo(2), 80, 'healthy'));
  configHealthSnapshotsQueries.insert(makeReport(sonarr, 'sonarr', isoDaysAgo(2), 30, 'needs-review'));

  const radarrTrend = configHealthSnapshotsQueries.getTrend(radarr);
  assertEquals(radarrTrend.length, 1);
  assertEquals(radarrTrend[0].arrType, 'radarr');
  assertEquals(radarrTrend[0].arrInstanceId, radarr);
});

// ---------------------------------------------------------------------------
// pruneOlderThan — age retention
// ---------------------------------------------------------------------------

migratedTest('pruneOlderThan deletes only snapshots older than the cutoff', () => {
  const radarr = seedInstance('radarr');
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', isoDaysAgo(400), 40, 'needs-review'));
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', isoDaysAgo(1), 90, 'healthy'));

  const deleted = configHealthSnapshotsQueries.pruneOlderThan(30);
  assertEquals(deleted, 1);

  const remaining = configHealthSnapshotsQueries.getTrend(radarr);
  assertEquals(remaining.length, 1);
  assertEquals(remaining[0].overallScore, 90);
});

// ---------------------------------------------------------------------------
// pruneBeyondMaxEntries — count retention
// ---------------------------------------------------------------------------

migratedTest('pruneBeyondMaxEntries keeps exactly the newest max snapshots', () => {
  const radarr = seedInstance('radarr');
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', isoDaysAgo(3), 40, 'needs-review'));
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', isoDaysAgo(2), 60, 'attention'));
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', isoDaysAgo(1), 90, 'healthy'));

  const deleted = configHealthSnapshotsQueries.pruneBeyondMaxEntries(2);
  assertEquals(deleted, 1, 'the single oldest of three snapshots is dropped');

  const remaining = configHealthSnapshotsQueries.getTrend(radarr);
  assertEquals(
    remaining.map((s) => s.overallScore),
    [60, 90],
    'the two newest survive, still oldest -> newest'
  );
});

migratedTest('pruneBeyondMaxEntries(0) is a no-op (age-only retention)', () => {
  const radarr = seedInstance('radarr');
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', isoDaysAgo(2), 60, 'attention'));
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', isoDaysAgo(1), 90, 'healthy'));

  assertEquals(configHealthSnapshotsQueries.pruneBeyondMaxEntries(0), 0);
  assertEquals(configHealthSnapshotsQueries.getTrend(radarr).length, 2);
});
