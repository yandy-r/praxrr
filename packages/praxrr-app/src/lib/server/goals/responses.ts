/**
 * Wire mappers for the Quality Goals routes (issue #20): strip the engine's internal `scoringInput`
 * from the plan and map a stored binding row to its camelCase API shape.
 */

import type { GoalPlan, GoalWeights } from '$shared/goals/index.ts';
import type { QualityGoalBindingRow } from '$db/queries/qualityGoalBindings.ts';
import type { components } from '$api/v1.d.ts';

type WireGoalPlan = components['schemas']['GoalPlan'];
type WireGoalBinding = components['schemas']['GoalBinding'];

/** Drop the internal `scoringInput` + `ladderInput` — the wire plan exposes decisions + qualityLadder. */
export function toWirePlan(plan: GoalPlan): WireGoalPlan {
  const { scoringInput: _scoringInput, ladderInput: _ladderInput, ...wire } = plan;
  return wire;
}

/** Map a persisted binding row to the API shape, deserializing the stored weights. */
export function toWireBinding(row: QualityGoalBindingRow): WireGoalBinding {
  return {
    presetId: row.preset_id,
    weights: JSON.parse(row.weights_json) as GoalWeights,
    engineVersion: row.engine_version,
    appliedAt: row.applied_at
  };
}
