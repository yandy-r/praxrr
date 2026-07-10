import { json, error, type RequestHandler } from '@sveltejs/kit';
import { GOALS_ENGINE_VERSION } from '$shared/goals/index.ts';
import { readJsonObjectBody, parseGoalRequest, buildGoalPlan } from '$lib/server/goals/planRequest.ts';
import { persistGoalApply } from '$lib/server/goals/persistGoalApply.ts';
import { computeGoalConfigDiff } from '$lib/server/goals/computeConfigDiff.ts';
import { toWirePlan, toWireBinding } from '$lib/server/goals/responses.ts';
import { buildGoalDecisionLogMetadata } from '$lib/server/goals/decisionLog.ts';
import { qualityGoalBindingQueries } from '$db/queries/qualityGoalBindings.ts';
import { logger } from '$logger/logger.ts';
import type { components } from '$api/v1.d.ts';

type GoalApplyResponse = components['schemas']['GoalApplyResponse'];

export interface GoalApplyDependencies {
  readonly buildGoalPlan: typeof buildGoalPlan;
  readonly persistGoalApply: typeof persistGoalApply;
  readonly computeGoalConfigDiff: typeof computeGoalConfigDiff;
  readonly upsertBinding: typeof qualityGoalBindingQueries.upsert;
  readonly logInfo: typeof logger.info;
}

const DEFAULT_DEPENDENCIES: GoalApplyDependencies = {
  buildGoalPlan,
  persistGoalApply,
  computeGoalConfigDiff,
  upsertBinding: (input) => qualityGoalBindingQueries.upsert(input),
  logInfo: (message, options) => logger.info(message, options),
};

/**
 * POST /api/v1/goals/apply — persist the generated scores + quality ladder to the profile as ONE
 * guarded PCD write, then record the goal binding. Returns 409 on an engine-version mismatch or a
 * value-guard conflict (nothing persisted); ambiguous mappings fail as 422 in `buildGoalPlan` before
 * any write. Echoes the persisted config diff (captured pre-persist, matching preview).
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

  // Capture the "what apply will write" diff from an ephemeral sandbox BEFORE persisting, so the
  // echoed configDiff matches preview's for the same plan (never re-diffs the mutated live cache).
  const { configDiff } = await dependencies.computeGoalConfigDiff(
    cache,
    goalRequest.databaseId,
    goalRequest.arrType,
    goalRequest.profileName,
    plan
  );

  const result = await dependencies.persistGoalApply({
    databaseId: goalRequest.databaseId,
    cache,
    layer: 'user',
    profileName: goalRequest.profileName,
    plan,
  });
  if (!result.success) {
    // A value-guard gate rejection is a concurrency conflict (409, nothing persisted); anything else
    // is an unexpected server failure (500).
    const isGuardConflict = /value-guard gate/i.test(result.error ?? '');
    throw error(isGuardConflict ? 409 : 500, result.error ?? 'Failed to apply goal');
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
    configDiff,
  } satisfies GoalApplyResponse);
}

export const POST: RequestHandler = ({ request }) => _handleGoalApplyRequest(request);
