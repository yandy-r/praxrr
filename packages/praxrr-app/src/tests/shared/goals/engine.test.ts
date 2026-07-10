import { assert, assertEquals, assertThrows } from '@std/assert';

import { computeGoalPlan, diffGoalPlans } from '$shared/goals/engine.ts';
import { resolvePreset } from '$shared/goals/presets.ts';
import { scoreCategory } from '$shared/goals/policy.ts';
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
  cf('x265 (Bluray)', ['Codec']),
];

function planFor(preset: GoalPresetId, weights?: Partial<GoalWeights>) {
  const p = resolvePreset(preset)!;
  return computeGoalPlan({
    arrType: 'radarr',
    weights: { ...p.weights, ...weights },
    presetBaseUpgrade: p.baseUpgrade,
    customFormats: FIXTURE,
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
    'Banned Groups': -10000, // fixed unwanted sentinel
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
  assertEquals(
    plan.uncategorized.map((u) => u.name),
    ['x265 (Bluray)']
  );
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
    customFormats: [...FIXTURE].reverse(),
  });
  assertEquals(shuffled.decisions, a.decisions);
  assertEquals(shuffled.scoringInput, a.scoringInput);
});

// --- Lidarr audio domain (#222) ------------------------------------------------------------------

/** The 3 real Lidarr CFs + a video-only CF (excluded) + a codec CF (unmatched). */
const LIDARR_FIXTURE: CfFacts[] = [
  cf('Lidarr - FLAC (Praxrr)', ['Audio']),
  cf('Lidarr - AAC (Praxrr)', ['Audio']),
  cf('Lidarr - Opus (Praxrr)', ['Audio']),
  cf('Dolby Vision', ['Colour Grade', 'HDR']),
  cf('x265 (Bluray)', ['Codec']),
];

// qualityVsSize=100 (signed +1), compatibility=0 (signed -1), hdrPreference=50 (signed 0, inert).
const LIDARR_WEIGHTS: GoalWeights = {
  qualityVsSize: 100,
  compatibility: 0,
  hdrPreference: 50,
  unwantedStrictness: 100,
  resolutionCeiling: '1080p',
};

function lidarrPlan() {
  return computeGoalPlan({
    arrType: 'lidarr',
    weights: LIDARR_WEIGHTS,
    presetBaseUpgrade: 500,
    customFormats: LIDARR_FIXTURE,
  });
}

Deno.test('engine: lidarr audio golden score map (pins LIDARR_AUDIO_POLICY)', () => {
  const plan = lidarrPlan();
  assertEquals(scoreOf(plan, 'Lidarr - FLAC (Praxrr)'), 950); // lossless 500 + quality +300 + compat +150
  assertEquals(scoreOf(plan, 'Lidarr - AAC (Praxrr)'), 300); // advanced 250 + quality +100 + compat -50
  assertEquals(scoreOf(plan, 'Lidarr - Opus (Praxrr)'), 300);
  // hdrPreference is inert for audio (sensitivity 0) — it contributes no axis term.
  const flac = plan.decisions.find((d) => d.customFormatName === 'Lidarr - FLAC (Praxrr)')!;
  assert(!flac.reason.axisContributions.some((c) => c.axis === 'hdrPreference'));
  // Every emitted score is stamped lidarr, never 'all'.
  assert(plan.scoringInput.customFormatScores.every((s) => s.arrType === 'lidarr'));
  // u=1 -> minimumScore 0; upgradeUntil = 500 + signedWeight(100)*1000 = 1500.
  assertEquals(plan.thresholds, { minimumScore: 0, upgradeUntilScore: 1500, upgradeScoreIncrement: 1 });
});

Deno.test(
  'engine: lidarr resolution ceiling is inert — a resolution token in an audio CF name never demotes it (#222)',
  () => {
    const plan = computeGoalPlan({
      arrType: 'lidarr',
      weights: LIDARR_WEIGHTS,
      presetBaseUpgrade: 500,
      customFormats: [cf('FLAC (UHD Pure Audio)', ['Audio'])],
    });
    const decision = plan.decisions.find((d) => d.customFormatName === 'FLAC (UHD Pure Audio)')!;
    // 'uhd' maps to resolution level 3 for video, but the ceiling gate is inert for lidarr: the
    // audio-lossless score stands and the ceiling relation is null (design §3f/§7).
    assertEquals(decision.category, 'audio_lossless');
    assertEquals(decision.score, 950);
    assertEquals(decision.reason.ceiling, null);
  }
);

Deno.test('engine: lidarr excludes video-only CFs with the distinct reason (AC4)', () => {
  const plan = lidarrPlan();
  assertEquals(plan.coverage, { total: 5, scored: 3, uncategorized: 2 });
  assertEquals(plan.uncategorized.find((u) => u.name === 'Dolby Vision')?.reason, 'excluded.video-only-on-lidarr');
  assertEquals(plan.uncategorized.find((u) => u.name === 'x265 (Bluray)')?.reason, 'no-matching-rule');
});

Deno.test('engine: scoreCategory fails fast for a lidarr category with no audio-policy row (no video fallback)', () => {
  // hdr_baseline survives scoring only for radarr/sonarr; a lidarr score for it must throw, never
  // silently borrow the video magnitude.
  assertThrows(() => scoreCategory('hdr_baseline', LIDARR_WEIGHTS, 'lidarr'));
  assertEquals(scoreCategory('hdr_baseline', LIDARR_WEIGHTS, 'radarr').base, 300);
});

Deno.test('engine: lidarr audio_baseline + repack_proper policy rows are pinned (AC1)', () => {
  const plan = computeGoalPlan({
    arrType: 'lidarr',
    weights: LIDARR_WEIGHTS,
    presetBaseUpgrade: 500,
    customFormats: [cf('WMA', ['Audio']), cf('Audio Repack', ['Repack'])],
  });
  // audio_baseline: base 100 + quality round(-50*1) + compat round(150*-1) = 100 - 50 - 150 = -100
  assertEquals(scoreOf(plan, 'WMA'), -100);
  // repack_proper: base 50, all axis sensitivities 0 -> no contributions
  assertEquals(scoreOf(plan, 'Audio Repack'), 50);
});

Deno.test('engine: audio presets carry the expected weight vectors + baseUpgrade (AC1)', () => {
  assertEquals(resolvePreset('audio-lossless-priority')!.weights, {
    qualityVsSize: 100,
    compatibility: 20,
    hdrPreference: 50,
    unwantedStrictness: 85,
    resolutionCeiling: '1080p',
  });
  assertEquals(resolvePreset('audio-lossless-priority')!.baseUpgrade, 800);
  assertEquals(resolvePreset('audio-balanced')!.weights, {
    qualityVsSize: 50,
    compatibility: 55,
    hdrPreference: 50,
    unwantedStrictness: 80,
    resolutionCeiling: '1080p',
  });
  assertEquals(resolvePreset('audio-balanced')!.baseUpgrade, 500);
  assertEquals(resolvePreset('audio-space-saver')!.weights, {
    qualityVsSize: 0,
    compatibility: 80,
    hdrPreference: 50,
    unwantedStrictness: 85,
    resolutionCeiling: '1080p',
  });
  assertEquals(resolvePreset('audio-space-saver')!.baseUpgrade, 200);
});

Deno.test('engine: radarr and sonarr produce identical scores (video policy is arr-agnostic, AC5)', () => {
  const preset = resolvePreset('best-quality')!;
  const base = { weights: preset.weights, presetBaseUpgrade: preset.baseUpgrade, customFormats: FIXTURE };
  const radarr = computeGoalPlan({ arrType: 'radarr', ...base });
  const sonarr = computeGoalPlan({ arrType: 'sonarr', ...base });
  for (const decision of radarr.decisions) {
    assertEquals(scoreOf(sonarr, decision.customFormatName), decision.score, `${decision.customFormatName} score`);
  }
  assertEquals(sonarr.thresholds, radarr.thresholds);
  assert(sonarr.scoringInput.customFormatScores.every((s) => s.arrType === 'sonarr'));
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
