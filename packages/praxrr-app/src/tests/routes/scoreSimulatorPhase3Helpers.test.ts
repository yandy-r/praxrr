import { assertEquals, assertNotEquals } from "@std/assert";
import {
  applyScoreOverrides,
  buildComparisonResult,
  buildRankingFromResults,
  computeOverriddenTotal,
  resolveThresholdWithOverrides,
} from "../../routes/score-simulator/[databaseId]/helpers.ts";
import type { components } from "$api/v1.d.ts";

type SimulateProfileScore = components["schemas"]["SimulateProfileScore"];
type SimulateReleaseResult = components["schemas"]["SimulateReleaseResult"];

function makeProfileScore(
  profileName: string,
  totalScore: number,
  minimumScore: number,
  upgradeUntilScore: number,
  contributions: Array<{ cfName: string; score: number }>,
): SimulateProfileScore {
  return {
    profileName,
    totalScore,
    minimumScore,
    upgradeUntilScore,
    contributions,
  };
}

function makeResult(
  id: string,
  title: string,
  profileScores: SimulateProfileScore[],
): SimulateReleaseResult {
  return {
    id,
    title,
    parsed: null,
    cfMatches: [],
    profileScores,
  };
}

Deno.test("applyScoreOverrides returns new array and does not mutate input", () => {
  const contributions = [
    { cfName: "CF-One", score: 10 },
    { cfName: "CF-Two", score: -5 },
  ];
  const originalSnapshot = structuredClone(contributions);

  const overridden = applyScoreOverrides(contributions, { "CF-One": 15 });

  assertNotEquals(overridden, contributions);
  assertEquals(overridden[0] === contributions[0], false);
  assertEquals(overridden[1] === contributions[1], false);
  assertEquals(contributions, originalSnapshot);
});

Deno.test("applyScoreOverrides applies changed overrides and tracks original score", () => {
  const contributions = [
    { cfName: "CF-One", score: 10 },
    { cfName: "CF-Two", score: 20 },
  ];

  const overridden = applyScoreOverrides(contributions, {
    "CF-One": -3,
    Missing: 999,
  });

  assertEquals(overridden, [
    { cfName: "CF-One", score: -3, originalScore: 10 },
    { cfName: "CF-Two", score: 20 },
  ]);
});

Deno.test("applyScoreOverrides ignores unknown keys and unchanged overrides", () => {
  const contributions = [
    { cfName: "CF-One", score: 0 },
    { cfName: "CF-Two", score: 7 },
  ];

  const overridden = applyScoreOverrides(contributions, {
    Missing: 5,
    "CF-One": 0,
  });

  assertEquals(overridden, [
    { cfName: "CF-One", score: 0 },
    { cfName: "CF-Two", score: 7 },
  ]);
});

Deno.test("computeOverriddenTotal returns original total for empty overrides map", () => {
  const contributions = [
    { cfName: "CF-One", score: 10 },
    { cfName: "CF-Two", score: -3 },
    { cfName: "CF-Three", score: 0 },
  ];

  assertEquals(computeOverriddenTotal(contributions, {}), 7);
});

Deno.test("computeOverriddenTotal applies overrides including zero and negative values", () => {
  const contributions = [
    { cfName: "CF-One", score: 10 },
    { cfName: "CF-Two", score: 5 },
    { cfName: "CF-Three", score: 2 },
  ];

  const total = computeOverriddenTotal(contributions, {
    "CF-One": 0,
    "CF-Two": -8,
    Missing: 1000,
  });

  assertEquals(total, -6);
});

Deno.test("resolveThresholdWithOverrides returns null for null profile score", () => {
  assertEquals(resolveThresholdWithOverrides(null, { "CF-One": 50 }), null);
});

Deno.test("resolveThresholdWithOverrides keeps accepted when overrides are unchanged", () => {
  const profile = makeProfileScore("pcd:alpha", 12, 10, 20, [
    { cfName: "CF-One", score: 8 },
    { cfName: "CF-Two", score: 4 },
  ]);

  assertEquals(
    resolveThresholdWithOverrides(profile, { "CF-One": 8 }),
    "accepted",
  );
});

Deno.test("resolveThresholdWithOverrides transitions accepted to below", () => {
  const profile = makeProfileScore("pcd:alpha", 12, 10, 20, [
    { cfName: "CF-One", score: 8 },
    { cfName: "CF-Two", score: 4 },
  ]);

  assertEquals(
    resolveThresholdWithOverrides(profile, { "CF-One": 3 }),
    "below",
  );
});

Deno.test("resolveThresholdWithOverrides transitions below to accepted at minimum threshold", () => {
  const profile = makeProfileScore("pcd:alpha", 7, 10, 20, [
    { cfName: "CF-One", score: 7 },
  ]);

  assertEquals(
    resolveThresholdWithOverrides(profile, { "CF-One": 10 }),
    "accepted",
  );
});

Deno.test("resolveThresholdWithOverrides transitions accepted to upgrade-reached at upgrade threshold", () => {
  const profile = makeProfileScore("pcd:alpha", 12, 10, 20, [
    { cfName: "CF-One", score: 8 },
    { cfName: "CF-Two", score: 4 },
  ]);

  assertEquals(
    resolveThresholdWithOverrides(profile, { "CF-One": 16 }),
    "upgrade-reached",
  );
});

Deno.test("buildRankingFromResults reorders releases when overrides change profile A totals", () => {
  const ranked = buildRankingFromResults(
    [
      makeResult("1", "Release A", [
        makeProfileScore("pcd:alpha", 10, 0, 100, [{
          cfName: "CF-A",
          score: 10,
        }]),
      ]),
      makeResult("2", "Release B", [
        makeProfileScore("pcd:alpha", 8, 0, 100, [{
          cfName: "CF-B",
          score: 8,
        }]),
      ]),
    ],
    "pcd:alpha",
    null,
    {
      "CF-A": 0,
      "CF-B": 12,
    },
  );

  assertEquals(
    ranked.map((release) => ({
      title: release.title,
      rank: release.rank,
      totalScore: release.totalScore,
    })),
    [
      { title: "Release B", rank: 1, totalScore: 12 },
      { title: "Release A", rank: 2, totalScore: 0 },
    ],
  );
});

Deno.test("buildRankingFromResults reflects threshold flips after applying overrides", () => {
  const ranked = buildRankingFromResults(
    [
      makeResult("1", "Threshold Release", [
        makeProfileScore("pcd:alpha", 12, 10, 20, [
          { cfName: "CF-One", score: 8 },
          { cfName: "CF-Two", score: 4 },
        ]),
      ]),
    ],
    "pcd:alpha",
    null,
    { "CF-One": 3 },
  );

  assertEquals(ranked.length, 1);
  assertEquals(ranked[0].totalScore, 7);
  assertEquals(ranked[0].thresholdState, "below");
});

Deno.test("buildComparisonResult recalculates profile A totals and tracks original scores with overrides", () => {
  const comparison = buildComparisonResult(
    makeResult("1", "Release", [
      makeProfileScore("pcd:alpha", 15, 10, 20, [
        { cfName: "CF-One", score: 10 },
        { cfName: "CF-Two", score: 5 },
      ]),
      makeProfileScore("pcd:beta", 18, 10, 20, [
        { cfName: "CF-One", score: 8 },
        { cfName: "CF-Two", score: 10 },
      ]),
    ]),
    "pcd:alpha",
    "pcd:beta",
    { "CF-One": 4 },
  );

  assertNotEquals(comparison, null);
  assertEquals(comparison!.profileATotal, 9);
  assertEquals(comparison!.profileBTotal, 18);
  assertEquals(comparison!.totalDelta, 9);
  const overriddenContribution = comparison!.contributions.find((
    contribution,
  ) => contribution.cfName === "CF-One");
  const unchangedContribution = comparison!.contributions.find((contribution) =>
    contribution.cfName === "CF-Two"
  );

  assertEquals(overriddenContribution, {
    cfName: "CF-One",
    scoreA: 4,
    originalScoreA: 10,
    scoreB: 8,
    delta: 4,
  });
  assertEquals(unchangedContribution?.originalScoreA, undefined);
});
