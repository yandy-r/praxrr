/**
 * Assemble the guarded op set for a goal apply (issue #221): scoring + quality ladder.
 *
 * Builds [...scoringOps, ladderOp] as plain SQL operations from the SAME builders preview uses
 * (`buildScoringOps`, `buildQualityLadderOps`). Each op keeps its own single-family `desiredState`
 * (scoring → `custom_format_scores`; ladder → `ordered_items`), so the value-guard gate evaluates
 * each by its natural rule with no cross-contamination — no core guard-gate change is needed. The
 * caller ({@link persistGoalApply}) hands the whole array to ONE `writeOperationsFromSql` call so
 * scoring + ladder persist atomically (all-or-nothing).
 */

import type { PCDCache } from '$pcd/index.ts';
import type { OperationLayer, OperationMetadata } from '$pcd/core/types.ts';
import { compiledQueryToSql } from '$pcd/utils/sql.ts';
import { buildScoringOps } from '$pcd/entities/qualityProfiles/scoring/update.ts';
import { buildQualityLadderOps } from '$pcd/entities/qualityProfiles/qualities/index.ts';
import type { CompiledQuery } from 'kysely';
import type { GoalPlan } from '$shared/goals/index.ts';

export interface GoalApplyOperation {
  sql: string;
  metadata: OperationMetadata;
  desiredState: Record<string, unknown>;
}

export interface BuildGoalApplyOptions {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  profileName: string;
  plan: GoalPlan;
}

function toSql(queries: CompiledQuery[]): string {
  return queries.map(compiledQueryToSql).join(';\n\n') + ';';
}

export async function buildGoalApplyOps(
  options: BuildGoalApplyOptions
): Promise<{ operations: GoalApplyOperation[] } | { error: string }> {
  const { databaseId, cache, layer, profileName, plan } = options;

  const scoringBuilt = await buildScoringOps({ databaseId, cache, layer, profileName, input: plan.scoringInput });
  if ('error' in scoringBuilt) {
    return { error: scoringBuilt.error };
  }

  const operations: GoalApplyOperation[] = scoringBuilt.ops.map((op) => ({
    sql: toSql(op.queries),
    metadata: {
      operation: 'update',
      entity: 'quality_profile',
      name: profileName,
      stableKey: { key: 'quality_profile_name', value: profileName },
      changedFields: op.changedFields,
      summary: op.summary,
      title: op.title,
      ...(op.dependsOn ? { dependsOn: op.dependsOn } : {})
    },
    desiredState: op.desiredState
  }));

  if (plan.ladderInput !== null) {
    const ladderBuilt = await buildQualityLadderOps({
      databaseId,
      cache,
      layer,
      profileName,
      input: plan.ladderInput,
      forbidRemovals: true
    });
    if ('error' in ladderBuilt) {
      return { error: ladderBuilt.error };
    }
    if (ladderBuilt.batched !== null) {
      operations.push({
        sql: toSql(ladderBuilt.batched.queries),
        metadata: {
          operation: 'update',
          entity: 'quality_profile',
          name: profileName,
          stableKey: { key: 'quality_profile_name', value: profileName },
          changedFields: ladderBuilt.batched.changedFields,
          summary: 'Update quality profile qualities',
          title: `Update qualities on quality profile "${profileName}"`
        },
        desiredState: ladderBuilt.batched.desiredState
      });
    }
  }

  return { operations };
}
