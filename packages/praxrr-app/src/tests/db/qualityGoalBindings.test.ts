import { assert, assertEquals } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { qualityGoalBindingQueries } from '$db/queries/qualityGoalBindings.ts';

/**
 * Point the db singleton at a scratch SQLite file, run the full migration chain (so migration
 * 20260711 creates quality_goal_bindings in its real context), run the body, tear down.
 * Mirrors driftQueries.test.ts.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/goal-bindings-${crypto.randomUUID()}`;
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
    }
  });
}

/** Seed a database_instances row so quality_goal_bindings has a valid FK target. */
function seedDatabase(): number {
  return databaseInstancesQueries.create({
    uuid: crypto.randomUUID(),
    name: 'Goals Test DB',
    repositoryUrl: 'https://example.invalid/repo.git',
    localPath: '/tmp/goals-test-db-does-not-exist'
  });
}

const WEIGHTS_JSON = JSON.stringify({
  qualityVsSize: 100,
  compatibility: 30,
  hdrPreference: 70,
  unwantedStrictness: 85,
  resolutionCeiling: '2160p'
});

migratedTest('quality_goal_bindings: upsert then get round-trips', () => {
  const databaseId = seedDatabase();
  const row = qualityGoalBindingQueries.upsert({
    databaseId,
    profileName: 'Movies',
    arrType: 'radarr',
    presetId: 'best-quality',
    weightsJson: WEIGHTS_JSON,
    engineVersion: '1',
    appliedAt: '2026-07-09T00:00:00.000Z'
  });
  assertEquals(row.preset_id, 'best-quality');
  assertEquals(row.engine_version, '1');

  const fetched = qualityGoalBindingQueries.get(databaseId, 'Movies', 'radarr');
  assertEquals(fetched?.weights_json, WEIGHTS_JSON);
  assertEquals(fetched?.applied_at, '2026-07-09T00:00:00.000Z');
});

migratedTest('quality_goal_bindings: upsert overwrites on conflict', () => {
  const databaseId = seedDatabase();
  qualityGoalBindingQueries.upsert({
    databaseId,
    profileName: 'Movies',
    arrType: 'radarr',
    presetId: 'best-quality',
    weightsJson: WEIGHTS_JSON,
    engineVersion: '1',
    appliedAt: '2026-07-09T00:00:00.000Z'
  });
  const updated = qualityGoalBindingQueries.upsert({
    databaseId,
    profileName: 'Movies',
    arrType: 'radarr',
    presetId: 'balanced',
    weightsJson: '{}',
    engineVersion: '1',
    appliedAt: '2026-07-09T01:00:00.000Z'
  });
  assertEquals(updated.preset_id, 'balanced');

  // Per-arr key: a sonarr binding on the same profile is independent.
  qualityGoalBindingQueries.upsert({
    databaseId,
    profileName: 'Movies',
    arrType: 'sonarr',
    presetId: 'smallest-size',
    weightsJson: '{}',
    engineVersion: '1',
    appliedAt: '2026-07-09T02:00:00.000Z'
  });
  assertEquals(qualityGoalBindingQueries.get(databaseId, 'Movies', 'radarr')?.preset_id, 'balanced');
  assertEquals(qualityGoalBindingQueries.get(databaseId, 'Movies', 'sonarr')?.preset_id, 'smallest-size');
});

migratedTest('quality_goal_bindings: delete removes the row; missing get returns undefined', () => {
  const databaseId = seedDatabase();
  qualityGoalBindingQueries.upsert({
    databaseId,
    profileName: 'Movies',
    arrType: 'radarr',
    presetId: 'best-quality',
    weightsJson: WEIGHTS_JSON,
    engineVersion: '1',
    appliedAt: '2026-07-09T00:00:00.000Z'
  });
  assert(qualityGoalBindingQueries.delete(databaseId, 'Movies', 'radarr'));
  assertEquals(qualityGoalBindingQueries.get(databaseId, 'Movies', 'radarr'), undefined);
  assert(!qualityGoalBindingQueries.delete(databaseId, 'Movies', 'radarr'));
});

migratedTest('quality_goal_bindings: ON DELETE CASCADE reaps rows with their database instance', () => {
  const databaseId = seedDatabase();
  qualityGoalBindingQueries.upsert({
    databaseId,
    profileName: 'Movies',
    arrType: 'radarr',
    presetId: 'best-quality',
    weightsJson: WEIGHTS_JSON,
    engineVersion: '1',
    appliedAt: '2026-07-09T00:00:00.000Z'
  });
  databaseInstancesQueries.delete(databaseId);
  assertEquals(qualityGoalBindingQueries.get(databaseId, 'Movies', 'radarr'), undefined);
});
