/**
 * Characterization test for `buildScoringOps` (extracted from `updateScoring`).
 *
 * Guards the byte-identical op generation the impact-simulator sandbox depends on:
 * op ORDER ('all'-expansion INSERTs -> 'all' DELETE -> threshold UPDATEs -> per-CF
 * INSERT/UPDATE/DELETE), the value guards (`AND score = <current>`), the
 * INSERT-WHERE-NOT-EXISTS shape, the increment<1 THROW, and the missing-profile
 * `{ error }` return. If the extraction ever drifts from the persist path
 * (`updateScoring`), these assertions break.
 */

import { assert, assertEquals, assertRejects } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';

import type { PCDCache } from '$pcd/index.ts';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import { ARR_APP_TYPES } from '$shared/arr/capabilities.ts';
import { buildScoringOps, type UpdateScoringInput } from '$pcd/entities/qualityProfiles/scoring/update.ts';

const PCD_SCHEMA_SQL_PATH = new URL('../../../../../praxrr-schema/ops/0.schema.sql', import.meta.url);
const PCD_SCHEMA_SQL = Deno.readTextFileSync(PCD_SCHEMA_SQL_PATH);

const SEED_SQL = `
  INSERT INTO quality_profiles (id, name, minimum_custom_format_score, upgrade_until_score, upgrade_score_increment)
  VALUES (1, 'Primary', 10, 100, 1);

  INSERT INTO custom_formats (name) VALUES ('CF-Insert');
  INSERT INTO custom_formats (name) VALUES ('CF-Update');
  INSERT INTO custom_formats (name) VALUES ('CF-Delete');
  INSERT INTO custom_formats (name) VALUES ('CF-All');

  INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
  VALUES ('Primary', 'CF-Update', 'radarr', 5);
  INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
  VALUES ('Primary', 'CF-Delete', 'radarr', 7);
  INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
  VALUES ('Primary', 'CF-All', 'all', 3);
`;

interface Fixture {
  cache: PCDCache;
  destroy: () => Promise<void>;
}

/** In-memory PCD cache exposing only `kb` — all `buildScoringOps` touches. */
function createFixture(): Fixture {
  const sqlite = new Database(':memory:', { int64: true });
  const kb = new Kysely<PCDDatabase>({ dialect: new DenoSqlite3Dialect({ database: sqlite }) });
  sqlite.exec(PCD_SCHEMA_SQL);
  sqlite.exec(SEED_SQL);
  return {
    cache: { kb } as PCDCache,
    destroy: async () => {
      await kb.destroy();
      sqlite.close();
    },
  };
}

/** buildScoringOps reads only — never mutates the cache — so one fixture is reused. */
function baseInput(overrides: Partial<UpdateScoringInput> = {}): UpdateScoringInput {
  return {
    minimumScore: 10,
    upgradeUntilScore: 100,
    upgradeScoreIncrement: 1,
    customFormatScores: [],
    ...overrides,
  };
}

async function opsFor(cache: PCDCache, input: UpdateScoringInput) {
  const built = await buildScoringOps({ databaseId: 1, cache, layer: 'user', profileName: 'Primary', input });
  assert(!('error' in built), 'expected ops, got error');
  return built.ops;
}

Deno.test('buildScoringOps characterization', async (t) => {
  const fixture = createFixture();
  const { cache } = fixture;

  try {
    await t.step('0 -> N emits INSERT-WHERE-NOT-EXISTS with no value guard', async () => {
      const ops = await opsFor(
        cache,
        baseInput({ customFormatScores: [{ customFormatName: 'CF-Insert', arrType: 'radarr', score: 20 }] })
      );
      assertEquals(ops.length, 1);
      const [op] = ops;
      assertEquals(op.description, 'add-quality-profile-cf-score-Primary-radarr-CF-Insert');
      assertEquals(op.changedFields, ['custom_format_score:CF-Insert:radarr']);
      const sql = op.queries[0].sql;
      assert(sql.includes('INSERT INTO quality_profile_custom_formats'), 'expected INSERT');
      assert(sql.includes("SELECT 'Primary', 'CF-Insert', 'radarr', 20"), 'expected literal SELECT values');
      assert(sql.includes('WHERE NOT EXISTS'), 'expected WHERE NOT EXISTS guard');
      assertEquals(op.queries[0].parameters, []);
    });

    await t.step('N -> M emits a value-guarded UPDATE (AND score = current)', async () => {
      const ops = await opsFor(
        cache,
        baseInput({ customFormatScores: [{ customFormatName: 'CF-Update', arrType: 'radarr', score: 15 }] })
      );
      assertEquals(ops.length, 1);
      const [op] = ops;
      assertEquals(op.description, 'update-quality-profile-cf-score-Primary-radarr-CF-Update');
      const sql = op.queries[0].sql;
      assert(sql.includes('UPDATE quality_profile_custom_formats'), 'expected UPDATE');
      assert(sql.includes('SET score = 15'), 'expected new score');
      assert(sql.includes('AND score = 5'), 'expected value guard against current score');
      assertEquals(op.queries[0].parameters, []);
    });

    await t.step('N -> null emits a value-guarded DELETE', async () => {
      const ops = await opsFor(
        cache,
        baseInput({ customFormatScores: [{ customFormatName: 'CF-Delete', arrType: 'radarr', score: null }] })
      );
      assertEquals(ops.length, 1);
      const [op] = ops;
      assertEquals(op.description, 'remove-quality-profile-cf-score-Primary-radarr-CF-Delete');
      const sql = op.queries[0].sql;
      assert(sql.includes('DELETE FROM quality_profile_custom_formats'), 'expected DELETE');
      assert(sql.includes("AND arr_type = 'radarr'"), 'expected arr_type guard');
      assert(sql.includes('AND score = 7'), 'expected value guard against current score');
    });

    await t.step(
      "'all' -> per-arr expansion: INSERT per arr type, then DELETE the 'all' row, then the CF UPDATE",
      async () => {
        const ops = await opsFor(
          cache,
          baseInput({ customFormatScores: [{ customFormatName: 'CF-All', arrType: 'radarr', score: 8 }] })
        );

        const expandOps = ops.filter((op) => op.description.startsWith('expand-all-score-Primary-'));
        assertEquals(expandOps.length, ARR_APP_TYPES.length, 'one expansion INSERT per arr type');
        for (const arrType of ARR_APP_TYPES) {
          const expandOp = expandOps.find((op) => op.description === `expand-all-score-Primary-${arrType}-CF-All`);
          assert(expandOp, `expected expansion INSERT for ${arrType}`);
          assert(
            expandOp.queries[0].sql.includes('INSERT INTO quality_profile_custom_formats'),
            'expansion is an INSERT'
          );
          assert(
            expandOp.queries[0].sql.includes("'CF-All', '" + arrType + "', 3"),
            'expansion carries the shared all-score'
          );
        }

        const removeAll = ops.find((op) => op.description === 'remove-all-score-Primary-CF-All');
        assert(removeAll, "expected the 'all'-row DELETE");
        assert(removeAll.queries[0].sql.includes("arr_type = 'all'"), "DELETE targets the 'all' row");
        assert(removeAll.queries[0].sql.includes('AND score = 3'), 'DELETE value-guards the shared score');

        const cfUpdate = ops.find((op) => op.description === 'update-quality-profile-cf-score-Primary-radarr-CF-All');
        assert(cfUpdate, 'expected the CF-All radarr UPDATE after expansion');
        assert(cfUpdate.queries[0].sql.includes('SET score = 8'), 'CF update sets the new score');
        assert(cfUpdate.queries[0].sql.includes('AND score = 3'), 'CF update guards against the expanded value');

        // Order: all expansions -> remove-all -> the per-CF update, in that block order.
        const expandLast = ops.findIndex(
          (op) => op.description === `expand-all-score-Primary-${ARR_APP_TYPES[ARR_APP_TYPES.length - 1]}-CF-All`
        );
        const removeIdx = ops.findIndex((op) => op === removeAll);
        const updateIdx = ops.findIndex((op) => op === cfUpdate);
        assert(
          expandLast < removeIdx && removeIdx < updateIdx,
          'expansion INSERTs precede the DELETE which precedes the CF update'
        );
      }
    );

    await t.step('threshold field change emits a value-guarded UPDATE (kysely-compiled)', async () => {
      const ops = await opsFor(cache, baseInput({ minimumScore: 50 }));
      assertEquals(ops.length, 1);
      const [op] = ops;
      assertEquals(op.description, 'update-quality-profile-minimum-score-Primary');
      assertEquals(op.changedFields, ['minimum_custom_format_score']);
      // Threshold ops are kysely-compiled (parameterized), so assert on the bound params:
      // the SET value (50), the name guard ('Primary'), and the value guard (10).
      const params = op.queries[0].parameters;
      assert(params.includes(50), 'expected the new minimum in bound params');
      assert(params.includes('Primary'), 'expected the profile name guard in bound params');
      assert(params.includes(10), 'expected the old-value guard (10) in bound params');
    });

    await t.step('combined input honors the full block order', async () => {
      const ops = await opsFor(
        cache,
        baseInput({
          minimumScore: 50,
          customFormatScores: [
            { customFormatName: 'CF-All', arrType: 'radarr', score: 8 },
            { customFormatName: 'CF-Insert', arrType: 'radarr', score: 20 },
          ],
        })
      );

      assertEquals(
        ops.map((op) => op.description),
        [
          'expand-all-score-Primary-radarr-CF-All',
          'expand-all-score-Primary-sonarr-CF-All',
          'expand-all-score-Primary-lidarr-CF-All',
          'remove-all-score-Primary-CF-All',
          'update-quality-profile-minimum-score-Primary',
          'update-quality-profile-cf-score-Primary-radarr-CF-All',
          'add-quality-profile-cf-score-Primary-radarr-CF-Insert',
        ]
      );
    });

    await t.step('upgradeScoreIncrement < 1 still THROWS', async () => {
      await assertRejects(
        () =>
          buildScoringOps({
            databaseId: 1,
            cache,
            layer: 'user',
            profileName: 'Primary',
            input: baseInput({ upgradeScoreIncrement: 0 }),
          }),
        Error,
        'Upgrade score increment must be at least 1'
      );
    });

    await t.step('missing profile returns { error }, not a throw', async () => {
      const built = await buildScoringOps({
        databaseId: 1,
        cache,
        layer: 'user',
        profileName: 'Ghost',
        input: baseInput(),
      });
      assert('error' in built, 'expected an error result');
      assert(built.error.includes('Ghost'), 'error names the missing profile');
    });
  } finally {
    await fixture.destroy();
  }
});
