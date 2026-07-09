import { assert, assertEquals } from '@std/assert';

import { computeGoalPlan, diffGoalPlans } from '$shared/goals/engine.ts';
import { resolvePreset } from '$shared/goals/presets.ts';
import { GOALS_ENGINE_VERSION } from '$shared/goals/types.ts';
import type { CfFacts, GoalPresetId, GoalWeights } from '$shared/goals/types.ts';

function cf(name: string, tags: string[]): CfFacts {
  return { name, tags, description: null };
}

/** A curated fixture spanning every scoring path (reward, HDR, audio, tier, resolution, unwanted, uncategorized). */
const FIXTURE: CfFacts[] = [
  cf('2160p Remux', ['Source']),
  cf('Dolby Vision', ['Colour Grade', 'HDR']),
  cf('HDR10', ['Colour Grade', 'HDR']),
  cf('TrueHD', ['Audio']),
  cf('Remux Tier 1', ['Release Group Tier', 'Remux']),
  cf('1080p Bluray', ['Source']),
  cf('IMAX', ['Edition']),
  cf('AMZN', ['Streaming Service', 'WEB-DL']),
  cf('Banned Groups', ['Banned', 'Release Group']),
  cf('x265 (Bluray)', ['Codec'])
];

function planFor(preset: GoalPresetId, weights?: Partial<GoalWeights>) {
  const p = resolvePreset(preset)!;
  return computeGoalPlan({
    arrType: 'radarr',
    weights: { ...p.weights, ...weights },
    presetBaseUpgrade: p.baseUpgrade,
    customFormats: FIXTURE
  });
}

function scoreOf(plan: ReturnType<typeof computeGoalPlan>, name: string): number | undefined {
  return plan.decisions.find((d) => d.customFormatName === name)?.score;
}

Deno.test('engine: Best Quality golden score map (bedrock — pins the policy)', () => {
  const plan = planFor('best-quality');
  const expected: Record<string, number> = {
    '2160p Remux': 1400, // remux 700 + quality +700; level 3 == 2160p ceiling -> policy stands
    'Dolby Vision': 680, // 200 + compat(-500*-0.4=+200) + hdr(700*0.4=+280)
    HDR10: 540, // 300 + compat(+40) + hdr(+200)
    TrueHD: 780, // 400 + quality(+300) + compat(+80)
    'Remux Tier 1': 500, // 350 + quality(+150)
    '1080p Bluray': 50, // resolution level 2 < ceiling 3 -> below +50
    IMAX: 250, // 150 + quality(+100)
    AMZN: 60, // 100 + compat(100*-0.4=-40)
    'Banned Groups': -10000 // fixed unwanted sentinel
  };
  for (const [name, score] of Object.entries(expected)) {
    assertEquals(scoreOf(plan, name), score, `${name} score`);
  }
  assertEquals(plan.thresholds, { minimumScore: -15, upgradeUntilScore: 2000, upgradeScoreIncrement: 1 });
});

Deno.test('engine: Balanced golden — 1080p ceiling demotes 2160p remux, rewards 1080p', () => {
  const plan = planFor('balanced');
  assertEquals(scoreOf(plan, '2160p Remux'), -500); // level 3 > 1080p ceiling -> above
  assertEquals(scoreOf(plan, '1080p Bluray'), 200); // level 2 == ceiling -> match
  assertEquals(scoreOf(plan, 'HDR10'), 290); // 300 + compat(-100*0.1=-10)
  assertEquals(scoreOf(plan, 'TrueHD'), 380); // 400 + compat(-200*0.1=-20)
  assertEquals(scoreOf(plan, 'Banned Groups'), -10000);
  assertEquals(plan.thresholds, { minimumScore: -20, upgradeUntilScore: 600, upgradeScoreIncrement: 1 });
});

Deno.test('engine: additive contributions sum exactly to the score', () => {
  const plan = planFor('best-quality');
  for (const decision of plan.decisions) {
    if (decision.category === 'unwanted' || decision.category === 'resolution') continue;
    if (decision.reason.ceiling === 'above') continue; // demotion replaces the policy score
    const sum = decision.reason.base + decision.reason.axisContributions.reduce((acc, c) => acc + c.delta, 0);
    assertEquals(sum, decision.score, `${decision.customFormatName} contributions`);
  }
});

Deno.test('engine: coverage and uncategorized handling', () => {
  const plan = planFor('best-quality');
  assertEquals(plan.coverage, { total: 10, scored: 9, uncategorized: 1 });
  assertEquals(plan.uncategorized.map((u) => u.name), ['x265 (Bluray)']);
  // Uncategorized CFs are never emitted into the scoring input (existing scores left untouched).
  assert(!plan.scoringInput.customFormatScores.some((s) => s.customFormatName === 'x265 (Bluray)'));
  // Every emitted score carries a concrete arrType, never 'all'.
  assert(plan.scoringInput.customFormatScores.every((s) => s.arrType === 'radarr'));
  assertEquals(plan.engineVersion, GOALS_ENGINE_VERSION);
});

Deno.test('engine: monotonicity — quality-vs-size never lowers remux; hdr never lowers HDR', () => {
  let prevRemux = -Infinity;
  let prevHdr = -Infinity;
  for (let v = 0; v <= 100; v += 10) {
    const remux = scoreOf(planFor('best-quality', { qualityVsSize: v, resolutionCeiling: '2160p' }), '2160p Remux')!;
    assert(remux >= prevRemux, `remux dropped at qualityVsSize=${v}`);
    prevRemux = remux;

    const hdr = scoreOf(planFor('best-quality', { hdrPreference: v }), 'HDR10')!;
    assert(hdr >= prevHdr, `HDR dropped at hdrPreference=${v}`);
    prevHdr = hdr;
  }
});

Deno.test('engine: deterministic and order-invariant', () => {
  const a = planFor('balanced');
  const b = planFor('balanced');
  assertEquals(a, b);

  const shuffled = computeGoalPlan({
    arrType: 'radarr',
    weights: resolvePreset('balanced')!.weights,
    presetBaseUpgrade: resolvePreset('balanced')!.baseUpgrade,
    customFormats: [...FIXTURE].reverse()
  });
  assertEquals(shuffled.decisions, a.decisions);
  assertEquals(shuffled.scoringInput, a.scoringInput);
});

Deno.test('engine: diffGoalPlans reports per-CF and threshold deltas', () => {
  const best = planFor('best-quality');
  const balanced = planFor('balanced');
  const diff = diffGoalPlans(best, balanced);

  const remuxDelta = diff.scoreChanges.find((c) => c.customFormatName === '2160p Remux');
  assertEquals(remuxDelta, { customFormatName: '2160p Remux', from: 1400, to: -500, delta: -1900 });

  const upgrade = diff.thresholdChanges.find((c) => c.field === 'upgradeUntilScore');
  assertEquals(upgrade, { field: 'upgradeUntilScore', from: 2000, to: 600 });

  // Diffing a plan against itself yields no changes.
  assertEquals(diffGoalPlans(best, best), { scoreChanges: [], thresholdChanges: [] });
});
