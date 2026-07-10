import { json, type RequestHandler } from '@sveltejs/kit';
import { readJsonObjectBody, parseGoalRequest, buildGoalPlan } from '$lib/server/goals/planRequest.ts';
import { computeGoalConfigDiff } from '$lib/server/goals/computeConfigDiff.ts';
import { toWirePlan } from '$lib/server/goals/responses.ts';
import type { components } from '$api/v1.d.ts';

type GoalPreviewResponse = components['schemas']['GoalPreviewResponse'];

/**
 * POST /api/v1/goals/preview — translate a goal into a scoring + quality-ladder plan and return it
 * plus the authoritative sandbox config diff. Non-persisting: scores and ladder ops are compiled only
 * inside an ephemeral sandbox cache (via the shared `computeGoalConfigDiff` that apply also uses), so
 * `pcd_ops` and the live cache are untouched.
 */
export const POST: RequestHandler = async ({ request }) => {
  const goalRequest = parseGoalRequest(await readJsonObjectBody(request));
  const { cache, plan } = await buildGoalPlan(goalRequest);

  const { configDiff, appliedChanges, skippedChanges } = await computeGoalConfigDiff(
    cache,
    goalRequest.databaseId,
    goalRequest.arrType,
    goalRequest.profileName,
    plan
  );

  return json({
    plan: toWirePlan(plan),
    configDiff,
    appliedChanges,
    skippedChanges
  } satisfies GoalPreviewResponse);
};
