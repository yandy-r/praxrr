/**
 * Shared "what apply will write" config diff for the Quality Goals routes (issue #221).
 *
 * Both preview and apply compute their config diff through THIS helper so they can never diverge: it
 * seeds an ephemeral sandbox with the plan's scoring + ladder edits and diffs the resolved profile
 * (current vs sandbox). Apply captures the result BEFORE persisting, so the echoed diff matches the
 * preview diff for the same plan.
 */

import { withSandboxCache, type ProfileEdit } from '$pcd/sandbox/withSandboxCache.ts';
import { buildQualityProfileConfigDiff } from '$pcd/sandbox/configDiff.ts';
import { toProfileEdit } from './toProfileEdit.ts';
import type { PCDCache } from '$pcd/index.ts';
import type { GoalArrType, GoalPlan } from '$shared/goals/index.ts';
import type { components } from '$api/v1.d.ts';

type EntityConfigDiff = components['schemas']['EntityConfigDiff'];
type ProposedChange = components['schemas']['ProposedChange'];
type SkippedChange = components['schemas']['SkippedChange'];

export interface GoalConfigDiffResult {
  configDiff: EntityConfigDiff[];
  appliedChanges: ProposedChange[];
  skippedChanges: SkippedChange[];
}

/** Run the plan through an ephemeral sandbox and return the resolved config diff + change attribution. */
export function computeGoalConfigDiff(
  cache: PCDCache,
  databaseId: number,
  arrType: GoalArrType,
  profileName: string,
  plan: GoalPlan
): Promise<GoalConfigDiffResult> {
  const edits = new Map<string, ProfileEdit>([[profileName, toProfileEdit(profileName, plan)]]);
  return withSandboxCache(databaseId, edits, async (sandboxCache, report) => ({
    configDiff: await buildQualityProfileConfigDiff(cache, sandboxCache, arrType, [profileName]),
    appliedChanges: report.appliedChanges,
    skippedChanges: report.skippedChanges
  }));
}
