import { type RequestHandler } from '@sveltejs/kit';
import { readJsonObjectBody } from '$lib/server/goals/planRequest.ts';
import {
  reconcileGoalApply,
  DEFAULT_RECONCILE_DEPENDENCIES,
  type GoalReconcileDependencies
} from '$lib/server/goals/reconcileGoalApply.ts';

/**
 * POST /api/v1/goals/reconcile — recover a partial or pending Quality Goals apply by re-driving the
 * recorded intent idempotently (issue #236). All orchestration + structured failure bodies live in
 * `reconcileGoalApply`; this thin route only reads the body and delegates (DI-injectable for tests).
 */
export async function _handleGoalReconcileRequest(
  request: Request,
  dependencies: GoalReconcileDependencies = DEFAULT_RECONCILE_DEPENDENCIES
): Promise<Response> {
  const body = await readJsonObjectBody(request);
  return reconcileGoalApply(body, dependencies);
}

export const POST: RequestHandler = ({ request }) => _handleGoalReconcileRequest(request);
