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
import { buildGoalDecisionLogMetadata } from '$lib/server/goals/decisionLog.ts';
import type { PCDCache } from '$pcd/index.ts';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import type { GoalPlan } from '$shared/goals/index.ts';
import type { DatabaseInstance } from '$db/queries/databaseInstances.ts';
import type { QualityGoalBindingRow } from '$db/queries/qualityGoalBindings.ts';
import type { LogOptions } from '$logger/types.ts';
import type { GoalApplyDependencies } from '../../routes/api/v1/goals/apply/+server.ts';
import type { GoalReconcileDependencies } from '$lib/server/goals/reconcileGoalApply.ts';
import type { QualityGoalApplyJournalRow } from '$db/queries/qualityGoalApplyJournal.ts';
import { qualityGoalApplyJournalQueries } from '$db/queries/qualityGoalApplyJournal.ts';
import type { components } from '$api/v1.d.ts';

const { setCache, deleteCache } = await import('$pcd/database/registry.ts');
const { PCDCache: PCDCacheClass } = await import('$pcd/index.ts');
const presetsRoute = await import('../../routes/api/v1/goals/presets/+server.ts');
const previewRoute = await import('../../routes/api/v1/goals/preview/+server.ts');
const applyRoute = await import('../../routes/api/v1/goals/apply/+server.ts');
const reconcileRoute = await import('../../routes/api/v1/goals/reconcile/+server.ts');
const applyStatusRoute = await import('../../routes/api/v1/goals/apply/status/+server.ts');
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

  -- A profile WITH a quality ladder (issue #221). 'Movies' stays ladder-free so its preview test is
  -- unaffected: with no Bluray-<ceiling> row present, its ladder is always a no-op (ladderInput null).
  INSERT INTO qualities (name) VALUES ('Bluray-2160p'), ('Bluray-1080p'), ('Bluray-720p'), ('DVD-R');
  INSERT INTO quality_api_mappings (quality_name, arr_type, api_name) VALUES
    ('Bluray-2160p', 'radarr', 'Bluray-2160p'),
    ('Bluray-1080p', 'radarr', 'Bluray-1080p'),
    ('Bluray-720p', 'radarr', 'Bluray-720p'),
    ('DVD-R', 'radarr', 'DVD-R');
  INSERT INTO quality_profiles (id, name, minimum_custom_format_score, upgrade_until_score, upgrade_score_increment)
  VALUES (2, 'MoviesLadder', 0, 100, 1);
  INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES
    ('MoviesLadder', 'Bluray-2160p', NULL, 1, 1, 1),
    ('MoviesLadder', 'Bluray-1080p', NULL, 2, 1, 0),
    ('MoviesLadder', 'Bluray-720p', NULL, 3, 0, 0),
    ('MoviesLadder', 'DVD-R', NULL, 4, 0, 0);

  -- A profile whose quality group straddles the 1080p ceiling (mapped members at 1080p AND 2160p) —
  -- a genuinely ambiguous mapping that must fail fast (422) before any write (#221 AC4).
  INSERT INTO quality_profiles (id, name, minimum_custom_format_score, upgrade_until_score, upgrade_score_increment)
  VALUES (3, 'StraddleLadder', 0, 100, 1);
  INSERT INTO quality_groups (quality_profile_name, name) VALUES ('StraddleLadder', 'Mixed');
  INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES
    ('StraddleLadder', 'Mixed', 'Bluray-1080p'),
    ('StraddleLadder', 'Mixed', 'Bluray-2160p');
  INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES
    ('StraddleLadder', NULL, 'Mixed', 1, 1, 0),
    ('StraddleLadder', 'Bluray-720p', NULL, 2, 0, 0);
`;

const CEILING_720_WEIGHTS = {
  qualityVsSize: 50,
  compatibility: 55,
  hdrPreference: 50,
  unwantedStrictness: 80,
  resolutionCeiling: '720p',
};

const BEST_QUALITY_WEIGHTS = {
  qualityVsSize: 100,
  compatibility: 30,
  hdrPreference: 70,
  unwantedStrictness: 85,
  resolutionCeiling: '2160p',
};

const SERVER_GOAL_PLAN: GoalPlan = {
  engineVersion: '2',
  arrType: 'radarr',
  decisions: [
    {
      customFormatName: 'Server-derived Remux',
      arrType: 'radarr',
      category: 'remux',
      score: 321,
      reason: {
        code: 'category.remux',
        category: 'remux',
        ruleId: 'remux',
        base: 200,
        axisContributions: [{ axis: 'qualityVsSize', delta: 121 }],
        ceiling: null,
      },
    },
  ],
  uncategorized: [],
  thresholds: {
    minimumScore: 0,
    upgradeUntilScore: 321,
    upgradeScoreIncrement: 1,
  },
  coverage: { total: 1, scored: 1, uncategorized: 0 },
  scoringInput: {
    minimumScore: 0,
    upgradeUntilScore: 321,
    upgradeScoreIncrement: 1,
    customFormatScores: [
      {
        customFormatName: 'Server-derived Remux',
        arrType: 'radarr',
        score: 321,
      },
    ],
  },
  ladderInput: null,
  qualityLadder: {
    ceiling: '2160p',
    cutoff: null,
    items: [],
    reshapesSiblingArrs: false,
    sharedLadderNote: null,
  },
};

const SERVER_BINDING: QualityGoalBindingRow = {
  database_id: DATABASE_ID,
  profile_name: 'Movies',
  arr_type: 'radarr',
  preset_id: 'best-quality',
  weights_json: JSON.stringify(BEST_QUALITY_WEIGHTS),
  engine_version: '2',
  applied_at: '2026-07-09T00:00:00.000Z',
  created_at: '2026-07-09 00:00:00',
  updated_at: '2026-07-09 00:00:00',
};

interface ApplyLogCall {
  message: string;
  options?: LogOptions;
}

function buildApplyDependencies(
  logs: ApplyLogCall[],
  overrides: Partial<GoalApplyDependencies> = {}
): GoalApplyDependencies {
  return {
    buildGoalPlan: () => Promise.resolve({ cache: {} as PCDCache, plan: SERVER_GOAL_PLAN }),
    persistGoalApply: () => Promise.resolve({ success: true, filepath: 'pcd_ops:1' }),
    computeGoalConfigDiff: () => Promise.resolve({ configDiff: [], appliedChanges: [], skippedChanges: [] }),
    computeIntentFingerprint: () => Promise.resolve('fixed-fingerprint'),
    upsertBinding: () => SERVER_BINDING,
    insertPendingJournal: () => 1,
    markJournalSucceeded: () => {},
    markJournalFailed: () => {},
    logInfo: (message, options) => {
      logs.push({ message, options });
      return Promise.resolve();
    },
    ...overrides,
  };
}

type Restore = () => void;

function patchTarget<T extends object, K extends keyof T>(
  target: T,
  key: K,
  replacement: T[K],
  restores: Restore[]
): void {
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
    updated_at: '2026-01-01 00:00:00',
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
    },
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

function postEvent(payload: unknown): Parameters<typeof previewRoute.POST>[0] {
  return {
    request: new Request('http://localhost/api/v1/goals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  } as Parameters<typeof previewRoute.POST>[0];
}

function getEvent(query: string): Parameters<typeof bindingRoute.GET>[0] {
  return { url: new URL(`http://localhost/api/v1/goals/binding?${query}`) } as Parameters<typeof bindingRoute.GET>[0];
}

function getStatusEvent(query: string): Parameters<typeof applyStatusRoute.GET>[0] {
  return {
    url: new URL(`http://localhost/api/v1/goals/apply/status?${query}`),
  } as Parameters<typeof applyStatusRoute.GET>[0];
}

const RECONCILE_JOURNAL_ROW: QualityGoalApplyJournalRow = {
  id: 7,
  database_id: DATABASE_ID,
  profile_name: 'Movies',
  arr_type: 'radarr',
  preset_id: 'best-quality',
  weights_json: JSON.stringify(BEST_QUALITY_WEIGHTS),
  engine_version: '2',
  intent_fingerprint: 'fp',
  status: 'failed',
  scoring_persisted: 1,
  binding_persisted: 0,
  origin: 'apply',
  failure_stage: 'binding',
  failure_reason: 'Binding write failed',
  started_at: '2026-07-09T00:00:00.000Z',
  settled_at: '2026-07-09T00:00:00.000Z',
  created_at: '2026-07-09 00:00:00',
  updated_at: '2026-07-09 00:00:00',
};

function buildReconcileDependencies(
  logs: ApplyLogCall[],
  overrides: Partial<GoalReconcileDependencies> = {}
): GoalReconcileDependencies {
  return {
    getInstance: () => buildInstance(),
    recompileCache: () => Promise.resolve(),
    getLatestJournal: () => RECONCILE_JOURNAL_ROW,
    getBinding: () => undefined,
    buildGoalPlan: () => Promise.resolve({ cache: {} as PCDCache, plan: SERVER_GOAL_PLAN }),
    computeGoalConfigDiff: () => Promise.resolve({ configDiff: [], appliedChanges: [], skippedChanges: [] }),
    computeIntentFingerprint: () => Promise.resolve('fixed-fingerprint'),
    persistGoalApply: () => Promise.resolve({ success: true, filepath: 'pcd_ops:9' }),
    upsertBinding: () => SERVER_BINDING,
    insertPendingJournal: () => 2,
    markJournalSucceeded: () => {},
    markJournalFailed: () => {},
    logInfo: (message, options) => {
      logs.push({ message, options });
      return Promise.resolve();
    },
    ...overrides,
  };
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
    },
  });
}

// ============================================================================
// presets
// ============================================================================

Deno.test('goals presets: returns the catalog, axes, and engine version', async () => {
  const response: Response = await presetsRoute.GET({} as Parameters<typeof presetsRoute.GET>[0]);
  assertEquals(response.status, 200);
  const body = (await response.json()) as GoalPresetsResponse;
  assertEquals(body.presets.map((preset) => preset.id).sort(), [
    '4k-hdr-priority',
    'balanced',
    'best-quality',
    'smallest-size',
  ]);
  assertEquals(body.axes.length, 5);
  assert(body.axes.some((axis) => axis.key === 'resolutionCeiling' && axis.kind === 'ceiling'));
  assertEquals(body.engineVersion, '2');
});

Deno.test('goals presets: arrType=lidarr returns the audio presets and hides video-only axes (#222)', async () => {
  const url = new URL('http://localhost/api/v1/goals/presets?arrType=lidarr');
  const response: Response = await presetsRoute.GET({ url } as Parameters<typeof presetsRoute.GET>[0]);
  assertEquals(response.status, 200);
  const body = (await response.json()) as GoalPresetsResponse;
  assertEquals(body.presets.map((preset) => preset.id).sort(), [
    'audio-balanced',
    'audio-lossless-priority',
    'audio-space-saver',
  ]);
  // hdrPreference + resolutionCeiling are inert for audio and are not offered as sliders.
  assertEquals(body.axes.length, 3);
  assert(!body.axes.some((axis) => axis.key === 'hdrPreference' || axis.key === 'resolutionCeiling'));
  assertEquals(body.engineVersion, '2');
});

// ============================================================================
// preview (non-persisting)
// ============================================================================

Deno.test('goals preview: returns the plan + config diff without persisting', async () => {
  await withGoalsFixture(async (databaseId, current) => {
    const response: Response = await previewRoute.POST(
      postEvent({
        databaseId,
        arrType: 'radarr',
        profileName: 'Movies',
        preset: 'best-quality',
        weights: BEST_QUALITY_WEIGHTS,
      })
    );
    assertEquals(response.status, 200);
    const body = (await response.json()) as GoalPreviewResponse;

    assertEquals(body.plan.coverage, { total: 6, scored: 5, uncategorized: 1 });
    assertEquals(
      body.plan.uncategorized.map((cf) => cf.name),
      ['x265 (Bluray)']
    );
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

Deno.test('goals preview: surfaces quality-ladder + cutoff changes without persisting (#221)', async () => {
  await withGoalsFixture(async (databaseId, current) => {
    const response: Response = await previewRoute.POST(
      postEvent({
        databaseId,
        arrType: 'radarr',
        profileName: 'MoviesLadder',
        preset: 'balanced',
        weights: CEILING_720_WEIGHTS,
      })
    );
    assertEquals(response.status, 200);
    const body = (await response.json()) as GoalPreviewResponse;

    // The plan's ladder: 720p ceiling enables <=720, disables 1080p/2160p, cutoff -> Bluray-720p.
    assertEquals(body.plan.qualityLadder.cutoff, 'Bluray-720p');
    const ladderByName = new Map(body.plan.qualityLadder.items.map((item) => [item.name, item]));
    assertEquals(ladderByName.get('Bluray-720p')?.enabled, true);
    assertEquals(ladderByName.get('DVD-R')?.enabled, true);
    assertEquals(ladderByName.get('Bluray-1080p')?.enabled, false);
    assertEquals(ladderByName.get('Bluray-2160p')?.enabled, false);
    // Shared row set: MoviesLadder's enabled qualities are Sonarr-compatible → advisory present.
    assert(body.plan.qualityLadder.sharedLadderNote !== null);

    // The config diff surfaces the enabled + cutoff (upgradeUntil) FieldChanges for the ladder rows.
    const ladderDiff = body.configDiff.find((entry) => entry.name === 'MoviesLadder');
    assert(ladderDiff, 'expected a MoviesLadder config diff');
    const diffText = JSON.stringify(ladderDiff.changes);
    assert(diffText.includes('orderedItems'), 'diff references orderedItems');
    assert(diffText.includes('enabled'), 'diff surfaces enabled changes');
    assert(diffText.includes('upgradeUntil'), 'diff surfaces cutoff (upgradeUntil) changes');
    assert(diffText.includes('Bluray-720p'), 'diff references the new cutoff row');

    // Non-persistence: the live cache ladder is untouched (old cutoff still on Bluray-2160p).
    const persisted = await current.cache.kb
      .selectFrom('quality_profile_qualities')
      .select(['quality_name', 'enabled', 'upgrade_until'])
      .where('quality_profile_name', '=', 'MoviesLadder')
      .orderBy('position')
      .execute();
    assertEquals(persisted, [
      { quality_name: 'Bluray-2160p', enabled: 1, upgrade_until: 1 },
      { quality_name: 'Bluray-1080p', enabled: 1, upgrade_until: 0 },
      { quality_name: 'Bluray-720p', enabled: 0, upgrade_until: 0 },
      { quality_name: 'DVD-R', enabled: 0, upgrade_until: 0 },
    ]);
  });
});

Deno.test(
  'goals preview: lidarr scores audio, excludes video-only with the distinct reason, and does not persist (#222)',
  async () => {
    await withGoalsFixture(async (databaseId, current) => {
      const response: Response = await previewRoute.POST(
        postEvent({
          databaseId,
          arrType: 'lidarr',
          profileName: 'Movies',
          preset: 'audio-lossless-priority',
          weights: {
            qualityVsSize: 100,
            compatibility: 0,
            hdrPreference: 50,
            unwantedStrictness: 100,
            resolutionCeiling: '1080p',
          },
        })
      );
      assertEquals(response.status, 200);
      const body = (await response.json()) as GoalPreviewResponse;

      // Only audio + unwanted survive; the 3 video CFs are excluded and x265 is unmatched.
      assertEquals(body.plan.coverage, { total: 6, scored: 2, uncategorized: 4 });
      assertEquals(body.plan.decisions.find((d) => d.customFormatName === 'TrueHD')?.category, 'audio_lossless');
      assertEquals(
        body.plan.uncategorized.find((cf) => cf.name === 'Dolby Vision')?.reason,
        'excluded.video-only-on-lidarr'
      );
      assertEquals(body.plan.uncategorized.find((cf) => cf.name === 'x265 (Bluray)')?.reason, 'no-matching-rule');
      // The config diff is stamped lidarr (no sibling fallback).
      assertEquals(body.configDiff[0].arrType, 'lidarr');

      const persisted = await current.cache.kb
        .selectFrom('quality_profile_custom_formats')
        .select('custom_format_name')
        .execute();
      assertEquals(persisted.length, 0);
    });
  }
);

Deno.test('goals preview: a straddling quality group fails fast with 422 before any write (#221 AC4)', async () => {
  await withGoalsFixture(async (databaseId, current) => {
    const rejected = await assertRejects(async () =>
      previewRoute.POST(
        postEvent({
          databaseId,
          arrType: 'radarr',
          profileName: 'StraddleLadder',
          preset: 'balanced',
          weights: {
            qualityVsSize: 50,
            compatibility: 55,
            hdrPreference: 50,
            unwantedStrictness: 80,
            resolutionCeiling: '1080p',
          },
        })
      )
    );
    // buildGoalPlan (shared by preview AND apply) translates the GoalLadderMappingError to 422, not 500.
    assertEquals(getErrorStatus(rejected), 422);

    // The live cache ladder is untouched (fail-fast is before any write).
    const persisted = await current.cache.kb
      .selectFrom('quality_profile_qualities')
      .select(['quality_group_name', 'quality_name', 'enabled'])
      .where('quality_profile_name', '=', 'StraddleLadder')
      .orderBy('position')
      .execute();
    assertEquals(persisted, [
      { quality_group_name: 'Mixed', quality_name: null, enabled: 1 },
      { quality_group_name: null, quality_name: 'Bluray-720p', enabled: 0 },
    ]);
  });
});

Deno.test('goals preview: validation and missing-cache errors', async () => {
  await assertRejects(async () =>
    previewRoute.POST(
      postEvent({
        databaseId: 1,
        arrType: 'plex',
        profileName: 'M',
        preset: 'balanced',
        weights: BEST_QUALITY_WEIGHTS,
      })
    )
  );
  await assertRejects(async () =>
    previewRoute.POST(
      postEvent({ databaseId: 1, arrType: 'radarr', profileName: 'M', preset: 'nope', weights: BEST_QUALITY_WEIGHTS })
    )
  );
  await assertRejects(async () =>
    previewRoute.POST(
      postEvent({
        databaseId: 1,
        arrType: 'radarr',
        profileName: 'M',
        preset: 'balanced',
        weights: { ...BEST_QUALITY_WEIGHTS, qualityVsSize: 150 },
      })
    )
  );
  // Unregistered databaseId -> 404 (valid body, no cache).
  const notFound = await assertRejects(async () =>
    previewRoute.POST(
      postEvent({
        databaseId: 999999,
        arrType: 'radarr',
        profileName: 'Movies',
        preset: 'balanced',
        weights: BEST_QUALITY_WEIGHTS,
      })
    )
  );
  assertEquals(getErrorStatus(notFound), 404);
});

// ============================================================================
// apply validation
// ============================================================================

Deno.test('goals apply: logs one server-derived decision event after persistence succeeds', async () => {
  const logs: ApplyLogCall[] = [];
  const response = await applyRoute._handleGoalApplyRequest(
    postEvent({
      databaseId: DATABASE_ID,
      arrType: 'radarr',
      profileName: 'Movies',
      preset: 'best-quality',
      weights: BEST_QUALITY_WEIGHTS,
      expectedEngineVersion: '2',
      decisions: [{ customFormatName: 'Client-forged decision', score: 999999 }],
      scoringInput: { customFormatScores: [{ customFormatName: 'Client-forged decision', score: 999999 }] },
    }).request,
    buildApplyDependencies(logs)
  );

  assertEquals(response.status, 200);
  const applyBody = (await response.json()) as components['schemas']['GoalApplyResponse'];
  assertEquals(applyBody.applyId, 1);
  assertEquals(applyBody.applyStatus?.status, 'succeeded');
  assertEquals(applyBody.applyStatus?.bindingStatus, 'written');
  assertEquals(applyBody.applyStatus?.scoringChanged, true);
  assertEquals(applyBody.applyStatus?.recovery.action, 'none');
  assertEquals(logs, [
    {
      message: 'Quality goal applied',
      options: {
        source: 'QualityGoals',
        meta: buildGoalDecisionLogMetadata({
          databaseId: DATABASE_ID,
          profileName: 'Movies',
          presetId: 'best-quality',
          plan: SERVER_GOAL_PLAN,
        }),
      },
    },
  ]);

  const meta = logs[0].options?.meta as Record<string, unknown>;
  assert(!('scoringInput' in meta));
  const loggedDecision = (meta.decisions as Array<Record<string, unknown>>)[0];
  assertEquals(loggedDecision.customFormatName, 'Server-derived Remux');
  assertEquals(loggedDecision.score, 321);
});

Deno.test('goals apply: accepts arrType lidarr and upserts the binding with it (#222)', async () => {
  const logs: ApplyLogCall[] = [];
  let capturedArrType: string | undefined;
  const response = await applyRoute._handleGoalApplyRequest(
    postEvent({
      databaseId: DATABASE_ID,
      arrType: 'lidarr',
      profileName: 'Discography',
      preset: 'audio-lossless-priority',
      weights: {
        qualityVsSize: 100,
        compatibility: 20,
        hdrPreference: 50,
        unwantedStrictness: 85,
        resolutionCeiling: '1080p',
      },
      expectedEngineVersion: '2',
    }).request,
    buildApplyDependencies(logs, {
      upsertBinding: (input) => {
        capturedArrType = input.arrType;
        return { ...SERVER_BINDING, arr_type: 'lidarr' };
      },
    })
  );

  assertEquals(response.status, 200);
  assertEquals(capturedArrType, 'lidarr');
  assertEquals(logs.length, 1);
});

Deno.test('goals apply: validation and engine-version failures do not log', async () => {
  const logs: ApplyLogCall[] = [];
  const dependencies = buildApplyDependencies(logs);

  const invalid = await assertRejects(() =>
    applyRoute._handleGoalApplyRequest(
      postEvent({
        databaseId: 1,
        arrType: 'plex',
        profileName: 'Movies',
        preset: 'balanced',
        weights: BEST_QUALITY_WEIGHTS,
        expectedEngineVersion: '2',
      }).request,
      dependencies
    )
  );
  assertEquals(getErrorStatus(invalid), 400);

  const mismatch = await assertRejects(() =>
    applyRoute._handleGoalApplyRequest(
      postEvent({
        databaseId: 1,
        arrType: 'radarr',
        profileName: 'Movies',
        preset: 'balanced',
        weights: BEST_QUALITY_WEIGHTS,
        expectedEngineVersion: '0',
      }).request,
      dependencies
    )
  );
  assertEquals(getErrorStatus(mismatch), 409);

  const missing = await assertRejects(() =>
    applyRoute._handleGoalApplyRequest(
      postEvent({
        databaseId: 1,
        arrType: 'radarr',
        profileName: 'Movies',
        preset: 'balanced',
        weights: BEST_QUALITY_WEIGHTS,
      }).request,
      dependencies
    )
  );
  assertEquals(getErrorStatus(missing), 400);
  assertEquals(logs, []);
});

Deno.test('goals apply: scoring and binding failures return a structured failure and do not log (#236)', async () => {
  const requestPayload = {
    databaseId: DATABASE_ID,
    arrType: 'radarr',
    profileName: 'Movies',
    preset: 'best-quality',
    weights: BEST_QUALITY_WEIGHTS,
    expectedEngineVersion: '2',
  };
  type GoalApplyFailure = components['schemas']['GoalApplyFailure'];

  // Scoring failure (pre-persist reject): nothing persisted, binding never attempted, no decision log.
  const scoringLogs: ApplyLogCall[] = [];
  let scoringFailureBindingCalls = 0;
  const scoringFailed: Array<Parameters<GoalApplyDependencies['markJournalFailed']>[1]> = [];
  const scoringResponse = await applyRoute._handleGoalApplyRequest(
    postEvent(requestPayload).request,
    buildApplyDependencies(scoringLogs, {
      persistGoalApply: () => Promise.resolve({ success: false, error: 'Scoring write failed' }),
      markJournalFailed: (_id, input) => {
        scoringFailed.push(input);
      },
      upsertBinding: () => {
        scoringFailureBindingCalls += 1;
        return SERVER_BINDING;
      },
    })
  );
  assertEquals(scoringResponse.status, 500);
  const scoringBody = (await scoringResponse.json()) as GoalApplyFailure;
  assertEquals(scoringBody.message, 'Scoring write failed');
  assertEquals(scoringBody.applyStatus.failureStage, 'scoring');
  assertEquals(scoringBody.applyStatus.scoringChanged, false);
  assertEquals(scoringBody.applyStatus.recovery.endpoint, '/api/v1/goals/reconcile');
  assertEquals(
    scoringFailed.map((call) => call.failureStage),
    ['scoring']
  );
  assertEquals(scoringFailureBindingCalls, 0);
  assertEquals(scoringLogs, []);

  // Binding failure AFTER scoring persisted (the #236 gap): scoring IS reported changed, stage=binding.
  const bindingLogs: ApplyLogCall[] = [];
  const bindingFailed: Array<Parameters<GoalApplyDependencies['markJournalFailed']>[1]> = [];
  const bindingResponse = await applyRoute._handleGoalApplyRequest(
    postEvent(requestPayload).request,
    buildApplyDependencies(bindingLogs, {
      markJournalFailed: (_id, input) => {
        bindingFailed.push(input);
      },
      upsertBinding: () => {
        throw new Error('Binding write failed');
      },
    })
  );
  assertEquals(bindingResponse.status, 500);
  const bindingBody = (await bindingResponse.json()) as GoalApplyFailure;
  assertEquals(bindingBody.message, 'Binding write failed');
  assertEquals(bindingBody.applyStatus.failureStage, 'binding');
  assertEquals(bindingBody.applyStatus.scoringChanged, true);
  assertEquals(bindingBody.applyStatus.bindingStatus, 'failed');
  assertEquals(bindingBody.applyStatus.recovery.action, 'reconcile');
  assertEquals(
    bindingFailed.map((call) => call.failureStage),
    ['binding']
  );
  assertEquals(bindingFailed[0].scoringPersisted, 1);
  assertEquals(bindingLogs, []);
});

Deno.test('goals apply: a value-guard gate rejection maps to 409 (not 500) and does not log (#221)', async () => {
  const logs: ApplyLogCall[] = [];
  const conflictResponse = await applyRoute._handleGoalApplyRequest(
    postEvent({
      databaseId: DATABASE_ID,
      arrType: 'radarr',
      profileName: 'Movies',
      preset: 'best-quality',
      weights: BEST_QUALITY_WEIGHTS,
      expectedEngineVersion: '2',
    }).request,
    buildApplyDependencies(logs, {
      // The writer emits "Value-guard gate rejected operation N …" on a guard conflict; the route
      // classifies that as a 409 concurrency conflict via /value-guard gate/i and returns a structured body.
      persistGoalApply: () =>
        Promise.resolve({
          success: false,
          error: 'Value-guard gate rejected operation 2 (quality_profile "Movies"): conflict',
        }),
    })
  );
  assertEquals(conflictResponse.status, 409);
  const conflictBody = (await conflictResponse.json()) as components['schemas']['GoalApplyFailure'];
  assertEquals(conflictBody.applyStatus.scoringChanged, false);
  assertEquals(conflictBody.applyStatus.failureStage, 'scoring');
  assertEquals(logs, []);
});

// ============================================================================
// binding (real migrated app DB)
// ============================================================================

migratedTest('goals binding: null when unbound, then reflects an upserted binding', async () => {
  const databaseId = databaseInstancesQueries.create({
    uuid: crypto.randomUUID(),
    name: 'Binding Route DB',
    repositoryUrl: 'https://example.invalid/repo.git',
    localPath: '/tmp/binding-route-db-does-not-exist',
  });

  const empty: Response = await bindingRoute.GET(
    getEvent(`databaseId=${databaseId}&profileName=Movies&arrType=radarr`)
  );
  assertEquals(empty.status, 200);
  assertEquals(((await empty.json()) as GoalBindingResponse).binding, null);

  qualityGoalBindingQueries.upsert({
    databaseId,
    profileName: 'Movies',
    arrType: 'radarr',
    presetId: 'best-quality',
    weightsJson: JSON.stringify(BEST_QUALITY_WEIGHTS),
    engineVersion: '2',
    appliedAt: '2026-07-09T00:00:00.000Z',
  });

  const bound: Response = await bindingRoute.GET(
    getEvent(`databaseId=${databaseId}&profileName=Movies&arrType=radarr`)
  );
  const body = (await bound.json()) as GoalBindingResponse;
  assertEquals(body.binding?.presetId, 'best-quality');
  assertEquals(body.binding?.weights.resolutionCeiling, '2160p');
  // No apply-journal row yet → the binding response reports no outcome (#236).
  assertEquals(body.applyStatus ?? null, null);

  // A prior failed apply (scoring persisted, binding stage failed) surfaces on the binding response so
  // the goals editor can render its recovery banner even alongside a live binding (#236).
  const journalId = qualityGoalApplyJournalQueries.insertPending({
    databaseId,
    profileName: 'Movies',
    arrType: 'radarr',
    presetId: 'best-quality',
    weightsJson: JSON.stringify(BEST_QUALITY_WEIGHTS),
    engineVersion: '2',
    intentFingerprint: 'fp',
    origin: 'apply',
    startedAt: '2026-07-09T00:00:00.000Z',
  });
  qualityGoalApplyJournalQueries.markFailed(journalId, {
    failureStage: 'binding',
    failureReason: 'Binding write failed',
    scoringPersisted: 1,
    bindingPersisted: 0,
  });
  const withStatus: Response = await bindingRoute.GET(
    getEvent(`databaseId=${databaseId}&profileName=Movies&arrType=radarr`)
  );
  const statusBody = (await withStatus.json()) as GoalBindingResponse;
  assertEquals(statusBody.binding?.presetId, 'best-quality');
  assertEquals(statusBody.applyStatus?.status, 'failed');
  assertEquals(statusBody.applyStatus?.failureStage, 'binding');
  assertEquals(statusBody.applyStatus?.bindingStatus, 'failed');
  assertEquals(statusBody.applyStatus?.scoringChanged, true);
  assertEquals(statusBody.applyStatus?.recovery.action, 'reconcile');

  const badArr = await assertRejects(async () =>
    bindingRoute.GET(getEvent(`databaseId=${databaseId}&profileName=Movies&arrType=plex`))
  );
  assertEquals(getErrorStatus(badArr), 400);
});

migratedTest(
  'goals binding: a lidarr binding persists (widened CHECK) and round-trips independently (#222)',
  async () => {
    const databaseId = databaseInstancesQueries.create({
      uuid: crypto.randomUUID(),
      name: 'Lidarr Binding Route DB',
      repositoryUrl: 'https://example.invalid/repo.git',
      localPath: '/tmp/lidarr-binding-route-db-does-not-exist',
    });

    // Persisting a lidarr binding proves the 20260718 migration widened the arr_type CHECK.
    qualityGoalBindingQueries.upsert({
      databaseId,
      profileName: 'Discography',
      arrType: 'lidarr',
      presetId: 'audio-lossless-priority',
      weightsJson: JSON.stringify({
        qualityVsSize: 100,
        compatibility: 20,
        hdrPreference: 50,
        unwantedStrictness: 85,
        resolutionCeiling: '1080p',
      }),
      engineVersion: '2',
      appliedAt: '2026-07-10T00:00:00.000Z',
    });

    const bound: Response = await bindingRoute.GET(
      getEvent(`databaseId=${databaseId}&profileName=Discography&arrType=lidarr`)
    );
    assertEquals(bound.status, 200);
    assertEquals(((await bound.json()) as GoalBindingResponse).binding?.presetId, 'audio-lossless-priority');

    // Bindings are keyed by arr_type — radarr for the same profile is independent (no sibling fallback).
    const radarr: Response = await bindingRoute.GET(
      getEvent(`databaseId=${databaseId}&profileName=Discography&arrType=radarr`)
    );
    assertEquals(((await radarr.json()) as GoalBindingResponse).binding, null);
  }
);

Deno.test('goals binding: empty or missing databaseId query param -> 400 (not a 200 null)', async () => {
  const empty = await assertRejects(async () =>
    bindingRoute.GET(getEvent('databaseId=&profileName=Movies&arrType=radarr'))
  );
  assertEquals(getErrorStatus(empty), 400);
  const missing = await assertRejects(async () => bindingRoute.GET(getEvent('profileName=Movies&arrType=radarr')));
  assertEquals(getErrorStatus(missing), 400);
});

// ============================================================================
// reconcile (unit — stubbed deps)
// ============================================================================

Deno.test('goals reconcile: re-drives the recorded intent and logs once when residual ops persist (#236)', async () => {
  const logs: ApplyLogCall[] = [];
  const response = await reconcileRoute._handleGoalReconcileRequest(
    postEvent({ databaseId: DATABASE_ID, arrType: 'radarr', profileName: 'Movies', expectedEngineVersion: '2' }).request,
    buildReconcileDependencies(logs)
  );
  assertEquals(response.status, 200);
  const body = (await response.json()) as components['schemas']['GoalReconcileResponse'];
  assertEquals(body.reconciled, true);
  assertEquals(body.alreadyApplied, false);
  assertEquals(body.applyStatus.status, 'succeeded');
  assertEquals(body.applyStatus.scoringChanged, true);
  assertEquals(logs.length, 1);
});

Deno.test('goals reconcile: a no-op (live already matches intent) does not log and reports alreadyApplied (#236)', async () => {
  const logs: ApplyLogCall[] = [];
  const response = await reconcileRoute._handleGoalReconcileRequest(
    postEvent({ databaseId: DATABASE_ID, arrType: 'radarr', profileName: 'Movies', expectedEngineVersion: '2' }).request,
    // No residual ops (live already matches) → persistGoalApply returns success with no filepath.
    buildReconcileDependencies(logs, { persistGoalApply: () => Promise.resolve({ success: true }) })
  );
  assertEquals(response.status, 200);
  const body = (await response.json()) as components['schemas']['GoalReconcileResponse'];
  assertEquals(body.reconciled, false);
  assertEquals(body.alreadyApplied, true);
  assertEquals(body.applyStatus.scoringChanged, false);
  assertEquals(logs, []);
});

Deno.test('goals reconcile: 404 when nothing has ever been applied to the profile (#236)', async () => {
  const logs: ApplyLogCall[] = [];
  const rejected = await assertRejects(() =>
    reconcileRoute._handleGoalReconcileRequest(
      postEvent({ databaseId: DATABASE_ID, arrType: 'radarr', profileName: 'Movies', expectedEngineVersion: '2' })
        .request,
      buildReconcileDependencies(logs, { getLatestJournal: () => undefined, getBinding: () => undefined })
    )
  );
  assertEquals(getErrorStatus(rejected), 404);
  assertEquals(logs, []);
});

Deno.test('goals reconcile: an engine-version mismatch is a 409 before any write (#236)', async () => {
  const logs: ApplyLogCall[] = [];
  let persistCalls = 0;
  const rejected = await assertRejects(() =>
    reconcileRoute._handleGoalReconcileRequest(
      postEvent({ databaseId: DATABASE_ID, arrType: 'radarr', profileName: 'Movies', expectedEngineVersion: '0' })
        .request,
      buildReconcileDependencies(logs, {
        persistGoalApply: () => {
          persistCalls += 1;
          return Promise.resolve({ success: true });
        },
      })
    )
  );
  assertEquals(getErrorStatus(rejected), 409);
  assertEquals(persistCalls, 0);
});

// ============================================================================
// apply status (real migrated app DB)
// ============================================================================

migratedTest('goals apply status: null when no attempt, then reflects the latest journal row (#236)', async () => {
  const databaseId = databaseInstancesQueries.create({
    uuid: crypto.randomUUID(),
    name: 'Apply Status DB',
    repositoryUrl: 'https://example.invalid/repo.git',
    localPath: '/tmp/apply-status-db-does-not-exist',
  });

  const empty: Response = await applyStatusRoute.GET(
    getStatusEvent(`databaseId=${databaseId}&profileName=Movies&arrType=radarr`)
  );
  assertEquals(empty.status, 200);
  assertEquals(((await empty.json()) as { applyStatus: unknown }).applyStatus, null);

  // A failed binding stage: scoring persisted, binding absent — the #236 headline partial write.
  const id = qualityGoalApplyJournalQueries.insertPending({
    databaseId,
    profileName: 'Movies',
    arrType: 'radarr',
    presetId: 'best-quality',
    weightsJson: JSON.stringify(BEST_QUALITY_WEIGHTS),
    engineVersion: '2',
    intentFingerprint: 'fp',
    origin: 'apply',
    startedAt: '2026-07-09T00:00:00.000Z',
  });
  qualityGoalApplyJournalQueries.markFailed(id, {
    failureStage: 'binding',
    failureReason: 'Binding write failed',
    scoringPersisted: 1,
    bindingPersisted: 0,
  });

  const failed: Response = await applyStatusRoute.GET(
    getStatusEvent(`databaseId=${databaseId}&profileName=Movies&arrType=radarr`)
  );
  const status = ((await failed.json()) as { applyStatus: components['schemas']['GoalApplyStatus'] }).applyStatus;
  assertEquals(status.status, 'failed');
  assertEquals(status.failureStage, 'binding');
  assertEquals(status.scoringChanged, true);
  assertEquals(status.bindingStatus, 'failed');
  assertEquals(status.recovery.action, 'reconcile');
  assertEquals(status.recovery.endpoint, '/api/v1/goals/reconcile');

  const bad = await assertRejects(async () =>
    applyStatusRoute.GET(getStatusEvent('databaseId=&profileName=Movies&arrType=radarr'))
  );
  assertEquals(getErrorStatus(bad), 400);
});
