/**
 * Quality Goals engine (issue #20).
 *
 * The pure composition: classify every custom format, score it under the policy, derive thresholds,
 * and emit a deterministic {@link GoalPlan} whose `scoringInput` is a standard `UpdateScoringInput`
 * ready for the existing `buildScoringOps`/`updateScoring` op path. No I/O, no `Date`/`Math.random`,
 * order-invariant (output is sorted by CF name) — identical input yields deep-equal output.
 */

import type { UpdateScoringInput } from '$pcd/entities/qualityProfiles/scoring/update.ts';
import type {
  ComputeGoalPlanInput,
  GoalCfDecision,
  GoalDiff,
  GoalPlan,
  GoalReason,
  GoalScoreDelta,
  GoalThresholdDelta,
  GoalThresholds,
  GoalUncategorizedCf,
} from './types.ts';
import { GOALS_ENGINE_VERSION } from './types.ts';
import { EXCLUDED_RULE_ID, classifyCustomFormat, detectResolutionLevel } from './classifier.ts';
import { CEILING_ABOVE_PENALTY, UNWANTED_SCORE, ceilingGate, computeThresholds, scoreCategory } from './policy.ts';

function byName(a: { customFormatName: string }, b: { customFormatName: string }): number {
  return a.customFormatName < b.customFormatName ? -1 : a.customFormatName > b.customFormatName ? 1 : 0;
}

/** Score one classified custom format, resolving the ceiling-gate interaction. */
function decide(
  input: ComputeGoalPlanInput,
  name: string,
  category: GoalCfDecision['category'],
  ruleId: string,
  level: ReturnType<typeof detectResolutionLevel>
): GoalCfDecision {
  const { arrType, weights } = input;
  const base = (score: number, reason: Omit<GoalReason, 'code' | 'category' | 'ruleId'>): GoalCfDecision => ({
    customFormatName: name,
    arrType,
    category,
    score,
    reason: { code: `category.${category}`, category, ruleId, ...reason },
  });

  if (category === 'unwanted') {
    return base(UNWANTED_SCORE, { base: UNWANTED_SCORE, axisContributions: [], ceiling: null });
  }

  if (category === 'resolution') {
    // A resolution CF normally has a detectable level (the rule matched a resolution token).
    if (level === undefined) {
      return base(0, { base: 0, axisContributions: [], ceiling: null });
    }
    const gate = ceilingGate(level, weights);
    return base(gate.score, { base: gate.score, axisContributions: [], ceiling: gate.relation });
  }

  const scored = scoreCategory(category, weights, arrType);

  if (level !== undefined) {
    const gate = ceilingGate(level, weights);
    // Demotion wins: a reward format above the ceiling is demoted; at/below, the policy score stands.
    if (gate.relation === 'above') {
      return base(CEILING_ABOVE_PENALTY, { base: CEILING_ABOVE_PENALTY, axisContributions: [], ceiling: 'above' });
    }
    return base(scored.score, {
      base: scored.base,
      axisContributions: scored.axisContributions,
      ceiling: gate.relation,
    });
  }

  return base(scored.score, { base: scored.base, axisContributions: scored.axisContributions, ceiling: null });
}

/**
 * Translate a goal (preset + weights) into a concrete scoring plan for one Arr app's custom formats.
 */
export function computeGoalPlan(input: ComputeGoalPlanInput): GoalPlan {
  const decisions: GoalCfDecision[] = [];
  const uncategorized: GoalUncategorizedCf[] = [];

  for (const facts of input.customFormats) {
    const { category, ruleId } = classifyCustomFormat(facts, input.arrType);
    if (category === null) {
      // A CF dropped by the Lidarr video-only exclusion filter carries a distinct, user-facing reason
      // (AC4) so the UI can explain the skip rather than showing it as a coverage gap.
      const reason = ruleId === EXCLUDED_RULE_ID ? 'excluded.video-only-on-lidarr' : 'no-matching-rule';
      uncategorized.push({ name: facts.name, suggestedCategory: null, reason });
      continue;
    }
    // Resolution ceiling is a video concept; keep it fully inert for Lidarr (§3f/§7) so an audio CF
    // whose name/tags coincidentally contain a resolution token is never demoted or ceiling-stamped.
    const level = input.arrType === 'lidarr' ? undefined : detectResolutionLevel(facts);
    decisions.push(decide(input, facts.name, category, ruleId, level));
  }

  decisions.sort(byName);
  uncategorized.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const thresholds = computeThresholds(input.weights, input.presetBaseUpgrade);

  const scoringInput: UpdateScoringInput = {
    minimumScore: thresholds.minimumScore,
    upgradeUntilScore: thresholds.upgradeUntilScore,
    upgradeScoreIncrement: thresholds.upgradeScoreIncrement,
    // Uncategorized CFs are intentionally excluded — value guards leave their existing scores untouched.
    customFormatScores: decisions.map((decision) => ({
      customFormatName: decision.customFormatName,
      arrType: decision.arrType,
      score: decision.score,
    })),
  };

  return {
    engineVersion: GOALS_ENGINE_VERSION,
    arrType: input.arrType,
    decisions,
    uncategorized,
    thresholds,
    coverage: {
      total: input.customFormats.length,
      scored: decisions.length,
      uncategorized: uncategorized.length,
    },
    scoringInput,
  };
}

/** Pure per-CF + per-threshold diff between two plans (e.g. before/after moving a slider). */
export function diffGoalPlans(previous: GoalPlan, next: GoalPlan): GoalDiff {
  const prevScores = new Map(previous.decisions.map((d) => [d.customFormatName, d.score]));
  const nextScores = new Map(next.decisions.map((d) => [d.customFormatName, d.score]));

  const scoreChanges: GoalScoreDelta[] = [];
  const names = new Set([...prevScores.keys(), ...nextScores.keys()]);
  for (const name of [...names].sort()) {
    const from = prevScores.has(name) ? prevScores.get(name)! : null;
    const to = nextScores.has(name) ? nextScores.get(name)! : null;
    if (from === to) continue;
    scoreChanges.push({ customFormatName: name, from, to, delta: (to ?? 0) - (from ?? 0) });
  }

  const thresholdChanges: GoalThresholdDelta[] = [];
  const fields: (keyof GoalThresholds)[] = ['minimumScore', 'upgradeUntilScore', 'upgradeScoreIncrement'];
  for (const field of fields) {
    if (previous.thresholds[field] !== next.thresholds[field]) {
      thresholdChanges.push({ field, from: previous.thresholds[field], to: next.thresholds[field] });
    }
  }

  return { scoreChanges, thresholdChanges };
}
