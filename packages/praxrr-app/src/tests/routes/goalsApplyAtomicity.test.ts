// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

/**
 * Integration atomicity coverage for the Quality Goals apply + reconcile flow (issue #236 AC5).
 *
 * Unlike goalsRoutes.test.ts (which drives the apply/reconcile handlers with fully STUBBED deps),
 * this suite drives `_handleGoalApplyRequest` / `_handleGoalReconcileRequest` with their DEFAULT deps
 * against a real migrated app DB AND a real compiled PCD cache, so the REAL scoring persist
 * (`persistGoalApply` -> `writeOperationsFromSql` -> `pcd_ops` + cache recompile), the REAL
 * `quality_goal_bindings` upsert, and the REAL `quality_goal_apply_journal` breadcrumb all run.
 * Faults are injected by monkey-patching the underlying query modules and restored in a finally.
 *
 * Seeding insight (the core setup challenge): apply's persist calls `compile(local_path, id)`, which
 * REBUILDS the cache from `pcd_ops` + the on-disk schema — a hand-injected in-memory cache would be
 * discarded. So the profile/custom-formats/qualities are seeded as a published BASE op in `pcd_ops`
 * (bypassing the value-guard gate, which only runs for the `user` layer) and `compile` rebuilds them
 * into the registry cache. The fixture asserts the profile is actually present in the compiled cache
 * before any apply runs. The apply's scoring writes land as `user`-layer ops on top of that base.
 */

import { assert, assertEquals, assertExists } from '@std/assert';

import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import { qualityGoalBindingQueries } from '$db/queries/qualityGoalBindings.ts';
import { qualityGoalApplyJournalQueries } from '$db/queries/qualityGoalApplyJournal.ts';
import { compile } from '$pcd/database/compiler.ts';
import { getCache, deleteCache } from '$pcd/database/registry.ts';
import { logger } from '$logger/logger.ts';
import type { components } from '$api/v1.d.ts';

const applyRoute = await import('../../routes/api/v1/goals/apply/+server.ts');
const reconcileRoute = await import('../../routes/api/v1/goals/reconcile/+server.ts');

type GoalApplyResponse = components['schemas']['GoalApplyResponse'];
type GoalApplyFailure = components['schemas']['GoalApplyFailure'];
type GoalReconcileResponse = components['schemas']['GoalReconcileResponse'];

const PCD_SCHEMA_SQL_PATH = new URL('../../../../praxrr-schema/ops/0.schema.sql', import.meta.url);
const PCD_SCHEMA_SQL = Deno.readTextFileSync(PCD_SCHEMA_SQL_PATH);

const PROFILE_NAME = 'Movies';
const ARR_TYPE = 'radarr';

// Mirrors the goalsRoutes.test.ts 'Movies' fixture: best-quality scores 5 of 6 custom formats
// (x265 is uncategorized) and 'Movies' has NO quality ladder, so apply persists scoring ops only.
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

  INSERT INTO qualities (name) VALUES ('Bluray-2160p'), ('Bluray-1080p'), ('Bluray-720p'), ('DVD-R');
  INSERT INTO quality_api_mappings (quality_name, arr_type, api_name) VALUES
    ('Bluray-2160p', 'radarr', 'Bluray-2160p'),
    ('Bluray-1080p', 'radarr', 'Bluray-1080p'),
    ('Bluray-720p', 'radarr', 'Bluray-720p'),
    ('DVD-R', 'radarr', 'DVD-R');
`;

const BEST_QUALITY_WEIGHTS = {
  qualityVsSize: 100,
  compatibility: 30,
  hdrPreference: 70,
  unwantedStrictness: 85,
  resolutionCeiling: '2160p'
};

type Restore = () => void;

interface ApplyFixtureContext {
  databaseId: number;
  pcdPath: string;
}

interface ScoreRow {
  custom_format_name: string;
  arr_type: string;
  score: number;
}

function applyPayload(databaseId: number): Record<string, unknown> {
  return {
    databaseId,
    arrType: ARR_TYPE,
    profileName: PROFILE_NAME,
    preset: 'best-quality',
    weights: BEST_QUALITY_WEIGHTS,
    expectedEngineVersion: '2'
  };
}

function reconcilePayload(databaseId: number): Record<string, unknown> {
  return {
    databaseId,
    arrType: ARR_TYPE,
    profileName: PROFILE_NAME,
    expectedEngineVersion: '2'
  };
}

function postRequest(payload: Record<string, unknown>): Request {
  return new Request('http://localhost/api/v1/goals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

/** Number of published user-layer scoring ops durably in `pcd_ops` for the fixture database. */
function userScoringOpCount(databaseId: number): number {
  return pcdOpsQueries.listByDatabaseAndOrigin(databaseId, 'user', { states: ['published'] }).length;
}

function bindingRowCount(databaseId: number): number {
  const row = db.queryFirst<{ count: number }>(
    'SELECT COUNT(*) AS count FROM quality_goal_bindings WHERE database_id = ? AND profile_name = ? AND arr_type = ?',
    databaseId,
    PROFILE_NAME,
    ARR_TYPE
  );
  return row?.count ?? 0;
}

/** Read the profile's persisted custom-format scores from the compiled cache, normalized + sorted. */
async function readCacheScores(databaseId: number): Promise<ScoreRow[]> {
  const cache = getCache(databaseId);
  assertExists(cache, 'compiled cache should exist when reading scores');
  const rows = await cache.kb
    .selectFrom('quality_profile_custom_formats')
    .select(['custom_format_name', 'arr_type', 'score'])
    .where('quality_profile_name', '=', PROFILE_NAME)
    .execute();
  return rows
    .map((row) => ({
      custom_format_name: row.custom_format_name,
      arr_type: row.arr_type,
      score: Number(row.score)
    }))
    .sort(
      (a, b) =>
        a.custom_format_name.localeCompare(b.custom_format_name) || a.arr_type.localeCompare(b.arr_type)
    );
}

/** Patch `logger.info` to record every 'Quality goal applied' decision-log emission (pass-through). */
function captureDecisionLogs(restores: Restore[]): string[] {
  const messages: string[] = [];
  const originalInfo = logger.info;
  logger.info = ((message: string, options?: Parameters<typeof originalInfo>[1]) => {
    if (message === 'Quality goal applied') {
      messages.push(message);
    }
    return originalInfo.call(logger, message, options);
  }) as typeof logger.info;
  restores.push(() => {
    logger.info = originalInfo;
  });
  return messages;
}

/**
 * Full isolation per test: fresh migrated app DB (via config.setBasePath + db.initialize) AND a fresh
 * on-disk PCD dir whose `deps/schema/ops/0.schema.sql` is the real schema. Seeds the entities as a
 * published base op, compiles, verifies the profile is in the cache, then runs the body. Cleans the
 * registry cache + temp dirs in the finally.
 */
async function withApplyFixture(fn: (ctx: ApplyFixtureContext) => Promise<void>): Promise<void> {
  const originalBasePath = config.paths.base;
  const tempBasePath = `/tmp/praxrr-tests/goals-apply-atomicity-${crypto.randomUUID()}`;
  const pcdPath = await Deno.makeTempDir({ prefix: 'goals-apply-pcd-' });
  let databaseId: number | undefined;

  await Deno.mkdir(tempBasePath, { recursive: true });
  await Deno.mkdir(`${pcdPath}/deps/schema/ops`, { recursive: true });
  await Deno.writeTextFile(`${pcdPath}/deps/schema/ops/0.schema.sql`, PCD_SCHEMA_SQL);

  db.close();
  config.setBasePath(tempBasePath);

  try {
    await db.initialize();
    await runMigrations();

    databaseId = databaseInstancesQueries.create({
      uuid: crypto.randomUUID(),
      name: 'Goals Apply Atomicity DB',
      repositoryUrl: 'https://example.invalid/repo.git',
      localPath: pcdPath
    });

    // Seed the profile/CFs/qualities as a published BASE op so `compile` rebuilds them into the cache.
    pcdOpsQueries.create({
      databaseId,
      origin: 'base',
      state: 'published',
      source: 'repo',
      sql: SEED_SQL
    });
    await compile(pcdPath, databaseId);

    const cache = getCache(databaseId);
    assertExists(cache, 'compiled cache should exist after seeding + compile');
    const profile = await cache.kb
      .selectFrom('quality_profiles')
      .select('name')
      .where('name', '=', PROFILE_NAME)
      .executeTakeFirst();
    assertExists(profile, 'seeded quality profile should be present in the compiled cache before apply');

    await fn({ databaseId, pcdPath });
  } finally {
    if (databaseId !== undefined) {
      const cache = getCache(databaseId);
      cache?.close();
      deleteCache(databaseId);
    }
    db.close();
    config.setBasePath(originalBasePath);
    await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
    await Deno.remove(pcdPath, { recursive: true }).catch(() => {});
  }
}

function atomicityTest(name: string, fn: () => Promise<void>): void {
  Deno.test({ name, sanitizeResources: false, sanitizeOps: false, fn });
}

// ============================================================================
// AC1 — the headline regression guard: binding fails AFTER scoring persisted.
// ============================================================================

atomicityTest(
  'goal apply: a binding write failure leaves scoring durably persisted, reports failureStage=binding, and reconcile heals the binding (#236 AC1)',
  async () => {
    await withApplyFixture(async ({ databaseId }) => {
      const restores: Restore[] = [];
      const decisionLogs = captureDecisionLogs(restores);

      // Fail the binding upsert exactly once — scoring has already durably landed by then.
      const originalUpsert = qualityGoalBindingQueries.upsert;
      let bindingThrown = false;
      qualityGoalBindingQueries.upsert = ((input: Parameters<typeof originalUpsert>[0]) => {
        if (!bindingThrown) {
          bindingThrown = true;
          throw new Error('Simulated binding write failure');
        }
        return originalUpsert.call(qualityGoalBindingQueries, input);
      }) as typeof qualityGoalBindingQueries.upsert;
      restores.push(() => {
        qualityGoalBindingQueries.upsert = originalUpsert;
      });

      try {
        const response = await applyRoute._handleGoalApplyRequest(postRequest(applyPayload(databaseId)));
        assertEquals(response.status, 500);
        const body = (await response.json()) as GoalApplyFailure;
        assertEquals(body.applyStatus.scoringChanged, true);
        assertEquals(body.applyStatus.failureStage, 'binding');
        assertEquals(body.applyStatus.bindingStatus, 'failed');

        // Scoring durably landed — there is no transaction, so it is NOT rolled back.
        assert(userScoringOpCount(databaseId) > 0, 'scoring user ops should be present in pcd_ops');

        // Binding is absent (the real partial write).
        assertEquals(qualityGoalBindingQueries.get(databaseId, PROFILE_NAME, ARR_TYPE), undefined);

        // Journal reports the partial write precisely.
        const latest = qualityGoalApplyJournalQueries.getLatest(databaseId, PROFILE_NAME, ARR_TYPE);
        assertExists(latest);
        assertEquals(latest.status, 'failed');
        assertEquals(latest.failure_stage, 'binding');
        assertEquals(latest.scoring_persisted, 1);

        // No decision log on failure.
        assertEquals(decisionLogs.length, 0);
      } finally {
        restores.reverse().forEach((restore) => restore());
      }

      // Reconcile (fault removed) confirms the binding. Scoring already landed, so the residual scoring
      // diff is empty → reconciled=false / alreadyApplied=true; the END state is binding + journal ok.
      const reconcileResponse = await reconcileRoute._handleGoalReconcileRequest(
        postRequest(reconcilePayload(databaseId))
      );
      assertEquals(reconcileResponse.status, 200);
      const reconcileBody = (await reconcileResponse.json()) as GoalReconcileResponse;
      assertEquals(reconcileBody.reconciled, false);
      assertEquals(reconcileBody.alreadyApplied, true);

      assertExists(qualityGoalBindingQueries.get(databaseId, PROFILE_NAME, ARR_TYPE));
      const healed = qualityGoalApplyJournalQueries.getLatest(databaseId, PROFILE_NAME, ARR_TYPE);
      assertExists(healed);
      assertEquals(healed.status, 'succeeded');

      // A second reconcile is a pure no-op and still reports alreadyApplied.
      const secondReconcile = await reconcileRoute._handleGoalReconcileRequest(
        postRequest(reconcilePayload(databaseId))
      );
      assertEquals(secondReconcile.status, 200);
      const secondBody = (await secondReconcile.json()) as GoalReconcileResponse;
      assertEquals(secondBody.alreadyApplied, true);
    });
  }
);

// ============================================================================
// AC2 — a scoring-op write failure at the first / middle / final op, each healed by reconcile.
// ============================================================================

atomicityTest(
  'goal apply: a scoring-op write failure at the first, middle, or final op is reported and fully healed by reconcile (#236 AC2)',
  async () => {
    // A clean run first (sibling setup) to learn the op count + the golden full scoring set. Injecting a
    // precise mid-loop `pcdOpsQueries.create` throw IS feasible here (the real writer inserts one op per
    // create call), so this uses that real injection rather than the value-guard failure surface.
    let opCount = 0;
    let goldenScores: ScoreRow[] = [];
    await withApplyFixture(async ({ databaseId }) => {
      const restores: Restore[] = [];
      const originalCreate = pcdOpsQueries.create;
      pcdOpsQueries.create = ((input: Parameters<typeof originalCreate>[0]) => {
        opCount += 1;
        return originalCreate.call(pcdOpsQueries, input);
      }) as typeof pcdOpsQueries.create;
      restores.push(() => {
        pcdOpsQueries.create = originalCreate;
      });

      try {
        const response = await applyRoute._handleGoalApplyRequest(postRequest(applyPayload(databaseId)));
        assertEquals(response.status, 200);
        goldenScores = await readCacheScores(databaseId);
      } finally {
        restores.reverse().forEach((restore) => restore());
      }

      assert(opCount >= 3, `expected at least 3 scoring ops for first/middle/final coverage, got ${opCount}`);
      assert(goldenScores.length > 0, 'golden full scoring should be non-empty');
    });

    const positions = [...new Set([0, Math.floor(opCount / 2), opCount - 1])];
    for (const throwAt of positions) {
      await withApplyFixture(async ({ databaseId }) => {
        const restores: Restore[] = [];
        const decisionLogs = captureDecisionLogs(restores);

        const originalCreate = pcdOpsQueries.create;
        let calls = 0;
        pcdOpsQueries.create = ((input: Parameters<typeof originalCreate>[0]) => {
          const index = calls++;
          if (index === throwAt) {
            throw new Error(`Simulated pcd_ops.create failure at op ${throwAt}`);
          }
          return originalCreate.call(pcdOpsQueries, input);
        }) as typeof pcdOpsQueries.create;
        restores.push(() => {
          pcdOpsQueries.create = originalCreate;
        });

        try {
          const response = await applyRoute._handleGoalApplyRequest(postRequest(applyPayload(databaseId)));
          assertEquals(response.status, 500, `apply should 500 for op position ${throwAt}`);
          const body = (await response.json()) as GoalApplyFailure;
          assertEquals(body.applyStatus.failureStage, 'scoring');
          assertEquals(body.applyStatus.scoringChanged, true);
          assertEquals(body.applyStatus.recovery.endpoint, '/api/v1/goals/reconcile');

          const latest = qualityGoalApplyJournalQueries.getLatest(databaseId, PROFILE_NAME, ARR_TYPE);
          assertExists(latest);
          assertEquals(latest.status, 'failed');
          assertEquals(latest.failure_stage, 'scoring');

          // No decision log on failure.
          assertEquals(decisionLogs.length, 0);
        } finally {
          restores.reverse().forEach((restore) => restore());
        }

        // Reconcile (fault removed) re-derives the recorded intent and persists only the residual diff.
        const reconcileResponse = await reconcileRoute._handleGoalReconcileRequest(
          postRequest(reconcilePayload(databaseId))
        );
        assertEquals(reconcileResponse.status, 200, `reconcile should 200 for op position ${throwAt}`);

        const healed = qualityGoalApplyJournalQueries.getLatest(databaseId, PROFILE_NAME, ARR_TYPE);
        assertExists(healed);
        assertEquals(healed.status, 'succeeded');
        assertExists(qualityGoalBindingQueries.get(databaseId, PROFILE_NAME, ARR_TYPE));

        // The FULL intended scoring is present (any partial that landed + the residual == the complete plan).
        const finalScores = await readCacheScores(databaseId);
        assertEquals(finalScores, goldenScores, `full scoring should be recovered for op position ${throwAt}`);
      });
    }
  }
);

// ============================================================================
// Idempotent clean apply + retry.
// ============================================================================

atomicityTest(
  'goal apply: a clean apply persists exactly one binding + one decision log and re-applying is idempotent (#236)',
  async () => {
    await withApplyFixture(async ({ databaseId }) => {
      const restores: Restore[] = [];
      const decisionLogs = captureDecisionLogs(restores);

      try {
        const first = await applyRoute._handleGoalApplyRequest(postRequest(applyPayload(databaseId)));
        assertEquals(first.status, 200);
        const firstBody = (await first.json()) as GoalApplyResponse;
        assertEquals(firstBody.applyStatus?.status, 'succeeded');
        assertEquals(firstBody.applyStatus?.scoringChanged, true);

        assertExists(qualityGoalBindingQueries.get(databaseId, PROFILE_NAME, ARR_TYPE));
        assertEquals(bindingRowCount(databaseId), 1);
        assertEquals(decisionLogs.length, 1);

        const latest = qualityGoalApplyJournalQueries.getLatest(databaseId, PROFILE_NAME, ARR_TYPE);
        assertExists(latest);
        assertEquals(latest.status, 'succeeded');

        // Re-apply the same goal: still succeeds, still exactly one binding row (idempotent upsert),
        // and scoring reports unchanged because the live state already matches the intent.
        const second = await applyRoute._handleGoalApplyRequest(postRequest(applyPayload(databaseId)));
        assertEquals(second.status, 200);
        const secondBody = (await second.json()) as GoalApplyResponse;
        assertEquals(secondBody.applyStatus?.status, 'succeeded');
        assertEquals(secondBody.applyStatus?.scoringChanged, false);
        assertEquals(bindingRowCount(databaseId), 1);
      } finally {
        restores.reverse().forEach((restore) => restore());
      }
    });
  }
);

// ============================================================================
// Crash-window pending heal.
// ============================================================================

atomicityTest(
  'goal apply: a crash-window pending journal row is healed by reconcile without duplicating scoring (#236)',
  async () => {
    await withApplyFixture(async ({ databaseId }) => {
      const first = await applyRoute._handleGoalApplyRequest(postRequest(applyPayload(databaseId)));
      assertEquals(first.status, 200);

      const opsAfterApply = userScoringOpCount(databaseId);
      assert(opsAfterApply > 0, 'clean apply should persist scoring ops');
      assertExists(qualityGoalBindingQueries.get(databaseId, PROFILE_NAME, ARR_TYPE));

      // Simulate a crash between the durable scoring write and the terminal journal settle: manually
      // flip the latest journal row back to `pending`.
      const applied = qualityGoalApplyJournalQueries.getLatest(databaseId, PROFILE_NAME, ARR_TYPE);
      assertExists(applied);
      db.execute(
        "UPDATE quality_goal_apply_journal SET status = 'pending', settled_at = NULL WHERE id = ?",
        applied.id
      );
      assertEquals(qualityGoalApplyJournalQueries.getById(applied.id)?.status, 'pending');

      // Reconcile heals: the live scoring already matches the intent, so NO new ops are written.
      const reconcileResponse = await reconcileRoute._handleGoalReconcileRequest(
        postRequest(reconcilePayload(databaseId))
      );
      assertEquals(reconcileResponse.status, 200);

      assertEquals(userScoringOpCount(databaseId), opsAfterApply, 'reconcile must not duplicate scoring ops');
      assertExists(qualityGoalBindingQueries.get(databaseId, PROFILE_NAME, ARR_TYPE));
      const healed = qualityGoalApplyJournalQueries.getLatest(databaseId, PROFILE_NAME, ARR_TYPE);
      assertExists(healed);
      assertEquals(healed.status, 'succeeded');
    });
  }
);
