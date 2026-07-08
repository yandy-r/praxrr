/**
 * Parity / Q2-gap test for `simulateReleaseScores`.
 *
 * Asserts per release x profile totals + thresholds against hand-computed
 * expectations, and — the Q2 gap fix — that `matchedCfScores` records EVERY
 * matched custom format including ones currently scored 0 (so a later 0 -> N
 * score edit can actually move the total). Conditions are read from a seeded
 * cache exactly as the route does; parse/pattern inputs are supplied directly,
 * so no parser service is needed.
 */

import { assert, assertEquals } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';

import type { PCDCache } from '$pcd/index.ts';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import { getAllConditionsForEvaluation } from '$pcd/entities/customFormats/index.ts';
import { simulateReleaseScores, type SimulateScoreContext } from '$pcd/simulate/simulateReleaseScores.ts';
import type { ParseResult } from '$lib/server/utils/arr/parser/types.ts';

const PCD_SCHEMA_SQL_PATH = new URL('../../../../../praxrr-schema/ops/0.schema.sql', import.meta.url);
const PCD_SCHEMA_SQL = Deno.readTextFileSync(PCD_SCHEMA_SQL_PATH);

const SEED_SQL = `
  INSERT INTO quality_profiles (id, name, minimum_custom_format_score, upgrade_until_score, upgrade_score_increment)
  VALUES (1, 'Alpha', 10, 100, 1);
  INSERT INTO quality_profiles (id, name, minimum_custom_format_score, upgrade_until_score, upgrade_score_increment)
  VALUES (2, 'Beta', 0, 0, 1);

  INSERT INTO custom_formats (name) VALUES ('CF-Pos');
  INSERT INTO custom_formats (name) VALUES ('CF-Neg');
  INSERT INTO custom_formats (name) VALUES ('CF-Zero');

  INSERT INTO regular_expressions (name, pattern) VALUES ('pos-re', 'POS');
  INSERT INTO regular_expressions (name, pattern) VALUES ('neg-re', 'NEG');
  INSERT INTO regular_expressions (name, pattern) VALUES ('zero-re', 'ZERO');

  INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type)
  VALUES ('CF-Pos', 'pos-title', 'release_title', 'all');
  INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type)
  VALUES ('CF-Neg', 'neg-title', 'release_title', 'all');
  INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type)
  VALUES ('CF-Zero', 'zero-title', 'release_title', 'all');

  INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)
  VALUES ('CF-Pos', 'pos-title', 'pos-re');
  INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)
  VALUES ('CF-Neg', 'neg-title', 'neg-re');
  INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)
  VALUES ('CF-Zero', 'zero-title', 'zero-re');

  INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
  VALUES ('Alpha', 'CF-Pos', 'radarr', 25);
  INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
  VALUES ('Alpha', 'CF-Neg', 'radarr', -5);
  INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
  VALUES ('Alpha', 'CF-Zero', 'radarr', 0);
  INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
  VALUES ('Beta', 'CF-Pos', 'radarr', 7);
`;

function createCache(): { cache: PCDCache; destroy: () => Promise<void> } {
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

Deno.test('simulateReleaseScores: totals, thresholds, and Q2 matched-but-zero recording', async () => {
  const { cache, destroy } = createCache();

  try {
    const formats = await getAllConditionsForEvaluation(cache);

    const releases: SimulateScoreContext['releases'] = [
      { id: 'r1', title: 'Movie.POS.ZERO', type: 'movie' },
      { id: 'r2', title: 'Movie.NEG', type: 'movie' },
    ];

    // No parse info — matching is driven purely by the supplied pattern results
    // (the parser-missing / without-parse evaluation path).
    const parseResults = new Map<string, ParseResult | null>();
    for (const release of releases) parseResults.set(`${release.title}:${release.type}`, null);

    const patternMatches = new Map<string, Map<string, boolean>>([
      [
        'Movie.POS.ZERO',
        new Map([
          ['POS', true],
          ['NEG', false],
          ['ZERO', true],
        ]),
      ],
      [
        'Movie.NEG',
        new Map([
          ['POS', false],
          ['NEG', true],
          ['ZERO', false],
        ]),
      ],
    ]);

    const ctx: SimulateScoreContext = {
      arrType: 'radarr',
      releases,
      profileNames: ['Alpha', 'Beta'],
      parseResults,
      patternMatches,
      formats,
    };

    const results = await simulateReleaseScores(cache, 1, ctx);
    assertEquals(results.length, 2);

    const r1 = results.find((r) => r.id === 'r1');
    const r2 = results.find((r) => r.id === 'r2');
    assert(r1 && r2);

    const r1Alpha = r1.profiles.find((p) => p.profileName === 'Alpha');
    assert(r1Alpha);
    assertEquals(r1Alpha.totalScore, 25);
    assertEquals(r1Alpha.minimumScore, 10);
    assertEquals(r1Alpha.upgradeUntilScore, 100);
    // Q2 gap fix: CF-Zero matched at score 0 is still recorded.
    assertEquals(r1Alpha.matchedCfScores.get('CF-Zero'), 0);
    assertEquals(r1Alpha.matchedCfScores.get('CF-Pos'), 25);
    assertEquals(r1Alpha.matchedCfScores.has('CF-Neg'), false);

    const r1Beta = r1.profiles.find((p) => p.profileName === 'Beta');
    assert(r1Beta);
    // Beta scores CF-Pos at 7; CF-Zero matches but Beta has no row -> 0 (still recorded).
    assertEquals(r1Beta.totalScore, 7);
    assertEquals(r1Beta.minimumScore, 0);
    assertEquals(r1Beta.upgradeUntilScore, 0);
    assertEquals(r1Beta.matchedCfScores.get('CF-Zero'), 0);
    assertEquals(r1Beta.matchedCfScores.get('CF-Pos'), 7);

    const r2Alpha = r2.profiles.find((p) => p.profileName === 'Alpha');
    assert(r2Alpha);
    assertEquals(r2Alpha.totalScore, -5);
    assertEquals(r2Alpha.matchedCfScores.get('CF-Neg'), -5);

    const r2Beta = r2.profiles.find((p) => p.profileName === 'Beta');
    assert(r2Beta);
    // Beta has no CF-Neg row -> matched at 0.
    assertEquals(r2Beta.totalScore, 0);
    assertEquals(r2Beta.matchedCfScores.get('CF-Neg'), 0);
  } finally {
    await destroy();
  }
});

Deno.test('simulateReleaseScores: unknown profile names are skipped (fail-soft)', async () => {
  const { cache, destroy } = createCache();

  try {
    const formats = await getAllConditionsForEvaluation(cache);
    const releases: SimulateScoreContext['releases'] = [{ id: 'r1', title: 'Movie.POS.ZERO', type: 'movie' }];
    const parseResults = new Map<string, ParseResult | null>([['Movie.POS.ZERO:movie', null]]);
    const patternMatches = new Map<string, Map<string, boolean>>([
      [
        'Movie.POS.ZERO',
        new Map([
          ['POS', true],
          ['ZERO', true],
        ]),
      ],
    ]);

    const results = await simulateReleaseScores(cache, 1, {
      arrType: 'radarr',
      releases,
      profileNames: ['Alpha', 'Ghost'],
      parseResults,
      patternMatches,
      formats,
    });

    assertEquals(results.length, 1);
    // Only Alpha resolves; the missing 'Ghost' profile is silently dropped.
    assertEquals(
      results[0].profiles.map((p) => p.profileName),
      ['Alpha']
    );
  } finally {
    await destroy();
  }
});
