import { json, type RequestHandler } from '@sveltejs/kit';
import { withSandboxCache, type ProfileEdit } from '$pcd/sandbox/withSandboxCache.ts';
import { buildQualityProfileConfigDiff } from '$pcd/sandbox/configDiff.ts';
import { readJsonObjectBody, parseGoalRequest, buildGoalPlan } from '$lib/server/goals/planRequest.ts';
import { toProfileEdit } from '$lib/server/goals/toProfileEdit.ts';
import { toWirePlan } from '$lib/server/goals/responses.ts';
import type { components } from '$api/v1.d.ts';

type GoalPreviewResponse = components['schemas']['GoalPreviewResponse'];

/**
 * POST /api/v1/goals/preview — translate a goal into a scoring plan and return it plus the
 * authoritative sandbox config diff. Non-persisting: scores are compiled only inside an ephemeral
 * sandbox cache, so `pcd_ops` and the live cache are untouched.
 */
export const POST: RequestHandler = async ({ request }) => {
  const goalRequest = parseGoalRequest(await readJsonObjectBody(request));
  const { cache, plan } = await buildGoalPlan(goalRequest);

  const edits = new Map<string, ProfileEdit>([[goalRequest.profileName, toProfileEdit(goalRequest.profileName, plan)]]);

  const { configDiff, appliedChanges, skippedChanges } = await withSandboxCache(
    goalRequest.databaseId,
    edits,
    async (sandboxCache, report) => ({
      configDiff: await buildQualityProfileConfigDiff(cache, sandboxCache, goalRequest.arrType, [
        goalRequest.profileName
      ]),
      appliedChanges: report.appliedChanges,
      skippedChanges: report.skippedChanges
    })
  );

  return json({
    plan: toWirePlan(plan),
    configDiff,
    appliedChanges,
    skippedChanges
  } satisfies GoalPreviewResponse);
};
