import { json, error } from '@sveltejs/kit';
import { GOALS_ENGINE_VERSION } from '$shared/goals/index.ts';
import { buildGoalPlan, type GoalRequest } from '$lib/server/goals/planRequest.ts';
import { persistGoalApply } from '$lib/server/goals/persistGoalApply.ts';
import { computeGoalConfigDiff } from '$lib/server/goals/computeConfigDiff.ts';
import { computeIntentFingerprint } from '$lib/server/goals/fingerprint.ts';
import { buildApplyStatus, buildApplyFailure } from '$lib/server/goals/applyStatus.ts';
import { toWirePlan, toWireBinding } from '$lib/server/goals/responses.ts';
import { buildGoalDecisionLogMetadata } from '$lib/server/goals/decisionLog.ts';
import { qualityGoalBindingQueries } from '$db/queries/qualityGoalBindings.ts';
import { qualityGoalApplyJournalQueries } from '$db/queries/qualityGoalApplyJournal.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { compile } from '$pcd/database/compiler.ts';
import { logger } from '$logger/logger.ts';
import type { GoalWeights } from '$shared/goals/index.ts';
import type { components } from '$api/v1.d.ts';

type GoalReconcileResponse = components['schemas']['GoalReconcileResponse'];

export interface GoalReconcileRequestInput {
  databaseId: number;
  arrType: 'radarr' | 'sonarr' | 'lidarr';
  profileName: string;
  expectedEngineVersion: string;
}

export interface GoalReconcileDependencies {
  readonly getInstance: typeof databaseInstancesQueries.getById;
  /** Recompile the registry cache from committed `pcd_ops` (the return value is intentionally ignored). */
  readonly recompileCache: (pcdPath: string, databaseInstanceId: number) => Promise<unknown>;
  readonly getLatestJournal: typeof qualityGoalApplyJournalQueries.getLatest;
  readonly getBinding: typeof qualityGoalBindingQueries.get;
  readonly buildGoalPlan: typeof buildGoalPlan;
  readonly computeGoalConfigDiff: typeof computeGoalConfigDiff;
  readonly computeIntentFingerprint: typeof computeIntentFingerprint;
  readonly persistGoalApply: typeof persistGoalApply;
  readonly upsertBinding: typeof qualityGoalBindingQueries.upsert;
  readonly insertPendingJournal: typeof qualityGoalApplyJournalQueries.insertPending;
  readonly markJournalSucceeded: typeof qualityGoalApplyJournalQueries.markSucceeded;
  readonly markJournalFailed: typeof qualityGoalApplyJournalQueries.markFailed;
  readonly logInfo: typeof logger.info;
}

export const DEFAULT_RECONCILE_DEPENDENCIES: GoalReconcileDependencies = {
  getInstance: (id) => databaseInstancesQueries.getById(id),
  recompileCache: (pcdPath, id) => compile(pcdPath, id),
  getLatestJournal: (databaseId, profileName, arrType) =>
    qualityGoalApplyJournalQueries.getLatest(databaseId, profileName, arrType),
  getBinding: (databaseId, profileName, arrType) => qualityGoalBindingQueries.get(databaseId, profileName, arrType),
  buildGoalPlan,
  computeGoalConfigDiff,
  computeIntentFingerprint,
  persistGoalApply,
  upsertBinding: (input) => qualityGoalBindingQueries.upsert(input),
  insertPendingJournal: (input) => qualityGoalApplyJournalQueries.insertPending(input),
  markJournalSucceeded: (id, scoringPersisted) => qualityGoalApplyJournalQueries.markSucceeded(id, scoringPersisted),
  markJournalFailed: (id, input) => qualityGoalApplyJournalQueries.markFailed(id, input),
  logInfo: (message, options) => logger.info(message, options)
};

function parseReconcileRequest(body: Record<string, unknown>): GoalReconcileRequestInput {
  if (typeof body.databaseId !== 'number' || !Number.isInteger(body.databaseId)) {
    throw error(400, 'databaseId must be an integer');
  }
  if (body.arrType !== 'radarr' && body.arrType !== 'sonarr' && body.arrType !== 'lidarr') {
    throw error(400, 'arrType must be one of: radarr, sonarr, lidarr');
  }
  if (typeof body.profileName !== 'string' || body.profileName.trim() === '') {
    throw error(400, 'profileName must be a non-empty string');
  }
  if (typeof body.expectedEngineVersion !== 'string' || body.expectedEngineVersion.length === 0) {
    throw error(400, 'expectedEngineVersion must be a non-empty string');
  }
  if (body.expectedEngineVersion !== GOALS_ENGINE_VERSION) {
    throw error(
      409,
      `Engine version mismatch: client computed against "${body.expectedEngineVersion}", server is "${GOALS_ENGINE_VERSION}". Re-preview before reconciling.`
    );
  }
  return {
    databaseId: body.databaseId,
    arrType: body.arrType,
    profileName: body.profileName,
    expectedEngineVersion: body.expectedEngineVersion
  };
}

/**
 * Recover a partial or pending Quality Goals apply (issue #236). Re-derives the RECORDED intent (preset
 * + weights from the latest journal row, or the binding) against live state and re-drives only the
 * residual diff, then confirms the binding. Deterministic + idempotent: recompiles the cache from
 * committed `pcd_ops` first, so it heals both a binding-only gap (residual scoring empty → just upsert
 * the binding) and any partial-scoring write (emit only the missing ops). NO `db.transaction()`.
 */
export async function reconcileGoalApply(
  body: Record<string, unknown>,
  deps: GoalReconcileDependencies = DEFAULT_RECONCILE_DEPENDENCIES
): Promise<Response> {
  const request = parseReconcileRequest(body);

  // Recover intent WITHOUT a client-held plan: the latest journal row, falling back to the binding row.
  // Only the shared `preset_id`/`weights_json` fields are read from the union.
  const recorded =
    deps.getLatestJournal(request.databaseId, request.profileName, request.arrType) ??
    deps.getBinding(request.databaseId, request.profileName, request.arrType);
  if (!recorded) {
    throw error(404, `Nothing to reconcile for profile "${request.profileName}"`);
  }

  const instance = deps.getInstance(request.databaseId);
  if (!instance) {
    throw error(404, 'Database not found');
  }
  // Resync the projection to committed pcd_ops FIRST, so builders run against durable live state
  // (repairs any stale cache from a crash window or a mid-persist partial-scoring write).
  await deps.recompileCache(instance.local_path, instance.id);

  const goalRequest: GoalRequest = {
    databaseId: request.databaseId,
    arrType: request.arrType,
    profileName: request.profileName,
    presetId: recorded.preset_id,
    weights: JSON.parse(recorded.weights_json) as GoalWeights
  };

  const { cache, plan } = await deps.buildGoalPlan(goalRequest);
  const { configDiff } = await deps.computeGoalConfigDiff(
    cache,
    request.databaseId,
    request.arrType,
    request.profileName,
    plan
  );

  const intentFingerprint = await deps.computeIntentFingerprint(plan);
  const startedAt = new Date().toISOString();
  const reconcileId = deps.insertPendingJournal({
    databaseId: request.databaseId,
    profileName: request.profileName,
    arrType: request.arrType,
    presetId: goalRequest.presetId,
    weightsJson: JSON.stringify(goalRequest.weights),
    engineVersion: GOALS_ENGINE_VERSION,
    intentFingerprint,
    origin: 'reconcile',
    startedAt
  });

  let scoringResult;
  try {
    scoringResult = await deps.persistGoalApply({
      databaseId: request.databaseId,
      cache,
      layer: 'user',
      profileName: request.profileName,
      plan
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.markJournalFailed(reconcileId, { failureStage: 'scoring', failureReason: message, scoringPersisted: 1 });
    return json(
      buildApplyFailure({
        applyId: reconcileId,
        message,
        scoringChanged: true,
        failureStage: 'scoring',
        intentFingerprint,
        startedAt
      }),
      { status: 500 }
    );
  }

  if (!scoringResult.success) {
    const message = scoringResult.error ?? 'Failed to reconcile goal';
    const isGuardConflict = /value-guard gate/i.test(message);
    deps.markJournalFailed(reconcileId, { failureStage: 'scoring', failureReason: message, scoringPersisted: 0 });
    return json(
      buildApplyFailure({
        applyId: reconcileId,
        message,
        scoringChanged: false,
        failureStage: 'scoring',
        intentFingerprint,
        startedAt
      }),
      { status: isGuardConflict ? 409 : 500 }
    );
  }

  // `filepath` is set only when residual ops were actually persisted; empty when live already matched.
  const opsPersisted = scoringResult.filepath != null;

  let binding;
  try {
    binding = deps.upsertBinding({
      databaseId: request.databaseId,
      profileName: request.profileName,
      arrType: request.arrType,
      presetId: goalRequest.presetId,
      weightsJson: JSON.stringify(goalRequest.weights),
      engineVersion: GOALS_ENGINE_VERSION,
      appliedAt: new Date().toISOString()
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.markJournalFailed(reconcileId, {
      failureStage: 'binding',
      failureReason: message,
      scoringPersisted: opsPersisted ? 1 : 0,
      bindingPersisted: 0
    });
    return json(
      buildApplyFailure({
        applyId: reconcileId,
        message,
        scoringChanged: opsPersisted,
        failureStage: 'binding',
        intentFingerprint,
        startedAt
      }),
      { status: 500 }
    );
  }

  deps.markJournalSucceeded(reconcileId, opsPersisted ? 1 : 0);

  // Emit the decision event ONLY when reconcile actually re-applied — never on a pure no-op.
  if (opsPersisted) {
    await deps.logInfo('Quality goal applied', {
      source: 'QualityGoals',
      meta: buildGoalDecisionLogMetadata({
        databaseId: request.databaseId,
        profileName: request.profileName,
        presetId: goalRequest.presetId,
        plan
      })
    });
  }

  const applyStatus = buildApplyStatus({
    applyId: reconcileId,
    status: 'succeeded',
    scoringChanged: opsPersisted,
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
    applyId: reconcileId,
    applyStatus,
    reconciled: opsPersisted,
    alreadyApplied: !opsPersisted
  } satisfies GoalReconcileResponse);
}
