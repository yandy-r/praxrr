import { json, error, type RequestHandler } from '@sveltejs/kit';
import { updateScoring } from '$pcd/entities/qualityProfiles/scoring/update.ts';
import { GOALS_ENGINE_VERSION } from '$shared/goals/index.ts';
import { readJsonObjectBody, parseGoalRequest, buildGoalPlan } from '$lib/server/goals/planRequest.ts';
import { toWirePlan, toWireBinding } from '$lib/server/goals/responses.ts';
import { buildGoalDecisionLogMetadata } from '$lib/server/goals/decisionLog.ts';
import { qualityGoalBindingQueries } from '$db/queries/qualityGoalBindings.ts';
import { logger } from '$logger/logger.ts';
import type { components } from '$api/v1.d.ts';

type GoalApplyResponse = components['schemas']['GoalApplyResponse'];

export interface GoalApplyDependencies {
  readonly buildGoalPlan: typeof buildGoalPlan;
  readonly updateScoring: typeof updateScoring;
  readonly upsertBinding: typeof qualityGoalBindingQueries.upsert;
  readonly logInfo: typeof logger.info;
}

const DEFAULT_DEPENDENCIES: GoalApplyDependencies = {
  buildGoalPlan,
  updateScoring,
  upsertBinding: (input) => qualityGoalBindingQueries.upsert(input),
  logInfo: (message, options) => logger.info(message, options),
};

/**
 * POST /api/v1/goals/apply — persist the generated scores + thresholds to the quality profile via the
 * standard PCD user-op path, then record the goal binding. Returns 409 when the client computed
 * against a different engine version.
 */
export async function _handleGoalApplyRequest(
  request: Request,
  dependencies: GoalApplyDependencies = DEFAULT_DEPENDENCIES
): Promise<Response> {
  const body = await readJsonObjectBody(request);
  const goalRequest = parseGoalRequest(body);

  if (typeof body.expectedEngineVersion !== 'string' || body.expectedEngineVersion.length === 0) {
    throw error(400, 'expectedEngineVersion must be a non-empty string');
  }
  if (body.expectedEngineVersion !== GOALS_ENGINE_VERSION) {
    throw error(
      409,
      `Engine version mismatch: client computed against "${body.expectedEngineVersion}", server is "${GOALS_ENGINE_VERSION}". Re-preview before applying.`
    );
  }

  const { cache, plan } = await dependencies.buildGoalPlan(goalRequest);

  const result = await dependencies.updateScoring({
    databaseId: goalRequest.databaseId,
    cache,
    layer: 'user',
    profileName: goalRequest.profileName,
    input: plan.scoringInput,
  });
  if (!result.success) {
    throw error(500, result.error ?? 'Failed to apply goal scoring');
  }

  const binding = dependencies.upsertBinding({
    databaseId: goalRequest.databaseId,
    profileName: goalRequest.profileName,
    arrType: goalRequest.arrType,
    presetId: goalRequest.presetId,
    weightsJson: JSON.stringify(goalRequest.weights),
    engineVersion: GOALS_ENGINE_VERSION,
    appliedAt: new Date().toISOString(),
  });

  await dependencies.logInfo('Quality goal applied', {
    source: 'QualityGoals',
    meta: buildGoalDecisionLogMetadata({
      databaseId: goalRequest.databaseId,
      profileName: goalRequest.profileName,
      presetId: goalRequest.presetId,
      plan,
    }),
  });

  return json({
    plan: toWirePlan(plan),
    binding: toWireBinding(binding),
  } satisfies GoalApplyResponse);
}

export const POST: RequestHandler = ({ request }) => _handleGoalApplyRequest(request);
