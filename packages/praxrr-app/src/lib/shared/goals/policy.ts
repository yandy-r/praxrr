/**
 * Quality Goals scoring policy (issue #20).
 *
 * Pure, deterministic math turning a classified category + resolved slider weights into an integer
 * score, plus the additive per-axis contributions that make each number explainable ("remux +1400 =
 * base +700, quality-favored +700"). The engine uses ITS OWN coherent internal scale (rewards in the
 * hundreds/low-thousands, a fixed `-10000` unwanted hard-reject) — it generates a fresh, transparent
 * configuration from intent rather than reproducing any particular pre-existing score set. Golden
 * fixtures pin whatever this policy produces.
 *
 * All arithmetic is integer (`Math.round`); the displayed axis contributions sum exactly to the score.
 */

import type { GoalAxisContribution, GoalCategory, GoalCeilingRelation, GoalThresholds, GoalWeights } from './types.ts';
import type { ResolutionLevel } from './classifier.ts';

/** The weight axes that participate in category scoring (excludes the one-directional strictness axis). */
type PolicyAxis = 'qualityVsSize' | 'compatibility' | 'hdrPreference';

/** Fixed hard-reject sentinel for unwanted formats; dominates any sum of reward scores. */
export const UNWANTED_SCORE = -10000;

/** Ceiling-gate score bands (bounded additive demotion, not a sentinel). */
export const CEILING_ABOVE_PENALTY = -500;
export const CEILING_MATCH_BONUS = 200;
export const CEILING_BELOW_BONUS = 50;

/** Span the upgrade-until ceiling moves across the full quality-vs-size range. */
export const UPGRADE_SPAN = 1000;

const SCORE_CLAMP = 10000;

/** Per-category base score + per-axis sensitivities (score points per unit of signed weight). */
interface PolicyRow {
  base: number;
  qualityVsSize: number;
  compatibility: number;
  hdrPreference: number;
}

/**
 * The single tunable policy table. `unwanted` (fixed sentinel) and `resolution` (ceiling gate) are
 * scored specially and intentionally absent here.
 */
export const CATEGORY_POLICY: Readonly<Record<Exclude<GoalCategory, 'unwanted' | 'resolution'>, PolicyRow>> = {
  remux: { base: 700, qualityVsSize: 700, compatibility: 0, hdrPreference: 0 },
  audio_lossless: { base: 400, qualityVsSize: 300, compatibility: -200, hdrPreference: 0 },
  audio_advanced: { base: 300, qualityVsSize: 150, compatibility: -300, hdrPreference: 0 },
  audio_baseline: { base: 150, qualityVsSize: 50, compatibility: -50, hdrPreference: 0 },
  hdr_baseline: { base: 300, qualityVsSize: 0, compatibility: -100, hdrPreference: 500 },
  hdr_hdr10plus: { base: 350, qualityVsSize: 0, compatibility: -200, hdrPreference: 600 },
  hdr_dv: { base: 200, qualityVsSize: 0, compatibility: -500, hdrPreference: 700 },
  release_group_tier_1: { base: 350, qualityVsSize: 150, compatibility: 0, hdrPreference: 0 },
  release_group_tier_2: { base: 150, qualityVsSize: 75, compatibility: 0, hdrPreference: 0 },
  release_group_tier_3: { base: 50, qualityVsSize: 25, compatibility: 0, hdrPreference: 0 },
  streaming_service: { base: 100, qualityVsSize: 0, compatibility: 100, hdrPreference: 0 },
  movie_version: { base: 150, qualityVsSize: 100, compatibility: 0, hdrPreference: 0 },
  repack_proper: { base: 5, qualityVsSize: 0, compatibility: 0, hdrPreference: 0 }
};

const WEIGHT_AXES: readonly PolicyAxis[] = ['qualityVsSize', 'compatibility', 'hdrPreference'];

function clamp(value: number): number {
  return Math.max(-SCORE_CLAMP, Math.min(SCORE_CLAMP, value));
}

/** Signed weight in `[-1, 1]` from a 0..100 slider position. */
export function signedWeight(value: number): number {
  return (value - 50) / 50;
}

/** One-directional strictness in `[0, 1]` from a 0..100 slider position. */
export function strictness(value: number): number {
  return value / 100;
}

/** Ordinal for the resolution ceiling matching {@link ResolutionLevel}: 720p → 1, 1080p → 2, 2160p → 3. */
export function ceilingLevel(weights: GoalWeights): 1 | 2 | 3 {
  switch (weights.resolutionCeiling) {
    case '720p':
      return 1;
    case '1080p':
      return 2;
    case '2160p':
      return 3;
  }
}

export interface CategoryScore {
  score: number;
  base: number;
  axisContributions: GoalAxisContribution[];
}

/**
 * Score a category (other than `unwanted`/`resolution`) for the given weights. Contributions are
 * rounded per-axis so they sum exactly to `base + Σ contributions`, which is then clamped.
 */
export function scoreCategory(
  category: Exclude<GoalCategory, 'unwanted' | 'resolution'>,
  weights: GoalWeights
): CategoryScore {
  const row = CATEGORY_POLICY[category];
  const axisContributions: GoalAxisContribution[] = [];
  let total = row.base;

  for (const axis of WEIGHT_AXES) {
    const sensitivity = row[axis];
    if (sensitivity === 0) continue;
    const delta = Math.round(sensitivity * signedWeight(weights[axis]));
    axisContributions.push({ axis, delta });
    total += delta;
  }

  return { score: clamp(total), base: row.base, axisContributions };
}

export interface CeilingGateResult {
  score: number;
  relation: GoalCeilingRelation;
}

/** Score a resolution level against the chosen ceiling. */
export function ceilingGate(level: ResolutionLevel, weights: GoalWeights): CeilingGateResult {
  const ceiling = ceilingLevel(weights);
  if (level > ceiling) return { score: CEILING_ABOVE_PENALTY, relation: 'above' };
  if (level === ceiling) return { score: CEILING_MATCH_BONUS, relation: 'match' };
  return { score: CEILING_BELOW_BONUS, relation: 'below' };
}

/**
 * Derive the three profile thresholds from the weights and the preset's base upgrade anchor.
 * Anchored (not summed from emitted scores): a strict `unwantedStrictness` raises the minimum-score
 * floor toward 0 so releases matching only penalized formats are rejected.
 */
export function computeThresholds(weights: GoalWeights, presetBaseUpgrade: number): GoalThresholds {
  const u = strictness(weights.unwantedStrictness);
  const minimumScore = Math.round(-(1 - u) * 100);
  const upgradeUntilScore = Math.max(
    minimumScore,
    presetBaseUpgrade + Math.round(signedWeight(weights.qualityVsSize) * UPGRADE_SPAN)
  );
  return { minimumScore, upgradeUntilScore, upgradeScoreIncrement: 1 };
}
