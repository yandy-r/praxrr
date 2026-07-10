/**
 * Integration coverage for the goal-apply op assembly + guard gate (issue #221).
 *
 * The apply route persists scoring + ladder as ONE guarded `writeOperationsFromSql` call. This test
 * exercises the real #221-specific mechanisms against a real in-memory cache:
 *  - AC3: `buildGoalApplyOps` emits [...scoringOps, ladderOp], each with its own single-family
 *    desiredState, and the ladder op's SQL is byte-identical to `buildQualityLadderOps` (the same
 *    builder preview uses) — preview and apply cannot diverge.
 *  - AC4: the value-guard gate over the merged ops passes on a clean cache and REJECTS (→ 409) when a
 *    row was changed out from under the plan, leaving the cache untouched (no partial write).
 *
 * The writer's persist+compile path is already covered by the existing writer/scoring tests; here we
 * pin the new op-assembly and the atomic gate, which are what #221 adds.
 */

import { assert, assertEquals } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';

import { deleteCache, setCache } from '$pcd/database/registry.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { __testOnly_runValueGuardGate } from '$pcd/ops/writer.ts';
import { compiledQueryToSql } from '$pcd/utils/sql.ts';
import type { PCDCache } from '$pcd/index.ts';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import type { DatabaseInstance } from '$db/queries/databaseInstances.ts';
import { buildGoalApplyOps } from '$server/goals/buildGoalApplyOps.ts';
import { buildQualityLadderOps } from '$pcd/entities/qualityProfiles/qualities/index.ts';
import { buildCeilingLadder } from '$shared/goals/index.ts';
import type { GoalPlan, GoalQualityFact } from '$shared/goals/index.ts';
import type { OrderedItem } from '$shared/pcd/display.ts';

const PCD_SCHEMA_SQL_PATH = new URL('../../../../praxrr-schema/ops/0.schema.sql', import.meta.url);
const PCD_SCHEMA_SQL = Deno.readTextFileSync(PCD_SCHEMA_SQL_PATH);
const DATABASE_ID = 830011;

const SEED_SQL = `
  INSERT INTO quality_profiles (id, name, minimum_custom_format_score, upgrade_until_score, upgrade_score_increment)
  VALUES (1, 'Movies', 0, 100, 1);

  INSERT INTO custom_formats (name) VALUES ('Remux');
  INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
  VALUES ('Movies', 'Remux', 'radarr', 5);

  INSERT INTO qualities (name) VALUES ('Bluray-2160p'), ('Bluray-1080p'), ('Bluray-720p'), ('DVD-R');
  INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES
    ('Movies', 'Bluray-2160p', NULL, 1, 1, 1),
    ('Movies', 'Bluray-1080p', NULL, 2, 1, 0),
    ('Movies', 'Bluray-720p', NULL, 3, 0, 0),
    ('Movies', 'DVD-R', NULL, 4, 0, 0);
`;

const FACTS: GoalQualityFact[] = [
  { name: 'Bluray-2160p', resolution: 2160 },
  { name: 'Bluray-1080p', resolution: 1080 },
  { name: 'Bluray-720p', resolution: 720 },
  { name: 'DVD-R', resolution: 480 }
];

const CURRENT_LADDER: OrderedItem[] = [
  { type: 'quality', name: 'Bluray-2160p', position: 1, enabled: true, upgradeUntil: true },
  { type: 'quality', name: 'Bluray-1080p', position: 2, enabled: true, upgradeUntil: false },
  { type: 'quality', name: 'Bluray-720p', position: 3, enabled: false, upgradeUntil: false },
  { type: 'quality', name: 'DVD-R', position: 4, enabled: false, upgradeUntil: false }
];

function buildPlan(): GoalPlan {
  const { ladderInput, ladder } = buildCeilingLadder('720p', CURRENT_LADDER, FACTS, false);
  assert(ladderInput !== null, 'expected a ladder change for the 720p ceiling');
  return {
    engineVersion: '2',
    arrType: 'radarr',
    decisions: [],
    uncategorized: [],
    thresholds: { minimumScore: 0, upgradeUntilScore: 100, upgradeScoreIncrement: 1 },
    coverage: { total: 1, scored: 1, uncategorized: 0 },
    scoringInput: {
      minimumScore: 0,
      upgradeUntilScore: 100,
      upgradeScoreIncrement: 1,
      customFormatScores: [{ customFormatName: 'Remux', arrType: 'radarr', score: 100 }]
    },
    ladderInput,
    qualityLadder: ladder
  };
}

function buildInstance(): DatabaseInstance {
  return {
    id: DATABASE_ID,
    uuid: 'goals-apply-persistence',
    name: 'Goals Apply Persistence DB',
    repository_url: '',
    local_path: '',
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

interface Fixture {
  cache: PCDCache;
  sqlite: Database;
  restore: () => void;
  destroy: () => Promise<void>;
}

function createFixture(): Fixture {
  const sqlite = new Database(':memory:', { int64: true });
  const kb = new Kysely<PCDDatabase>({ dialect: new DenoSqlite3Dialect({ database: sqlite }) });
  sqlite.exec(PCD_SCHEMA_SQL);
  sqlite.exec(SEED_SQL);
  const cache = { kb, getRawDb: () => sqlite, close: () => {} } as unknown as PCDCache;
  setCache(DATABASE_ID, cache);

  const original = databaseInstancesQueries.getById;
  databaseInstancesQueries.getById = ((id: number) =>
    id === DATABASE_ID ? buildInstance() : undefined) as typeof databaseInstancesQueries.getById;

  return {
    cache,
    sqlite,
    restore: () => {
      databaseInstancesQueries.getById = original;
    },
    destroy: async () => {
      await kb.destroy();
      sqlite.close();
      deleteCache(DATABASE_ID);
    }
  };
}

Deno.test('goal apply: assembles scoring + ladder ops sharing the exact preview builder (AC3)', async () => {
  const fixture = createFixture();
  try {
    const plan = buildPlan();
    const built = await buildGoalApplyOps({
      databaseId: DATABASE_ID,
      cache: fixture.cache,
      layer: 'user',
      profileName: 'Movies',
      plan
    });
    assert(!('error' in built), 'expected assembled operations');

    // Exactly one op carries the ordered_items (ladder) desiredState; at least one carries scoring.
    const ladderOps = built.operations.filter((op) => 'ordered_items' in op.desiredState);
    const scoringOps = built.operations.filter((op) => 'custom_format_scores' in op.desiredState);
    assertEquals(ladderOps.length, 1, 'one ladder op');
    assert(scoringOps.length >= 1, 'at least one scoring op — both guard families present on the merged set');

    // Parity: the apply ladder op SQL is byte-identical to the shared builder preview uses.
    const ladderBuilt = await buildQualityLadderOps({
      databaseId: DATABASE_ID,
      cache: fixture.cache,
      layer: 'user',
      profileName: 'Movies',
      input: plan.ladderInput!,
      forbidRemovals: true
    });
    assert(!('error' in ladderBuilt) && ladderBuilt.batched !== null);
    const expectedLadderSql = ladderBuilt.batched.queries.map(compiledQueryToSql).join(';\n\n') + ';';
    assertEquals(ladderOps[0].sql, expectedLadderSql);
  } finally {
    fixture.restore();
    await fixture.destroy();
  }
});

Deno.test('goal apply: the value-guard gate passes on a clean cache and is a dry run (AC3)', async () => {
  const fixture = createFixture();
  try {
    const plan = buildPlan();
    const built = await buildGoalApplyOps({
      databaseId: DATABASE_ID,
      cache: fixture.cache,
      layer: 'user',
      profileName: 'Movies',
      plan
    });
    assert(!('error' in built));

    const gate = __testOnly_runValueGuardGate(DATABASE_ID, 'user', built.operations);
    assertEquals(gate.ok, true, 'guards pass when the cache matches the plan');

    // The gate is a dry run (SAVEPOINT/ROLLBACK) — the live ladder is unchanged.
    const rows = fixture.sqlite
      .prepare(
        `SELECT quality_name, enabled, upgrade_until FROM quality_profile_qualities WHERE quality_profile_name = 'Movies' ORDER BY position`
      )
      .all() as Array<{ quality_name: string; enabled: number; upgrade_until: number }>;
    assertEquals(rows, [
      { quality_name: 'Bluray-2160p', enabled: 1, upgrade_until: 1 },
      { quality_name: 'Bluray-1080p', enabled: 1, upgrade_until: 0 },
      { quality_name: 'Bluray-720p', enabled: 0, upgrade_until: 0 },
      { quality_name: 'DVD-R', enabled: 0, upgrade_until: 0 }
    ]);
  } finally {
    fixture.restore();
    await fixture.destroy();
  }
});

Deno.test('goal apply: a ladder row changed out from under the plan is rejected → 409, no partial write (AC4)', async () => {
  const fixture = createFixture();
  try {
    const plan = buildPlan();
    const built = await buildGoalApplyOps({
      databaseId: DATABASE_ID,
      cache: fixture.cache,
      layer: 'user',
      profileName: 'Movies',
      plan
    });
    assert(!('error' in built));

    // Simulate an upstream/sibling change between plan-read and persist: flip Bluray-720p enabled.
    fixture.sqlite.exec(
      `UPDATE quality_profile_qualities SET enabled = 1 WHERE quality_profile_name = 'Movies' AND quality_name = 'Bluray-720p'`
    );

    const gate = __testOnly_runValueGuardGate(DATABASE_ID, 'user', built.operations);
    assertEquals(gate.ok, false, 'the guarded ladder op no longer matches → conflict (apply returns 409)');

    // Nothing was persisted by the gate beyond the deliberate tamper (only Bluray-720p enabled).
    const rows = fixture.sqlite
      .prepare(
        `SELECT quality_name, enabled, upgrade_until FROM quality_profile_qualities WHERE quality_profile_name = 'Movies' ORDER BY position`
      )
      .all() as Array<{ quality_name: string; enabled: number; upgrade_until: number }>;
    assertEquals(rows, [
      { quality_name: 'Bluray-2160p', enabled: 1, upgrade_until: 1 },
      { quality_name: 'Bluray-1080p', enabled: 1, upgrade_until: 0 },
      { quality_name: 'Bluray-720p', enabled: 1, upgrade_until: 0 },
      { quality_name: 'DVD-R', enabled: 0, upgrade_until: 0 }
    ]);
  } finally {
    fixture.restore();
    await fixture.destroy();
  }
});
