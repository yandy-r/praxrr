// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

/**
 * Route tests for /api/v1/goals/{presets,preview,binding} and the apply validation surface.
 *
 * Preview reuses the real impact-simulator sandbox path (ephemeral PCDCache via a
 * `PCDCache.prototype.buildReadOnly` patch, mirroring impactSimulatorRoute.test.ts) — no parser is
 * involved because goals score custom formats, not releases. The binding endpoint is exercised
 * against a real migrated app DB (migratedTest, mirroring driftQueries.test.ts). Apply's persistence
 * rides the pre-existing, separately-tested `updateScoring` op path; here we cover its validation.
 */

import { assert, assertEquals, assertRejects } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';

import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { qualityGoalBindingQueries } from '$db/queries/qualityGoalBindings.ts';
import type { PCDCache } from '$pcd/index.ts';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import type { DatabaseInstance } from '$db/queries/databaseInstances.ts';
import type { components } from '$api/v1.d.ts';

const { setCache, deleteCache } = await import('$pcd/database/registry.ts');
const { PCDCache: PCDCacheClass } = await import('$pcd/index.ts');
const presetsRoute = await import('../../routes/api/v1/goals/presets/+server.ts');
const previewRoute = await import('../../routes/api/v1/goals/preview/+server.ts');
const applyRoute = await import('../../routes/api/v1/goals/apply/+server.ts');
const bindingRoute = await import('../../routes/api/v1/goals/binding/+server.ts');

type GoalPresetsResponse = components['schemas']['GoalPresetsResponse'];
type GoalPreviewResponse = components['schemas']['GoalPreviewResponse'];
type GoalBindingResponse = components['schemas']['GoalBindingResponse'];

const PCD_SCHEMA_SQL_PATH = new URL('../../../../praxrr-schema/ops/0.schema.sql', import.meta.url);
const PCD_SCHEMA_SQL = Deno.readTextFileSync(PCD_SCHEMA_SQL_PATH);

const DATABASE_ID = 820002;

const SEED_SQL = `
  INSERT INTO tags (name) VALUES ('Banned'), ('HDR'), ('Colour Grade'), ('Audio'), ('Source'), ('Codec');

  INSERT INTO custom_formats (name) VALUES
    ('Dolby Vision'), ('HDR10'), ('2160p Remux'), ('TrueHD'), ('Banned Groups'), ('x265 (Bluray)');

  INSERT INTO custom_format_tags (custom_format_name, tag_name) VALUES
    ('Dolby Vision', 'Colour Grade'), ('Dolby Vision', 'HDR'),
    ('HDR10', 'Colour Grade'), ('HDR10', 'HDR'),
    ('2160p Remux', 'Source'),
    ('TrueHD', 'Audio'),
    ('Banned Groups', 'Banned'),
    ('x265 (Bluray)', 'Codec');

  INSERT INTO quality_profiles (id, name, minimum_custom_format_score, upgrade_until_score, upgrade_score_increment)
  VALUES (1, 'Movies', 0, 100, 1);
`;

const BEST_QUALITY_WEIGHTS = {
  qualityVsSize: 100,
  compatibility: 30,
  hdrPreference: 70,
  unwantedStrictness: 85,
  resolutionCeiling: '2160p'
};

type Restore = () => void;

function patchTarget<T extends object, K extends keyof T>(target: T, key: K, replacement: T[K], restores: Restore[]): void {
  const original = target[key];
  target[key] = replacement;
  restores.push(() => {
    target[key] = original;
  });
}

function buildInstance(): DatabaseInstance {
  return {
    id: DATABASE_ID,
    uuid: 'goals-route-test-uuid',
    name: 'Goals Route Test DB',
    repository_url: 'https://example.invalid/repo.git',
    local_path: '/tmp/goals-route-does-not-exist',
    sync_strategy: 0,
    auto_pull: 0,
    enabled: 1,
    personal_access_token: null,
    is_private: 0,
    local_ops_enabled: 0,
    git_user_name: null,
    git_user_email: null,
    conflict_strategy: 'override',
    last_synced_at: null,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00'
  };
}

interface CurrentFixture {
  cache: PCDCache;
  destroy: () => Promise<void>;
}

function createCurrentCache(): CurrentFixture {
  const sqlite = new Database(':memory:', { int64: true });
  const kb = new Kysely<PCDDatabase>({ dialect: new DenoSqlite3Dialect({ database: sqlite }) });
  sqlite.exec(PCD_SCHEMA_SQL);
  sqlite.exec(SEED_SQL);
  return {
    cache: { kb, isBuilt: () => true } as unknown as PCDCache,
    destroy: async () => {
      await kb.destroy();
      sqlite.close();
    }
  };
}

/** Registers the current cache + patches instance lookup and buildReadOnly for the sandbox. */
async function withGoalsFixture(fn: (databaseId: number, current: CurrentFixture) => Promise<void>): Promise<void> {
  const current = createCurrentCache();
  setCache(DATABASE_ID, current.cache);

  const restores: Restore[] = [];
  patchTarget(
    databaseInstancesQueries,
    'getById',
    ((id: number) => (id === DATABASE_ID ? buildInstance() : undefined)) as typeof databaseInstancesQueries.getById,
    restores
  );
  patchTarget(
    PCDCacheClass.prototype,
    'buildReadOnly',
    async function (this: PCDCache) {
      const self = this as unknown as { bootstrap(): void; db: Database | null; built: boolean };
      self.bootstrap();
      self.db!.exec(PCD_SCHEMA_SQL);
      self.db!.exec(SEED_SQL);
      self.built = true;
    } as typeof PCDCacheClass.prototype.buildReadOnly,
    restores
  );

  try {
    await fn(DATABASE_ID, current);
  } finally {
    restores.reverse().forEach((restore) => restore());
    deleteCache(DATABASE_ID);
    await current.destroy();
  }
}

// deno-lint-ignore no-explicit-any
function postEvent(payload: unknown): any {
  return {
    request: new Request('http://localhost/api/v1/goals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })
  };
}

// deno-lint-ignore no-explicit-any
function getEvent(query: string): any {
  return { url: new URL(`http://localhost/api/v1/goals/binding?${query}`) };
}

function getErrorStatus(error: unknown): number {
  const status = (error as { status?: number }).status;
  if (typeof status !== 'number') throw new Error('Expected error with numeric status');
  return status;
}

function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/goals-routes-${crypto.randomUUID()}`;
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

// ============================================================================
// presets
// ============================================================================

Deno.test('goals presets: returns the catalog, axes, and engine version', async () => {
  // deno-lint-ignore no-explicit-any
  const response: Response = await presetsRoute.GET({} as any);
  assertEquals(response.status, 200);
  const body = (await response.json()) as GoalPresetsResponse;
  assertEquals(
    body.presets.map((preset) => preset.id).sort(),
    ['4k-hdr-priority', 'balanced', 'best-quality', 'smallest-size']
  );
  assertEquals(body.axes.length, 5);
  assert(body.axes.some((axis) => axis.key === 'resolutionCeiling' && axis.kind === 'ceiling'));
  assertEquals(body.engineVersion, '1');
});

// ============================================================================
// preview (non-persisting)
// ============================================================================

Deno.test('goals preview: returns the plan + config diff without persisting', async () => {
  await withGoalsFixture(async (databaseId, current) => {
    const response: Response = await previewRoute.POST(
      postEvent({ databaseId, arrType: 'radarr', profileName: 'Movies', preset: 'best-quality', weights: BEST_QUALITY_WEIGHTS })
    );
    assertEquals(response.status, 200);
    const body = (await response.json()) as GoalPreviewResponse;

    assertEquals(body.plan.coverage, { total: 6, scored: 5, uncategorized: 1 });
    assertEquals(body.plan.uncategorized.map((cf) => cf.name), ['x265 (Bluray)']);
    const dv = body.plan.decisions.find((d) => d.customFormatName === 'Dolby Vision');
    assertEquals(dv?.category, 'hdr_dv');
    assertEquals(dv?.score, 680);
    const banned = body.plan.decisions.find((d) => d.customFormatName === 'Banned Groups');
    assertEquals(banned?.score, -10000);

    // The sandbox diff reflects the would-be write (scores added onto the empty profile).
    assertEquals(body.configDiff.length, 1);
    assertEquals(body.configDiff[0].name, 'Movies');
    assert(body.configDiff[0].changes.length > 0);
    assert(body.appliedChanges.length > 0);

    // Non-persistence guarantee: the live cache still has zero scored custom formats.
    const persisted = await current.cache.kb
      .selectFrom('quality_profile_custom_formats')
      .select('custom_format_name')
      .execute();
    assertEquals(persisted.length, 0);
  });
});

Deno.test('goals preview: validation and missing-cache errors', async () => {
  await assertRejects(async () => previewRoute.POST(postEvent({ databaseId: 1, arrType: 'lidarr', profileName: 'M', preset: 'balanced', weights: BEST_QUALITY_WEIGHTS })));
  await assertRejects(async () => previewRoute.POST(postEvent({ databaseId: 1, arrType: 'radarr', profileName: 'M', preset: 'nope', weights: BEST_QUALITY_WEIGHTS })));
  await assertRejects(async () =>
    previewRoute.POST(
      postEvent({ databaseId: 1, arrType: 'radarr', profileName: 'M', preset: 'balanced', weights: { ...BEST_QUALITY_WEIGHTS, qualityVsSize: 150 } })
    )
  );
  // Unregistered databaseId -> 404 (valid body, no cache).
  const notFound = await assertRejects(async () =>
    previewRoute.POST(postEvent({ databaseId: 999999, arrType: 'radarr', profileName: 'Movies', preset: 'balanced', weights: BEST_QUALITY_WEIGHTS }))
  );
  assertEquals(getErrorStatus(notFound), 404);
});

// ============================================================================
// apply validation
// ============================================================================

Deno.test('goals apply: engine-version mismatch -> 409, missing version -> 400', async () => {
  const mismatch = await assertRejects(async () =>
    applyRoute.POST(
      postEvent({ databaseId: 1, arrType: 'radarr', profileName: 'Movies', preset: 'balanced', weights: BEST_QUALITY_WEIGHTS, expectedEngineVersion: '0' })
    )
  );
  assertEquals(getErrorStatus(mismatch), 409);

  const missing = await assertRejects(async () =>
    applyRoute.POST(postEvent({ databaseId: 1, arrType: 'radarr', profileName: 'Movies', preset: 'balanced', weights: BEST_QUALITY_WEIGHTS }))
  );
  assertEquals(getErrorStatus(missing), 400);
});

// ============================================================================
// binding (real migrated app DB)
// ============================================================================

migratedTest('goals binding: null when unbound, then reflects an upserted binding', async () => {
  const databaseId = databaseInstancesQueries.create({
    uuid: crypto.randomUUID(),
    name: 'Binding Route DB',
    repositoryUrl: 'https://example.invalid/repo.git',
    localPath: '/tmp/binding-route-db-does-not-exist'
  });

  const empty: Response = await bindingRoute.GET(getEvent(`databaseId=${databaseId}&profileName=Movies&arrType=radarr`));
  assertEquals(empty.status, 200);
  assertEquals(((await empty.json()) as GoalBindingResponse).binding, null);

  qualityGoalBindingQueries.upsert({
    databaseId,
    profileName: 'Movies',
    arrType: 'radarr',
    presetId: 'best-quality',
    weightsJson: JSON.stringify(BEST_QUALITY_WEIGHTS),
    engineVersion: '1',
    appliedAt: '2026-07-09T00:00:00.000Z'
  });

  const bound: Response = await bindingRoute.GET(getEvent(`databaseId=${databaseId}&profileName=Movies&arrType=radarr`));
  const body = (await bound.json()) as GoalBindingResponse;
  assertEquals(body.binding?.presetId, 'best-quality');
  assertEquals(body.binding?.weights.resolutionCeiling, '2160p');

  const badArr = await assertRejects(async () => bindingRoute.GET(getEvent(`databaseId=${databaseId}&profileName=Movies&arrType=lidarr`)));
  assertEquals(getErrorStatus(badArr), 400);
});
