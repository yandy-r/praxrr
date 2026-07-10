/**
 * Persist a goal apply as ONE guarded write (issue #221).
 *
 * Hands the assembled scoring + ladder operations to a single `writeOperationsFromSql` call with the
 * value-guard gate enabled: the writer validates all SQL, runs the gate over every op (rejecting on
 * any guard mismatch BEFORE persist), then persists all ops + recompiles once. Under the default
 * `override`/`ask` conflict strategies a guard conflict → `{ success:false }` and nothing lands — so
 * scoring can never be committed while the ladder fails, and the route maps it to 409. (Under the
 * non-default `align` strategy a conflicting op is instead silently aligned away on recompile rather
 * than blocking, so the atomic-409 contract holds only for `override`/`ask`.)
 */

import { writeOperationsFromSql } from '$pcd/ops/writer.ts';
import type { PCDCache } from '$pcd/index.ts';
import type { OperationLayer, WriteResult } from '$pcd/core/types.ts';
import type { GoalPlan } from '$shared/goals/index.ts';
import { buildGoalApplyOps } from './buildGoalApplyOps.ts';

export interface PersistGoalApplyOptions {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  profileName: string;
  plan: GoalPlan;
}

export async function persistGoalApply(options: PersistGoalApplyOptions): Promise<WriteResult> {
  const built = await buildGoalApplyOps(options);
  if ('error' in built) {
    return { success: false, error: built.error };
  }
  if (built.operations.length === 0) {
    return { success: true };
  }

  return writeOperationsFromSql({
    databaseId: options.databaseId,
    layer: options.layer,
    description: `apply-goal-${options.profileName}`,
    operations: built.operations,
    runValueGuardGate: true
  });
}
