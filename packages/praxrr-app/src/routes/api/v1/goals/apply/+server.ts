import { json, error, type RequestHandler } from '@sveltejs/kit';
import { GOALS_ENGINE_VERSION } from '$shared/goals/index.ts';
import { readJsonObjectBody, parseGoalRequest, buildGoalPlan } from '$lib/server/goals/planRequest.ts';
import { persistGoalApply } from '$lib/server/goals/persistGoalApply.ts';
import { computeGoalConfigDiff } from '$lib/server/goals/computeConfigDiff.ts';
import { computeIntentFingerprint } from '$lib/server/goals/fingerprint.ts';
import { buildApplyStatus, buildApplyFailure } from '$lib/server/goals/applyStatus.ts';
import { toWirePlan, toWireBinding } from '$lib/server/goals/responses.ts';
import { buildGoalDecisionLogMetadata } from '$lib/server/goals/decisionLog.ts';
import { qualityGoalBindingQueries } from '$db/queries/qualityGoalBindings.ts';
import { qualityGoalApplyJournalQueries } from '$db/queries/qualityGoalApplyJournal.ts';
import { logger } from '$logger/logger.ts';
import type { components } from '$api/v1.d.ts';

type GoalApplyResponse = components['schemas']['GoalApplyResponse'];

export interface GoalApplyDependencies {
  readonly buildGoalPlan: typeof buildGoalPlan;
  readonly persistGoalApply: typeof persistGoalApply;
  readonly computeGoalConfigDiff: typeof computeGoalConfigDiff;
  readonly computeIntentFingerprint: typeof computeIntentFingerprint;
  readonly upsertBinding: typeof qualityGoalBindingQueries.upsert;
  readonly insertPendingJournal: typeof qualityGoalApplyJournalQueries.insertPending;
  readonly markJournalSucceeded: typeof qualityGoalApplyJournalQueries.markSucceeded;
  readonly markJournalFailed: typeof qualityGoalApplyJournalQueries.markFailed;
  readonly logInfo: typeof logger.info;
}

const DEFAULT_DEPENDENCIES: GoalApplyDependencies = {
  buildGoalPlan,
  persistGoalApply,
  computeGoalConfigDiff,
  computeIntentFingerprint,
  upsertBinding: (input) => qualityGoalBindingQueries.upsert(input),
  insertPendingJournal: (input) => qualityGoalApplyJournalQueries.insertPending(input),
  markJournalSucceeded: (id, scoringPersisted) => qualityGoalApplyJournalQueries.markSucceeded(id, scoringPersisted),
  markJournalFailed: (id, input) => qualityGoalApplyJournalQueries.markFailed(id, input),
  logInfo: (message, options) => logger.info(message, options)
};

/**
 * POST /api/v1/goals/apply — persist the generated scores + quality ladder as a guarded PCD write,
 * then record the goal binding. Because the two durable writes (`pcd_ops` + `quality_goal_bindings`)
 * cannot be made atomic safely on the shared connection, an apply-journal breadcrumb is written
 * `pending` BEFORE any scoring write and settled to `succeeded`/`failed` after, so a partial write is
 * always reported (structured `GoalApplyFailure` with a reconcile recovery action) and never silent
 * (issue #236). NO `db.transaction()` and NO writer `BEGIN` — a bare `BEGIN` held across the writer's
 * async body would sweep concurrent writers into this apply and roll them back. Pre-plan validation
 * (400/422/engine-mismatch 409) still throws `ErrorResponse` before any journal row exists.
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

  const intentFingerprint = await dependencies.computeIntentFingerprint(plan);
  const startedAt = new Date().toISOString();

  // Durable breadcrumb, written BEFORE any scoring write so every attempt is traceable even on a crash.
  const applyId = dependencies.insertPendingJournal({
    databaseId: goalRequest.databaseId,
    profileName: goalRequest.profileName,
    arrType: goalRequest.arrType,
    presetId: goalRequest.presetId,
    weightsJson: JSON.stringify(goalRequest.weights),
    engineVersion: GOALS_ENGINE_VERSION,
    intentFingerprint,
    origin: 'apply',
    startedAt
  });

  // Scoring persist (atomic within pcd_ops via the value-guard gate; recompiles the cache itself).
  let scoringResult;
  try {
    scoringResult = await dependencies.persistGoalApply({
      databaseId: goalRequest.databaseId,
      cache,
      layer: 'user',
      profileName: goalRequest.profileName,
      plan
    });
  } catch (err) {
    // Rare mid-persist infra throw (op k of N): a partial pcd_ops write is possible and the success-path
    // recompile did not run. Report conservatively (scoring may have changed); reconcile heals it.
    const message = err instanceof Error ? err.message : String(err);
    dependencies.markJournalFailed(applyId, { failureStage: 'scoring', failureReason: message, scoringPersisted: 1 });
    return json(
      buildApplyFailure({ applyId, message, scoringChanged: true, failureStage: 'scoring', intentFingerprint, startedAt }),
      { status: 500 }
    );
  }

  if (!scoringResult.success) {
    // Value-guard reject or build error: the gate is a pre-persist dry-run, so nothing landed.
    const message = scoringResult.error ?? 'Failed to apply goal';
    const isGuardConflict = /value-guard gate/i.test(message);
    dependencies.markJournalFailed(applyId, { failureStage: 'scoring', failureReason: message, scoringPersisted: 0 });
    return json(
      buildApplyFailure({ applyId, message, scoringChanged: false, failureStage: 'scoring', intentFingerprint, startedAt }),
      { status: isGuardConflict ? 409 : 500 }
    );
  }

  const scoringChanged = scoringResult.filepath != null;

  // Binding upsert — the #236 headline gap. Scoring is already durable; a throw here is a REAL partial
  // write (not rolled back — there is no transaction). It is reported, and reconcile confirms the binding.
  let binding;
  try {
    binding = dependencies.upsertBinding({
      databaseId: goalRequest.databaseId,
      profileName: goalRequest.profileName,
      arrType: goalRequest.arrType,
      presetId: goalRequest.presetId,
      weightsJson: JSON.stringify(goalRequest.weights),
      engineVersion: GOALS_ENGINE_VERSION,
      appliedAt: new Date().toISOString()
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Scoring is durable but the binding is not — a REAL, reported partial write. `scoringChanged`
    // mirrors whether scoring actually wrote this attempt (consistent with the status GET).
    dependencies.markJournalFailed(applyId, {
      failureStage: 'binding',
      failureReason: message,
      scoringPersisted: scoringChanged ? 1 : 0,
      bindingPersisted: 0
    });
    return json(
      buildApplyFailure({ applyId, message, scoringChanged, failureStage: 'binding', intentFingerprint, startedAt }),
      { status: 500 }
    );
  }

  // Both stores durable: the one confirmed terminal state.
  dependencies.markJournalSucceeded(applyId, scoringChanged ? 1 : 0);

  // The success/decision event — emitted ONLY here, after scoring + binding + journal `succeeded`.
  await dependencies.logInfo('Quality goal applied', {
    source: 'QualityGoals',
    meta: buildGoalDecisionLogMetadata({
      databaseId: goalRequest.databaseId,
      profileName: goalRequest.profileName,
      presetId: goalRequest.presetId,
      plan
    })
  });

  const applyStatus = buildApplyStatus({
    applyId,
    status: 'succeeded',
    scoringChanged,
    bindingPersisted: true,
    failureStage: null,
    failureReason: null,
    intentFingerprint,
    startedAt,
    settledAt: new Date().toISOString()
  });

  return json({
    plan: toWirePlan(plan),
    binding: toWireBinding(binding),
    configDiff,
    applyId,
    applyStatus
  } satisfies GoalApplyResponse);
}

export const POST: RequestHandler = ({ request }) => _handleGoalApplyRequest(request);
