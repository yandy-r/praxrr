import { assertEquals, assertNotEquals } from '@std/assert';
import {
  parseBatchTitles,
  buildRankingFromResults,
  buildComparisonResult,
  type ComparisonResult,
  type RankedRelease,
} from '../../routes/score-simulator/[databaseId]/helpers.ts';
import type { components } from '$api/v1.d.ts';

type SimulateReleaseResult = components['schemas']['SimulateReleaseResult'];
type SimulateReleaseInput = components['schemas']['SimulateReleaseInput'];
type SimulateProfileScore = components['schemas']['SimulateProfileScore'];
type MediaType = components['schemas']['MediaType'];

// ---------------------------------------------------------------------------
// Helper factory for SimulateReleaseResult
// ---------------------------------------------------------------------------

function makeResult(id: string, title: string, profileScores: SimulateProfileScore[]): SimulateReleaseResult {
  return {
    id,
    title,
    parsed: null,
    cfMatches: [],
    profileScores,
  };
}

function makeProfileScore(
  profileName: string,
  totalScore: number,
  contributions: Array<{ cfName: string; score: number }> = [],
  minimumScore = 0,
  upgradeUntilScore = 100
): SimulateProfileScore {
  return {
    profileName,
    totalScore,
    minimumScore,
    upgradeUntilScore,
    contributions,
  };
}

// ===========================================================================
// parseBatchTitles
// ===========================================================================

Deno.test('parseBatchTitles returns empty array for empty input', () => {
  assertEquals(parseBatchTitles('', 'movie'), []);
});

Deno.test('parseBatchTitles returns empty array for whitespace-only input', () => {
  assertEquals(parseBatchTitles('   \n  \n\t\n  ', 'movie'), []);
});

Deno.test('parseBatchTitles parses a single title', () => {
  const results = parseBatchTitles('Movie.2024.1080p.BluRay', 'movie');
  assertEquals(results.length, 1);
  assertEquals(results[0].title, 'Movie.2024.1080p.BluRay');
  assertEquals(results[0].type, 'movie');
  assertEquals(typeof results[0].id, 'string');
});

Deno.test('parseBatchTitles parses multiple titles', () => {
  const input = 'Title.One\nTitle.Two\nTitle.Three';
  const results = parseBatchTitles(input, 'series');
  assertEquals(results.length, 3);
  assertEquals(results[0].title, 'Title.One');
  assertEquals(results[1].title, 'Title.Two');
  assertEquals(results[2].title, 'Title.Three');
});

Deno.test('parseBatchTitles skips whitespace-only lines between titles', () => {
  const input = 'Title.One\n\n  \n\nTitle.Two';
  const results = parseBatchTitles(input, 'movie');
  assertEquals(results.length, 2);
  assertEquals(results[0].title, 'Title.One');
  assertEquals(results[1].title, 'Title.Two');
});

Deno.test('parseBatchTitles trims leading and trailing whitespace from lines', () => {
  const input = '  Title.One  \n\tTitle.Two\t';
  const results = parseBatchTitles(input, 'movie');
  assertEquals(results[0].title, 'Title.One');
  assertEquals(results[1].title, 'Title.Two');
});

Deno.test('parseBatchTitles rejects lines over 500 characters', () => {
  const longTitle = 'A'.repeat(501);
  const input = `Valid.Title\n${longTitle}\nAnother.Valid`;
  const results = parseBatchTitles(input, 'movie');
  assertEquals(results.length, 2);
  assertEquals(results[0].title, 'Valid.Title');
  assertEquals(results[1].title, 'Another.Valid');
});

Deno.test('parseBatchTitles accepts lines exactly 500 characters', () => {
  const exactTitle = 'B'.repeat(500);
  const results = parseBatchTitles(exactTitle, 'movie');
  assertEquals(results.length, 1);
  assertEquals(results[0].title, exactTitle);
});

Deno.test('parseBatchTitles preserves duplicate titles', () => {
  const input = 'Same.Title\nSame.Title';
  const results = parseBatchTitles(input, 'movie');
  assertEquals(results.length, 2);
  assertEquals(results[0].title, 'Same.Title');
  assertEquals(results[1].title, 'Same.Title');
});

Deno.test('parseBatchTitles assigns unique IDs to each item', () => {
  const input = 'Title.A\nTitle.B\nTitle.C';
  const results = parseBatchTitles(input, 'movie');
  const ids = new Set(results.map((r) => r.id));
  assertEquals(ids.size, 3);
});

Deno.test('parseBatchTitles caps results at 50', () => {
  const lines = Array.from({ length: 55 }, (_, i) => `Title.${i}`);
  const input = lines.join('\n');
  const results = parseBatchTitles(input, 'movie');
  assertEquals(results.length, 50);
});

Deno.test('parseBatchTitles propagates mediaType to type field', () => {
  const movieResults = parseBatchTitles('Title.A', 'movie');
  assertEquals(movieResults[0].type, 'movie');

  const seriesResults = parseBatchTitles('Title.A', 'series');
  assertEquals(seriesResults[0].type, 'series');
});

Deno.test('parseBatchTitles maps anime context to series release type', () => {
  const animeResults = parseBatchTitles('[SubsPlease] Title - 01 [1080p]', 'anime');
  assertEquals(animeResults[0].type, 'series');
});

// ===========================================================================
// buildRankingFromResults
// ===========================================================================

Deno.test('buildRankingFromResults returns empty array for empty results', () => {
  assertEquals(buildRankingFromResults([], 'pcd:alpha'), []);
});

Deno.test('buildRankingFromResults returns empty array when profile not found', () => {
  const results = [makeResult('1', 'Release A', [makeProfileScore('pcd:alpha', 10)])];
  assertEquals(buildRankingFromResults(results, 'pcd:missing'), []);
});

Deno.test('buildRankingFromResults returns empty if profile missing from any result', () => {
  const results = [
    makeResult('1', 'Release A', [makeProfileScore('pcd:alpha', 10)]),
    makeResult('2', 'Release B', [makeProfileScore('pcd:beta', 5)]),
  ];
  assertEquals(buildRankingFromResults(results, 'pcd:alpha'), []);
});

Deno.test('buildRankingFromResults ranks a single result as rank 1', () => {
  const results = [makeResult('1', 'Release A', [makeProfileScore('pcd:alpha', 10)])];
  const ranked = buildRankingFromResults(results, 'pcd:alpha');
  assertEquals(ranked.length, 1);
  assertEquals(ranked[0].rank, 1);
  assertEquals(ranked[0].totalScore, 10);
  assertEquals(ranked[0].title, 'Release A');
});

Deno.test('buildRankingFromResults sorts by descending score', () => {
  const results = [
    makeResult('1', 'Low', [makeProfileScore('pcd:alpha', 5)]),
    makeResult('2', 'High', [makeProfileScore('pcd:alpha', 20)]),
    makeResult('3', 'Mid', [makeProfileScore('pcd:alpha', 10)]),
  ];
  const ranked = buildRankingFromResults(results, 'pcd:alpha');
  assertEquals(ranked[0].title, 'High');
  assertEquals(ranked[0].rank, 1);
  assertEquals(ranked[1].title, 'Mid');
  assertEquals(ranked[1].rank, 2);
  assertEquals(ranked[2].title, 'Low');
  assertEquals(ranked[2].rank, 3);
});

Deno.test('buildRankingFromResults breaks ties by matchedCfCount descending', () => {
  const results = [
    makeResult('1', 'Few CFs', [
      makeProfileScore('pcd:alpha', 10, [
        { cfName: 'cf1', score: 5 },
        { cfName: 'cf2', score: 0 },
      ]),
    ]),
    makeResult('2', 'More CFs', [
      makeProfileScore('pcd:alpha', 10, [
        { cfName: 'cf1', score: 5 },
        { cfName: 'cf2', score: 3 },
        { cfName: 'cf3', score: 2 },
      ]),
    ]),
  ];
  const ranked = buildRankingFromResults(results, 'pcd:alpha');
  assertEquals(ranked[0].title, 'More CFs');
  assertEquals(ranked[1].title, 'Few CFs');
});

Deno.test('buildRankingFromResults breaks ties by title alphabetical', () => {
  const results = [
    makeResult('1', 'Zebra', [makeProfileScore('pcd:alpha', 10)]),
    makeResult('2', 'Alpha', [makeProfileScore('pcd:alpha', 10)]),
  ];
  const ranked = buildRankingFromResults(results, 'pcd:alpha');
  assertEquals(ranked[0].title, 'Alpha');
  assertEquals(ranked[1].title, 'Zebra');
});

Deno.test('buildRankingFromResults assigns tied ranks and skips for next', () => {
  const results = [
    makeResult('1', 'A', [makeProfileScore('pcd:alpha', 20)]),
    makeResult('2', 'B', [makeProfileScore('pcd:alpha', 10)]),
    makeResult('3', 'C', [makeProfileScore('pcd:alpha', 10)]),
    makeResult('4', 'D', [makeProfileScore('pcd:alpha', 5)]),
  ];
  const ranked = buildRankingFromResults(results, 'pcd:alpha');
  assertEquals(ranked[0].rank, 1);
  assertEquals(ranked[0].title, 'A');
  assertEquals(ranked[1].rank, 2);
  assertEquals(ranked[2].rank, 2);
  assertEquals(ranked[3].rank, 4);
});

Deno.test('buildRankingFromResults handles all-zero scores with tied rank 1', () => {
  const results = [
    makeResult('1', 'A', [makeProfileScore('pcd:alpha', 0)]),
    makeResult('2', 'B', [makeProfileScore('pcd:alpha', 0)]),
    makeResult('3', 'C', [makeProfileScore('pcd:alpha', 0)]),
  ];
  const ranked = buildRankingFromResults(results, 'pcd:alpha');
  assertEquals(ranked.length, 3);
  assertEquals(ranked[0].rank, 1);
  assertEquals(ranked[1].rank, 1);
  assertEquals(ranked[2].rank, 1);
});

Deno.test('buildRankingFromResults computes matchedCfCount from non-zero contributions', () => {
  const results = [
    makeResult('1', 'Release', [
      makeProfileScore('pcd:alpha', 15, [
        { cfName: 'cf1', score: 10 },
        { cfName: 'cf2', score: 0 },
        { cfName: 'cf3', score: 5 },
      ]),
    ]),
  ];
  const ranked = buildRankingFromResults(results, 'pcd:alpha');
  assertEquals(ranked[0].matchedCfCount, 2);
  assertEquals(ranked[0].totalCfCount, 3);
});

// ===========================================================================
// buildComparisonResult
// ===========================================================================

Deno.test('buildComparisonResult returns null when profileA is missing', () => {
  const result = makeResult('1', 'Release', [makeProfileScore('pcd:beta', 10)]);
  assertEquals(buildComparisonResult(result, 'pcd:missing', 'pcd:beta'), null);
});

Deno.test('buildComparisonResult returns null when profileB is missing', () => {
  const result = makeResult('1', 'Release', [makeProfileScore('pcd:alpha', 10)]);
  assertEquals(buildComparisonResult(result, 'pcd:alpha', 'pcd:missing'), null);
});

Deno.test('buildComparisonResult returns null when both profiles are missing', () => {
  const result = makeResult('1', 'Release', []);
  assertEquals(buildComparisonResult(result, 'pcd:alpha', 'pcd:beta'), null);
});

Deno.test('buildComparisonResult computes correct deltas', () => {
  const result = makeResult('1', 'Release', [
    makeProfileScore('pcd:alpha', 10, [
      { cfName: 'cf1', score: 5 },
      { cfName: 'cf2', score: 5 },
    ]),
    makeProfileScore('pcd:beta', 18, [
      { cfName: 'cf1', score: 8 },
      { cfName: 'cf2', score: 10 },
    ]),
  ]);

  const comparison = buildComparisonResult(result, 'pcd:alpha', 'pcd:beta');
  assertNotEquals(comparison, null);

  assertEquals(comparison!.profileAName, 'pcd:alpha');
  assertEquals(comparison!.profileBName, 'pcd:beta');
  assertEquals(comparison!.profileATotal, 10);
  assertEquals(comparison!.profileBTotal, 18);
  assertEquals(comparison!.totalDelta, 8);

  const cf1 = comparison!.contributions.find((c) => c.cfName === 'cf1');
  assertEquals(cf1?.scoreA, 5);
  assertEquals(cf1?.scoreB, 8);
  assertEquals(cf1?.delta, 3);

  const cf2 = comparison!.contributions.find((c) => c.cfName === 'cf2');
  assertEquals(cf2?.scoreA, 5);
  assertEquals(cf2?.scoreB, 10);
  assertEquals(cf2?.delta, 5);
});

Deno.test('buildComparisonResult handles zero deltas', () => {
  const result = makeResult('1', 'Release', [
    makeProfileScore('pcd:alpha', 10, [{ cfName: 'cf1', score: 10 }]),
    makeProfileScore('pcd:beta', 10, [{ cfName: 'cf1', score: 10 }]),
  ]);

  const comparison = buildComparisonResult(result, 'pcd:alpha', 'pcd:beta');
  assertNotEquals(comparison, null);
  assertEquals(comparison!.totalDelta, 0);
  assertEquals(comparison!.contributions[0].delta, 0);
});

Deno.test('buildComparisonResult treats disjoint CFs as score 0 for missing side', () => {
  const result = makeResult('1', 'Release', [
    makeProfileScore('pcd:alpha', 5, [{ cfName: 'only-in-a', score: 5 }]),
    makeProfileScore('pcd:beta', 8, [{ cfName: 'only-in-b', score: 8 }]),
  ]);

  const comparison = buildComparisonResult(result, 'pcd:alpha', 'pcd:beta');
  assertNotEquals(comparison, null);

  const onlyInA = comparison!.contributions.find((c) => c.cfName === 'only-in-a');
  assertEquals(onlyInA?.scoreA, 5);
  assertEquals(onlyInA?.scoreB, 0);
  assertEquals(onlyInA?.delta, -5);

  const onlyInB = comparison!.contributions.find((c) => c.cfName === 'only-in-b');
  assertEquals(onlyInB?.scoreA, 0);
  assertEquals(onlyInB?.scoreB, 8);
  assertEquals(onlyInB?.delta, 8);
});

Deno.test('buildComparisonResult sorts contributions by absolute delta descending', () => {
  const result = makeResult('1', 'Release', [
    makeProfileScore('pcd:alpha', 30, [
      { cfName: 'small', score: 10 },
      { cfName: 'large', score: 5 },
      { cfName: 'medium', score: 15 },
    ]),
    makeProfileScore('pcd:beta', 30, [
      { cfName: 'small', score: 12 },
      { cfName: 'large', score: 15 },
      { cfName: 'medium', score: 3 },
    ]),
  ]);

  const comparison = buildComparisonResult(result, 'pcd:alpha', 'pcd:beta');
  assertNotEquals(comparison, null);

  // deltas: small=+2, large=+10, medium=-12
  // sorted by |delta| desc: medium(12), large(10), small(2)
  assertEquals(comparison!.contributions[0].cfName, 'medium');
  assertEquals(comparison!.contributions[0].delta, -12);
  assertEquals(comparison!.contributions[1].cfName, 'large');
  assertEquals(comparison!.contributions[1].delta, 10);
  assertEquals(comparison!.contributions[2].cfName, 'small');
  assertEquals(comparison!.contributions[2].delta, 2);
});

Deno.test('buildComparisonResult totalDelta equals profileB.totalScore minus profileA.totalScore', () => {
  const result = makeResult('1', 'Release', [
    makeProfileScore('pcd:alpha', 25, [{ cfName: 'cf1', score: 25 }]),
    makeProfileScore('pcd:beta', 7, [{ cfName: 'cf1', score: 7 }]),
  ]);

  const comparison = buildComparisonResult(result, 'pcd:alpha', 'pcd:beta');
  assertNotEquals(comparison, null);
  assertEquals(comparison!.totalDelta, -18);
});
