import { assert, assertEquals, assertFalse } from '@std/assert';

import {
  buildGoalDecisionLogMetadata,
  GOAL_DECISION_LOG_EVENT,
  GOAL_DECISION_LOG_MAX_DECISIONS,
  GOAL_DECISION_LOG_MAX_IDENTIFIER_LENGTH,
  type GoalDecisionLogMetadata,
} from '$server/goals/decisionLog.ts';
import { sanitizeLogMeta } from '$logger/sanitizer.ts';
import type { GoalCfDecision, GoalPlan } from '$shared/goals/types.ts';

function decision(name: string, score = 1400): GoalCfDecision {
  return {
    customFormatName: name,
    arrType: 'radarr',
    category: 'remux',
    score,
    reason: {
      code: 'category.remux',
      category: 'remux',
      ruleId: 'tag.remux',
      base: 700,
      axisContributions: [{ axis: 'qualityVsSize', delta: 700 }],
      ceiling: 'match',
    },
  };
}

function plan(overrides: Partial<GoalPlan> = {}): GoalPlan {
  const decisions = overrides.decisions ?? [decision('2160p Remux')];
  const uncategorized = overrides.uncategorized ?? [
    {
      name: 'Unknown Format',
      suggestedCategory: null,
      reason: 'No classifier match',
    },
  ];

  return {
    engineVersion: '2',
    arrType: 'radarr',
    decisions,
    uncategorized,
    thresholds: {
      minimumScore: -15,
      upgradeUntilScore: 2000,
      upgradeScoreIncrement: 1,
    },
    coverage: {
      total: decisions.length + uncategorized.length,
      scored: decisions.length,
      uncategorized: uncategorized.length,
    },
    scoringInput: {
      minimumScore: -15,
      upgradeUntilScore: 2000,
      upgradeScoreIncrement: 1,
      customFormatScores: decisions.map(({ customFormatName, arrType, score }) => ({
        customFormatName,
        arrType,
        score,
      })),
    },
    ladderInput: null,
    qualityLadder: {
      ceiling: '1080p',
      cutoff: null,
      items: [],
      reshapesSiblingArrs: false,
      sharedLadderNote: null,
    },
    ...overrides,
  };
}

function metadataFor(goalPlan = plan()): GoalDecisionLogMetadata {
  return buildGoalDecisionLogMetadata({
    databaseId: 42,
    profileName: 'Movies',
    presetId: 'best-quality',
    plan: goalPlan,
  });
}

Deno.test('goal decision metadata preserves canonical scores, reasons, ceiling, and counts', () => {
  const metadata = metadataFor();

  assertEquals(metadata, {
    event: GOAL_DECISION_LOG_EVENT,
    databaseId: 42,
    profileName: 'Movies',
    arrType: 'radarr',
    presetId: 'best-quality',
    engineVersion: '2',
    coverage: { total: 2, scored: 1, uncategorized: 1 },
    thresholds: {
      minimumScore: -15,
      upgradeUntilScore: 2000,
      upgradeScoreIncrement: 1,
    },
    decisions: [
      {
        customFormatName: '2160p Remux',
        score: 1400,
        reason: {
          code: 'category.remux',
          category: 'remux',
          ruleId: 'tag.remux',
          base: 700,
          axisContributions: [{ axis: 'qualityVsSize', delta: 700 }],
          ceiling: 'match',
        },
      },
    ],
    omittedDecisionCount: 0,
    uncategorizedCount: 1,
  });
  assertFalse('scoringInput' in metadata);
  assertFalse('uncategorized' in metadata);
});

Deno.test('goal decision metadata caps decisions and every copied free-form identifier', () => {
  const longIdentifier = 'x'.repeat(GOAL_DECISION_LOG_MAX_IDENTIFIER_LENGTH + 25);
  const decisions = Array.from({ length: GOAL_DECISION_LOG_MAX_DECISIONS + 3 }, (_, index) => {
    const item = decision(`${longIdentifier}-${index}`, index);
    item.reason.code = longIdentifier;
    item.reason.ruleId = longIdentifier;
    return item;
  });
  const metadata = buildGoalDecisionLogMetadata({
    databaseId: 42,
    profileName: longIdentifier,
    presetId: longIdentifier,
    plan: plan({ engineVersion: longIdentifier, decisions, uncategorized: [] }),
  });

  assertEquals(metadata.decisions.length, GOAL_DECISION_LOG_MAX_DECISIONS);
  assertEquals(metadata.omittedDecisionCount, 3);
  assertEquals(metadata.profileName.length, GOAL_DECISION_LOG_MAX_IDENTIFIER_LENGTH);
  assertEquals(metadata.presetId.length, GOAL_DECISION_LOG_MAX_IDENTIFIER_LENGTH);
  assertEquals(metadata.engineVersion.length, GOAL_DECISION_LOG_MAX_IDENTIFIER_LENGTH);
  assert(
    metadata.decisions.every(
      ({ customFormatName, reason }) =>
        customFormatName.length <= GOAL_DECISION_LOG_MAX_IDENTIFIER_LENGTH &&
        reason.code.length <= GOAL_DECISION_LOG_MAX_IDENTIFIER_LENGTH &&
        reason.ruleId.length <= GOAL_DECISION_LOG_MAX_IDENTIFIER_LENGTH
    )
  );
});

Deno.test('goal decision metadata remains safe when nested identifiers resemble secrets', () => {
  const secret = 'sk-ABCDEFGHIJKLMNOPQRSTUVWX';
  const secretDecision = decision(`Remux ${secret}`);
  secretDecision.reason.code = secret;
  secretDecision.reason.ruleId = 'deadbeefdeadbeefdeadbeefdeadbeef';
  const sanitized = sanitizeLogMeta(
    buildGoalDecisionLogMetadata({
      databaseId: 42,
      profileName: `Movies ${secret}`,
      presetId: `https://arr.example/?apikey=${secret}`,
      plan: plan({ decisions: [secretDecision], uncategorized: [] }),
    })
  ) as GoalDecisionLogMetadata;

  assertFalse(JSON.stringify(sanitized).includes(secret));
  assertEquals(sanitized.profileName, 'Movies [REDACTED]');
  assertEquals(sanitized.presetId, 'https://arr.example/?apikey=[REDACTED]');
  assertEquals(sanitized.decisions[0].customFormatName, 'Remux [REDACTED]');
  assertEquals(sanitized.decisions[0].reason.code, '[REDACTED]');
  assertEquals(sanitized.decisions[0].reason.ruleId, '[REDACTED]');
});

Deno.test('goal decision metadata is deterministic and does not retain mutable plan objects', () => {
  const goalPlan = plan();
  const first = metadataFor(goalPlan);
  const second = metadataFor(goalPlan);

  assertEquals(first, second);
  goalPlan.coverage.total = 99;
  goalPlan.decisions[0].reason.axisContributions[0].delta = -1;
  assertEquals(first.coverage.total, 2);
  assertEquals(first.decisions[0].reason.axisContributions[0].delta, 700);
});
