/**
 * Pure, bounded metadata mapper for the post-success Quality Goals decision event.
 *
 * The exact server-generated plan is the only decision source. The mapper deliberately copies an
 * allowlist instead of spreading the plan, so internal scoring input and future plan fields cannot
 * silently enter operational logs.
 */

import type {
  GoalAxisContribution,
  GoalCategory,
  GoalCeilingRelation,
  GoalCoverage,
  GoalPlan,
  GoalThresholds,
} from '$shared/goals/types.ts';

export const GOAL_DECISION_LOG_EVENT = 'quality_goal.applied' as const;
export const GOAL_DECISION_LOG_MAX_DECISIONS = 50;
export const GOAL_DECISION_LOG_MAX_IDENTIFIER_LENGTH = 128;

export interface GoalDecisionLogInput {
  readonly databaseId: number;
  readonly profileName: string;
  readonly presetId: string;
  readonly plan: GoalPlan;
}

export interface GoalDecisionLogReason {
  readonly code: string;
  readonly category: GoalCategory | null;
  readonly ruleId: string;
  readonly base: number;
  readonly axisContributions: readonly GoalAxisContribution[];
  readonly ceiling: GoalCeilingRelation | null;
}

export interface GoalDecisionLogDecision {
  readonly customFormatName: string;
  readonly score: number;
  readonly reason: GoalDecisionLogReason;
}

export interface GoalDecisionLogMetadata {
  readonly event: typeof GOAL_DECISION_LOG_EVENT;
  readonly databaseId: number;
  readonly profileName: string;
  readonly arrType: GoalPlan['arrType'];
  readonly presetId: string;
  readonly engineVersion: string;
  readonly coverage: Readonly<GoalCoverage>;
  readonly thresholds: Readonly<GoalThresholds>;
  readonly decisions: readonly GoalDecisionLogDecision[];
  readonly omittedDecisionCount: number;
  readonly uncategorizedCount: number;
}

function boundIdentifier(value: string): string {
  return value.slice(0, GOAL_DECISION_LOG_MAX_IDENTIFIER_LENGTH);
}

/** Build deterministic allowlisted metadata from the exact plan applied by the server. */
export function buildGoalDecisionLogMetadata(input: GoalDecisionLogInput): GoalDecisionLogMetadata {
  const { plan } = input;
  const decisions = plan.decisions.slice(0, GOAL_DECISION_LOG_MAX_DECISIONS).map((decision) => ({
    customFormatName: boundIdentifier(decision.customFormatName),
    score: decision.score,
    reason: {
      code: boundIdentifier(decision.reason.code),
      category: decision.reason.category,
      ruleId: boundIdentifier(decision.reason.ruleId),
      base: decision.reason.base,
      axisContributions: decision.reason.axisContributions.map((contribution) => ({
        axis: contribution.axis,
        delta: contribution.delta,
      })),
      ceiling: decision.reason.ceiling,
    },
  }));

  return {
    event: GOAL_DECISION_LOG_EVENT,
    databaseId: input.databaseId,
    profileName: boundIdentifier(input.profileName),
    arrType: plan.arrType,
    presetId: boundIdentifier(input.presetId),
    engineVersion: boundIdentifier(plan.engineVersion),
    coverage: {
      total: plan.coverage.total,
      scored: plan.coverage.scored,
      uncategorized: plan.coverage.uncategorized,
    },
    thresholds: {
      minimumScore: plan.thresholds.minimumScore,
      upgradeUntilScore: plan.thresholds.upgradeUntilScore,
      upgradeScoreIncrement: plan.thresholds.upgradeScoreIncrement,
    },
    decisions,
    omittedDecisionCount: Math.max(0, plan.decisions.length - decisions.length),
    uncategorizedCount: plan.uncategorized.length,
  };
}
