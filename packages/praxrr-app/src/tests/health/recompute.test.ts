import { assert, assertEquals } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { configHealthSnapshotsQueries } from '$db/queries/configHealthSnapshots.ts';
import { CONFIG_HEALTH_ENGINE_VERSION, type HealthArrType, type HealthBand, type HealthReport } from '$shared/health/index.ts';
import { recomputeAndPersistInstance } from '$lib/server/health/recompute.ts';
import {
  CONFIG_HEALTH_RECOMPUTE_RATE_LIMIT_MAX_REQUESTS,
  CONFIG_HEALTH_RECOMPUTE_RATE_LIMIT_WINDOW_MS,
  registerConfigHealthRecomputeAttempt,
  resetConfigHealthRecomputeRateLimitForTests,
} from '$lib/server/health/recomputeLimits.ts';

/**
 * Point the db singleton at a scratch SQLite file under a fresh temp base path, run the full
 * migration chain (so arr_instances + config_health_snapshots exist with real FK/CHECK context),
 * invoke the body, then tear down. Mirrors configHealthSnapshots.test.ts.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/config-health-recompute-${crypto.randomUUID()}`;
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

function seedInstance(type: HealthArrType): number {
  return arrInstancesQueries.create({
    name: `${type}-${crypto.randomUUID()}`,
    type,
    url: 'http://127.0.0.1:9',
    apiKey: 'test-api-key',
  });
}

/** A minimal, valid HealthReport for one instance. */
function makeReport(instanceId: number, arrType: HealthArrType, score: number, band: HealthBand): HealthReport {
  return {
    engineVersion: CONFIG_HEALTH_ENGINE_VERSION,
    instanceId,
    instanceName: `${arrType}-instance`,
    arrType,
    generatedAt: new Date().toISOString(),
    overall: { score, band, criteria: [], suggestions: [] },
    profiles: [{ name: 'HD', score, band, criteria: [], suggestions: [] }],
  };
}

// ============================================================================
// recomputeAndPersistInstance -- the shared score+persist path
// ============================================================================

migratedTest('recomputeAndPersistInstance: ok persists exactly one snapshot and returns the report', async () => {
  const id = seedInstance('radarr');
  const instance = arrInstancesQueries.getById(id)!;
  const report = makeReport(id, 'radarr', 80, 'healthy');

  const outcome = await recomputeAndPersistInstance(instance, { scoreInstance: () => Promise.resolve(report) });

  assertEquals(outcome.kind, 'ok');
  assert(outcome.kind === 'ok' && outcome.report.overall.score === 80);
  assertEquals(configHealthSnapshotsQueries.getTrend(id).length, 1);
});

migratedTest('recomputeAndPersistInstance: a degraded (unknown-band) report is still ok and persisted, not an error', async () => {
  const id = seedInstance('sonarr');
  const instance = arrInstancesQueries.getById(id)!;
  const degraded = makeReport(id, 'sonarr', 0, 'unknown');

  const outcome = await recomputeAndPersistInstance(instance, { scoreInstance: () => Promise.resolve(degraded) });

  assertEquals(outcome.kind, 'ok');
  assertEquals(configHealthSnapshotsQueries.getTrend(id).length, 1);
});

migratedTest('recomputeAndPersistInstance: skipped persists nothing when the scorer yields null', async () => {
  const id = seedInstance('radarr');
  const instance = arrInstancesQueries.getById(id)!;

  const outcome = await recomputeAndPersistInstance(instance, { scoreInstance: () => Promise.resolve(null) });

  assertEquals(outcome.kind, 'skipped');
  assertEquals(configHealthSnapshotsQueries.getTrend(id).length, 0);
});

migratedTest('recomputeAndPersistInstance: never throws and returns error when scoring throws', async () => {
  const id = seedInstance('radarr');
  const instance = arrInstancesQueries.getById(id)!;

  const outcome = await recomputeAndPersistInstance(instance, {
    scoreInstance: () => Promise.reject(new Error('boom')),
  });

  assertEquals(outcome.kind, 'error');
  assertEquals(configHealthSnapshotsQueries.getTrend(id).length, 0);
});

migratedTest('recomputeAndPersistInstance: a concurrent recompute for the same instance returns in_flight', async () => {
  const id = seedInstance('radarr');
  const instance = arrInstancesQueries.getById(id)!;
  const report = makeReport(id, 'radarr', 70, 'attention');

  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const gatedScorer = async () => {
    await gate;
    return report;
  };

  // The first call registers the instance in the in-flight set synchronously (before awaiting the
  // gate), so a second call while it is pending is rejected as in_flight.
  const first = recomputeAndPersistInstance(instance, { scoreInstance: gatedScorer });
  const second = await recomputeAndPersistInstance(instance, { scoreInstance: gatedScorer });
  assertEquals(second.kind, 'in_flight');

  release();
  const firstOutcome = await first;
  assertEquals(firstOutcome.kind, 'ok');
  // Only the first (non-skipped) recompute persisted a point.
  assertEquals(configHealthSnapshotsQueries.getTrend(id).length, 1);
});

// ============================================================================
// registerConfigHealthRecomputeAttempt -- per-instance sliding-window limiter
// ============================================================================

Deno.test('registerConfigHealthRecomputeAttempt: allows up to the max, then throttles within the window', () => {
  resetConfigHealthRecomputeRateLimitForTests();
  const id = 4242;
  const now = 1_000_000;
  for (let i = 0; i < CONFIG_HEALTH_RECOMPUTE_RATE_LIMIT_MAX_REQUESTS; i++) {
    assert(registerConfigHealthRecomputeAttempt(id, now), `attempt ${i + 1} should be allowed`);
  }
  assert(!registerConfigHealthRecomputeAttempt(id, now), 'the request over the cap must be throttled');
  resetConfigHealthRecomputeRateLimitForTests();
});

Deno.test('registerConfigHealthRecomputeAttempt: a fresh window after expiry allows again', () => {
  resetConfigHealthRecomputeRateLimitForTests();
  const id = 4243;
  const t0 = 2_000_000;
  for (let i = 0; i < CONFIG_HEALTH_RECOMPUTE_RATE_LIMIT_MAX_REQUESTS; i++) {
    registerConfigHealthRecomputeAttempt(id, t0);
  }
  assert(!registerConfigHealthRecomputeAttempt(id, t0), 'throttled inside the window');
  assert(
    registerConfigHealthRecomputeAttempt(id, t0 + CONFIG_HEALTH_RECOMPUTE_RATE_LIMIT_WINDOW_MS + 1),
    'a fully elapsed window frees the allowance'
  );
  resetConfigHealthRecomputeRateLimitForTests();
});

Deno.test('registerConfigHealthRecomputeAttempt: windows are keyed per instance', () => {
  resetConfigHealthRecomputeRateLimitForTests();
  const now = 3_000_000;
  for (let i = 0; i < CONFIG_HEALTH_RECOMPUTE_RATE_LIMIT_MAX_REQUESTS; i++) {
    registerConfigHealthRecomputeAttempt(1, now);
  }
  assert(!registerConfigHealthRecomputeAttempt(1, now), 'instance 1 is throttled');
  assert(registerConfigHealthRecomputeAttempt(2, now), 'instance 2 has its own window');
  resetConfigHealthRecomputeRateLimitForTests();
});
