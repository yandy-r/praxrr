/**
 * Isolation + fail-soft tests for `withSandboxCache`.
 *
 * The sandbox is a real, ephemeral `PCDCache`: proposed scoring ops are applied
 * to ITS raw SQLite handle only — never through `writeOperation`, never via
 * `setCache`. These tests build the sandbox with the `withLayerDivergenceFixture`
 * recipe (patch `databaseInstancesQueries.getById` + `PCDCache.prototype.buildReadOnly`)
 * so no on-disk PCD clone is needed, and assert:
 *   (a) 0->50 and 50->10 score edits are reflected in the sandbox;
 *   (b) the source config (a separately registered "current" cache) is untouched;
 *   (c) the sandbox cache is never discoverable via the registry;
 *   (d) the sandbox always closes — across repeated runs and a throwing `fn`;
 *   (e) a profile whose ops fail lands ALL its changes in skippedChanges (no throw),
 *       while a valid profile lands in appliedChanges.
 */

import { assert, assertEquals, assertRejects } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';

import { PCDCache } from '$pcd/index.ts';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import { setCache, getCache, deleteCache } from '$pcd/database/registry.ts';
import { databaseInstancesQueries, type DatabaseInstance } from '$db/queries/databaseInstances.ts';
import { withSandboxCache, type ProfileEdit } from '$pcd/sandbox/withSandboxCache.ts';
import type { components } from '$api/v1.d.ts';

type ProposedChange = components['schemas']['ProposedChange'];

const PCD_SCHEMA_SQL_PATH = new URL('../../../../../praxrr-schema/ops/0.schema.sql', import.meta.url);
const PCD_SCHEMA_SQL = Deno.readTextFileSync(PCD_SCHEMA_SQL_PATH);

// CF-Existing has a radarr row (score 50) for a 50->10 update; CF-New has none for a 0->50 insert.
const SEED_SQL = `
  INSERT INTO quality_profiles (id, name, minimum_custom_format_score, upgrade_until_score, upgrade_score_increment)
  VALUES (1, 'Primary', 0, 0, 1);
  INSERT INTO custom_formats (name) VALUES ('CF-New');
  INSERT INTO custom_formats (name) VALUES ('CF-Existing');
  INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
  VALUES ('Primary', 'CF-Existing', 'radarr', 50);
`;

const DATABASE_ID = 771001;

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
    uuid: 'impact-sandbox-test-uuid',
    name: 'Impact Sandbox Test DB',
    repository_url: 'https://example.invalid/repo.git',
    local_path: '/tmp/impact-sandbox-does-not-exist',
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
  sqlite: Database;
  destroy: () => Promise<void>;
}

/** A queryable `{ kb, isBuilt }` cache standing in for the registered "current" config. */
function createCurrentCache(): CurrentFixture {
  const sqlite = new Database(':memory:', { int64: true });
  const kb = new Kysely<PCDDatabase>({ dialect: new DenoSqlite3Dialect({ database: sqlite }) });
  sqlite.exec(PCD_SCHEMA_SQL);
  sqlite.exec(SEED_SQL);
  return {
    cache: { kb, isBuilt: () => true } as unknown as PCDCache,
    sqlite,
    destroy: async () => {
      await kb.destroy();
      sqlite.close();
    },
  };
}

/** Read qpcf scores from a raw handle, normalizing int64 bigints to numbers for stable equality. */
function readScores(raw: Database): Array<{ name: string; arrType: string; score: number }> {
  const rows = raw
    .prepare(
      "SELECT custom_format_name AS name, arr_type AS arrType, score FROM quality_profile_custom_formats WHERE quality_profile_name = 'Primary' ORDER BY custom_format_name, arr_type"
    )
    .all() as Array<{ name: string; arrType: string; score: number | bigint }>;
  return rows.map((r) => ({ name: r.name, arrType: r.arrType, score: Number(r.score) }));
}

/** Read the 'Primary' profile's minimum custom-format score, normalizing int64. */
function readMinimumScore(raw: Database): number {
  const row = raw
    .prepare("SELECT minimum_custom_format_score AS min FROM quality_profiles WHERE name = 'Primary'")
    .get() as { min: number | bigint };
  return Number(row.min);
}

/** Installs the fixture patches (instance lookup + buildReadOnly seeding), runs `fn`, restores. */
async function withFixture(fn: () => Promise<void>): Promise<void> {
  const restores: Restore[] = [];
  patchTarget(
    databaseInstancesQueries,
    'getById',
    ((id: number) => (id === DATABASE_ID ? buildInstance() : undefined)) as typeof databaseInstancesQueries.getById,
    restores
  );
  patchTarget(
    PCDCache.prototype,
    'buildReadOnly',
    async function (this: PCDCache) {
      const self = this as unknown as { bootstrap(): void; db: Database | null; built: boolean };
      self.bootstrap();
      self.db!.exec(PCD_SCHEMA_SQL);
      self.db!.exec(SEED_SQL);
      self.built = true;
    } as typeof PCDCache.prototype.buildReadOnly,
    restores
  );
  try {
    await fn();
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
}

function editFor(
  customFormatScores: ProfileEdit['input']['customFormatScores'],
  changes: ProposedChange[]
): ProfileEdit {
  return {
    input: { minimumScore: 0, upgradeUntilScore: 0, upgradeScoreIncrement: 1, customFormatScores },
    changes,
  };
}

Deno.test('withSandboxCache: applies 0->50 and 50->10 edits inside the sandbox only', async () => {
  await withFixture(async () => {
    const changeNew: ProposedChange = {
      kind: 'set_cf_score',
      profileName: 'Primary',
      customFormatName: 'CF-New',
      score: 50,
    };
    const changeExisting: ProposedChange = {
      kind: 'set_cf_score',
      profileName: 'Primary',
      customFormatName: 'CF-Existing',
      score: 10,
    };

    const edits = new Map<string, ProfileEdit>([
      [
        'Primary',
        editFor(
          [
            { customFormatName: 'CF-New', arrType: 'radarr', score: 50 },
            { customFormatName: 'CF-Existing', arrType: 'radarr', score: 10 },
          ],
          [changeNew, changeExisting]
        ),
      ],
    ]);

    const sandboxScores = await withSandboxCache(DATABASE_ID, edits, async (sandboxCache, report) => {
      const raw = sandboxCache.getRawDb();
      assert(raw, 'sandbox raw db should be available');
      assertEquals(report.appliedChanges.length, 2);
      assertEquals(report.skippedChanges.length, 0);
      return readScores(raw);
    });

    assertEquals(sandboxScores, [
      { name: 'CF-Existing', arrType: 'radarr', score: 10 },
      { name: 'CF-New', arrType: 'radarr', score: 50 },
    ]);
  });
});

Deno.test('withSandboxCache: never mutates the registered current cache, never registers the sandbox', async () => {
  await withFixture(async () => {
    const current = createCurrentCache();
    setCache(DATABASE_ID, current.cache);

    try {
      assertEquals(getCache(DATABASE_ID), current.cache, 'current cache is the registered one before the run');
      const before = readScores(current.sqlite);
      assertEquals(before, [{ name: 'CF-Existing', arrType: 'radarr', score: 50 }]);

      const changeNew: ProposedChange = {
        kind: 'set_cf_score',
        profileName: 'Primary',
        customFormatName: 'CF-New',
        score: 50,
      };
      const changeExisting: ProposedChange = {
        kind: 'set_cf_score',
        profileName: 'Primary',
        customFormatName: 'CF-Existing',
        score: 10,
      };
      const edits = new Map<string, ProfileEdit>([
        [
          'Primary',
          editFor(
            [
              { customFormatName: 'CF-New', arrType: 'radarr', score: 50 },
              { customFormatName: 'CF-Existing', arrType: 'radarr', score: 10 },
            ],
            [changeNew, changeExisting]
          ),
        ],
      ]);

      await withSandboxCache(DATABASE_ID, edits, async (sandboxCache) => {
        // The sandbox is a distinct instance, never the registered current cache.
        assert(sandboxCache !== current.cache, 'sandbox must not be the current cache');
        assertEquals(getCache(DATABASE_ID), current.cache, 'registry still returns the current cache during the run');
      });

      // Source config is byte-identical after the sandbox run (no pcd_ops write, no live mutation).
      assertEquals(readScores(current.sqlite), before);
      assertEquals(getCache(DATABASE_ID), current.cache, 'registry unchanged after the run');
    } finally {
      deleteCache(DATABASE_ID);
      await current.destroy();
    }
  });
});

Deno.test('withSandboxCache: closes the sandbox across repeated runs and when fn throws', async () => {
  await withFixture(async () => {
    const edits = new Map<string, ProfileEdit>([
      [
        'Primary',
        editFor(
          [{ customFormatName: 'CF-New', arrType: 'radarr', score: 5 }],
          [{ kind: 'set_cf_score', profileName: 'Primary', customFormatName: 'CF-New', score: 5 }]
        ),
      ],
    ]);

    // Repeated runs: each sandbox is closed (built=false, db=null) after fn resolves.
    for (let i = 0; i < 3; i++) {
      const captured = await withSandboxCache(DATABASE_ID, edits, async (sandboxCache) => {
        assert(sandboxCache.isBuilt(), 'sandbox is built inside fn');
        return sandboxCache;
      });
      assertEquals(captured.isBuilt(), false, 'sandbox closed after run');
    }

    // Throwing fn: the finally-close still runs and the error propagates.
    const holder: { cache?: PCDCache } = {};
    await assertRejects(
      () =>
        withSandboxCache(DATABASE_ID, edits, async (sandboxCache) => {
          holder.cache = sandboxCache;
          throw new Error('boom in fn');
        }),
      Error,
      'boom in fn'
    );
    assert(holder.cache, 'captured the sandbox from the throwing fn');
    assertEquals(holder.cache.isBuilt(), false, 'sandbox closed even though fn threw');
  });
});

Deno.test(
  'withSandboxCache: a mid-profile op failure rolls back the profile earlier ops (atomic per profile)',
  async () => {
    await withFixture(async () => {
      // A valid threshold UPDATE (minimum 0 -> 20) is emitted BEFORE the per-CF ops, so it
      // applies first; the CF INSERT for a non-existent custom format then fails the FK on
      // custom_formats(name). The whole profile must be reported skipped AND the earlier
      // threshold mutation must be rolled back — not left committed in the sandbox.
      const thresholdChange: ProposedChange = {
        kind: 'set_profile_setting',
        profileName: 'Primary',
        field: 'minimum_custom_format_score',
        value: 20,
      };
      const badCfChange: ProposedChange = {
        kind: 'set_cf_score',
        profileName: 'Primary',
        customFormatName: 'DoesNotExist',
        score: 30,
      };
      const edits = new Map<string, ProfileEdit>([
        [
          'Primary',
          {
            input: {
              minimumScore: 20,
              upgradeUntilScore: 0,
              upgradeScoreIncrement: 1,
              customFormatScores: [{ customFormatName: 'DoesNotExist', arrType: 'radarr', score: 30 }],
            },
            changes: [thresholdChange, badCfChange],
          },
        ],
      ]);

      await withSandboxCache(DATABASE_ID, edits, async (sandboxCache, report) => {
        const raw = sandboxCache.getRawDb();
        assert(raw, 'sandbox raw db should be available');

        // Whole profile is reported not-applied.
        assertEquals(report.appliedChanges.length, 0);
        assertEquals(report.skippedChanges.length, 2);

        // The earlier valid threshold UPDATE was rolled back with the failed profile.
        assertEquals(readMinimumScore(raw), 0, 'partial threshold op rolled back for a skipped profile');
        // The seeded CF score is untouched, and no phantom DoesNotExist row was left behind.
        assertEquals(readScores(raw), [{ name: 'CF-Existing', arrType: 'radarr', score: 50 }]);
      });
    });
  }
);

Deno.test(
  'withSandboxCache: fail-soft — a failing profile skips ALL its changes, a valid profile applies',
  async () => {
    await withFixture(async () => {
      const goodChange: ProposedChange = {
        kind: 'set_cf_score',
        profileName: 'Primary',
        customFormatName: 'CF-New',
        score: 50,
      };
      // Build-time throw: upgradeScoreIncrement < 1.
      const badIncrementChange: ProposedChange = {
        kind: 'set_profile_setting',
        profileName: 'Primary',
        field: 'upgrade_score_increment',
        value: 0,
      };
      // Build-time { error }: profile absent from the sandbox seed.
      const missingProfileChange: ProposedChange = {
        kind: 'set_cf_score',
        profileName: 'Ghost',
        customFormatName: 'CF-New',
        score: 9,
      };

      const edits = new Map<string, ProfileEdit>([
        ['Primary', editFor([{ customFormatName: 'CF-New', arrType: 'radarr', score: 50 }], [goodChange])],
        [
          'BadIncrement',
          {
            input: { minimumScore: 0, upgradeUntilScore: 0, upgradeScoreIncrement: 0, customFormatScores: [] },
            changes: [badIncrementChange],
          },
        ],
        ['Ghost', editFor([{ customFormatName: 'CF-New', arrType: 'radarr', score: 9 }], [missingProfileChange])],
      ]);

      await withSandboxCache(DATABASE_ID, edits, async (_sandboxCache, report) => {
        assertEquals(report.appliedChanges, [goodChange]);

        const skippedChanges = report.skippedChanges.map((s) => s.change);
        assert(skippedChanges.includes(badIncrementChange), 'increment<1 profile change is skipped');
        assert(skippedChanges.includes(missingProfileChange), 'missing-profile change is skipped');
        assertEquals(report.skippedChanges.length, 2);

        const incrementSkip = report.skippedChanges.find((s) => s.change === badIncrementChange);
        assert(incrementSkip?.reason.includes('Upgrade score increment'), 'skip reason surfaces the build error');
        const ghostSkip = report.skippedChanges.find((s) => s.change === missingProfileChange);
        assert(ghostSkip?.reason.includes('Ghost'), 'skip reason names the missing profile');
      });
    });
  }
);
