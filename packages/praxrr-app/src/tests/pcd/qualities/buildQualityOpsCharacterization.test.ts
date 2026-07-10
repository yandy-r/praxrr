/**
 * Characterization test for `buildQualityLadderOps` (extracted from `updateQualities`).
 *
 * Guards the guarded-SQL generation the goal-apply path and the preview sandbox depend on: value
 * guards on every UPDATE (`AND enabled = <old>`, `AND position = <old>`, `AND upgrade_until = <old>`),
 * the clear-before-set cutoff ordering required by `idx_one_upgrade_until_per_profile`, the
 * single-`upgrade_until` THROW, `batched.queries === ops.flatMap(o => o.queries)`, the no-op
 * `batched: null`, and the `forbidRemovals` zero-removal invariant (a Sonarr goal must never DELETE a
 * Radarr-only row on the shared `quality_profile_qualities` table).
 */

import { assert, assertEquals, assertRejects } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';

import type { PCDCache } from '$pcd/index.ts';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import type { OrderedItem } from '$shared/pcd/display.ts';
import { buildQualityLadderOps, type UpdateQualitiesInput } from '$pcd/entities/qualityProfiles/qualities/index.ts';

const PCD_SCHEMA_SQL_PATH = new URL('../../../../../praxrr-schema/ops/0.schema.sql', import.meta.url);
const PCD_SCHEMA_SQL = Deno.readTextFileSync(PCD_SCHEMA_SQL_PATH);

const SEED_SQL = `
  INSERT INTO quality_profiles (id, name, minimum_custom_format_score, upgrade_until_score, upgrade_score_increment)
  VALUES (1, 'Primary', 0, 100, 1);

  INSERT INTO qualities (name) VALUES ('Bluray-2160p'), ('Bluray-1080p'), ('Bluray-720p'), ('DVD-R');

  INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES
    ('Primary', 'Bluray-2160p', NULL, 1, 0, 0),
    ('Primary', 'Bluray-1080p', NULL, 2, 1, 1),
    ('Primary', 'Bluray-720p', NULL, 3, 0, 0),
    ('Primary', 'DVD-R', NULL, 4, 1, 0);
`;

interface Fixture {
  cache: PCDCache;
  destroy: () => Promise<void>;
}

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
    }
  };
}

function q(name: string, position: number, enabled: boolean, upgradeUntil: boolean): OrderedItem {
  return { type: 'quality', name, position, enabled, upgradeUntil };
}

/** The current ladder as read back (no cutoff move, no enable change). */
const CURRENT: OrderedItem[] = [
  q('Bluray-2160p', 1, false, false),
  q('Bluray-1080p', 2, true, true),
  q('Bluray-720p', 3, false, false),
  q('DVD-R', 4, true, false)
];

async function build(cache: PCDCache, input: UpdateQualitiesInput, forbidRemovals = false) {
  return buildQualityLadderOps({ databaseId: 1, cache, layer: 'user', profileName: 'Primary', input, forbidRemovals });
}

Deno.test('buildQualityLadderOps characterization', async (t) => {
  const fixture = createFixture();
  const { cache } = fixture;

  try {
    await t.step('cutoff move emits value-guarded UPDATEs in clear-before-set order', async () => {
      // Move the cutoff from Bluray-1080p → Bluray-720p and enable Bluray-720p.
      const desired: UpdateQualitiesInput = {
        orderedItems: [
          q('Bluray-2160p', 1, false, false),
          q('Bluray-1080p', 2, true, false), // clear the old cutoff
          q('Bluray-720p', 3, true, true), // enable + set the new cutoff
          q('DVD-R', 4, true, false)
        ]
      };
      const built = await build(cache, desired);
      assert(!('error' in built), 'expected ops');
      assert(built.batched !== null, 'expected a change');

      const descriptions = built.ops.map((op) => op.description);
      assertEquals(descriptions, [
        'update-quality-profile-row-Primary-quality-Bluray-1080p',
        'update-quality-profile-row-Primary-quality-Bluray-720p'
      ]);

      const clearSql = built.ops[0].queries[0].sql;
      assert(clearSql.includes('SET upgrade_until = 0'), 'clears the old cutoff');
      assert(clearSql.includes('AND enabled = 1'), 'value-guards enabled');
      assert(clearSql.includes('AND position = 2'), 'value-guards position');
      assert(clearSql.includes('AND upgrade_until = 1'), 'value-guards the old cutoff flag');

      const setSql = built.ops[1].queries[0].sql;
      assert(setSql.includes('enabled = 1'), 'enables Bluray-720p');
      assert(setSql.includes('upgrade_until = 1'), 'sets the new cutoff');
      assert(setSql.includes('AND enabled = 0'), 'value-guards the pre-change enabled state');
      assert(setSql.includes('AND upgrade_until = 0'), 'value-guards the pre-change cutoff flag');
    });

    await t.step('batched.queries equals ops.flatMap(o => o.queries) in order', async () => {
      const desired: UpdateQualitiesInput = {
        orderedItems: [
          q('Bluray-2160p', 1, false, false),
          q('Bluray-1080p', 2, true, false),
          q('Bluray-720p', 3, true, true),
          q('DVD-R', 4, true, false)
        ]
      };
      const built = await build(cache, desired);
      assert(!('error' in built) && built.batched !== null);
      assertEquals(
        built.batched.queries.map((query) => query.sql),
        built.ops.flatMap((op) => op.queries).map((query) => query.sql)
      );
    });

    await t.step('no-op desired ladder returns batched: null', async () => {
      const built = await build(cache, { orderedItems: CURRENT });
      assert(!('error' in built), 'expected ops');
      assertEquals(built.batched, null);
      assertEquals(built.ops.length, 0);
    });

    await t.step('more than one upgrade_until THROWS', async () => {
      await assertRejects(
        () =>
          build(cache, {
            orderedItems: [
              q('Bluray-2160p', 1, false, true),
              q('Bluray-1080p', 2, true, true),
              q('Bluray-720p', 3, false, false),
              q('DVD-R', 4, true, false)
            ]
          }),
        Error,
        'Only one quality can be marked as "upgrade until"'
      );
    });

    await t.step('forbidRemovals: full-coverage desired emits zero removals, keeps Radarr-only DVD-R', async () => {
      // A Sonarr-shaped goal: enable qualities but PRESERVE the Radarr-only DVD-R row verbatim.
      const desired: UpdateQualitiesInput = {
        orderedItems: [
          q('Bluray-2160p', 1, true, false),
          q('Bluray-1080p', 2, true, true),
          q('Bluray-720p', 3, true, false),
          q('DVD-R', 4, true, false) // preserved verbatim
        ]
      };
      const built = await build(cache, desired, true);
      assert(!('error' in built), 'expected ops, not an error');
      assert(
        built.ops.every((op) => !op.description.startsWith('remove-')),
        'no DELETE/remove ops on the shared row set'
      );
    });

    await t.step('forbidRemovals: dropping a current row returns { error } (no partial write)', async () => {
      const desired: UpdateQualitiesInput = {
        orderedItems: [
          q('Bluray-2160p', 1, false, false),
          q('Bluray-1080p', 2, true, true),
          q('Bluray-720p', 3, false, false)
          // DVD-R omitted → would be a removal
        ]
      };
      const built = await build(cache, desired, true);
      assert('error' in built, 'expected an error result');
      assert(built.error.includes('DVD-R') || built.error.includes('remove'), 'error explains the forbidden removal');
    });
  } finally {
    await fixture.destroy();
  }
});
