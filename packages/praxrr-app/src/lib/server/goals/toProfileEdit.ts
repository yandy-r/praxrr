/**
 * Adapt a {@link GoalPlan} to a sandbox {@link ProfileEdit} for non-persisting preview (issue #20).
 *
 * The plan's `scoringInput` IS the sandbox edit; the synthesized {@link ProposedChange} list only
 * drives per-change attribution in the sandbox report (applied vs skipped). The actual sandbox
 * mutation is compiled from `scoringInput` by `buildScoringOps`, exactly as the impact simulator does.
 */

import type { GoalPlan } from '$shared/goals/index.ts';
import type { ProfileEdit } from '$pcd/sandbox/withSandboxCache.ts';
import type { components } from '$api/v1.d.ts';

type ProposedChange = components['schemas']['ProposedChange'];

/** Build the `ProfileEdit` for one profile from a goal plan. */
export function toProfileEdit(profileName: string, plan: GoalPlan): ProfileEdit {
  const changes: ProposedChange[] = plan.decisions.map((decision) => ({
    profileName,
    kind: 'set_cf_score',
    customFormatName: decision.customFormatName,
    score: decision.score
  }));

  changes.push(
    {
      profileName,
      kind: 'set_profile_setting',
      field: 'minimum_custom_format_score',
      value: plan.thresholds.minimumScore
    },
    {
      profileName,
      kind: 'set_profile_setting',
      field: 'upgrade_until_score',
      value: plan.thresholds.upgradeUntilScore
    },
    {
      profileName,
      kind: 'set_profile_setting',
      field: 'upgrade_score_increment',
      value: plan.thresholds.upgradeScoreIncrement
    }
  );

  // The desired quality ladder (issue #221) rides alongside the scoring input so the sandbox applies
  // both in one savepoint; `null` (no ladder change) becomes `undefined` for the optional field.
  return { input: plan.scoringInput, ladderInput: plan.ladderInput ?? undefined, changes };
}
