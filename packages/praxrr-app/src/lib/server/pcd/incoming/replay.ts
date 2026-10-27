/**
 * Dry replay of published user ops over an incoming-state cache (YAN-570).
 *
 * Mirrors the user-op branch of `PCDCache.build()` -- same ordering, same value-guard gate
 * functions, same inputs -- but never writes: no `pcd_op_history` rows, no `pcd_ops` state
 * changes (auto-drops), no `setCache`, no database disabling. The gate functions are pure; the
 * decisions they return are translated into predictions instead of side effects.
 *
 * The cache MUST be an ephemeral, unregistered one that already holds the incoming
 * schema + base + tweaks state. It is mutated (user ops are executed on it) and the caller
 * owns closing it.
 */

import type { Database } from '@jsr/db__sqlite';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import { logger } from '$logger/logger.ts';
import type { ConflictStrategy } from '$pcd/conflicts/autoAlign/types.ts';
import type { PCDCache } from '../database/cache.ts';
import { loadPublishedUserOperations } from '../ops/loadOps.ts';
import { evaluateValueGuardApply, evaluateValueGuardError } from '../migration/valueGuardGate.ts';
import type { PredictedConflict, PredictedError } from './types.ts';

const SOURCE = 'IncomingPreview';
const SAVEPOINT = 'incoming_preview_user_op';

interface OpDescriptor {
  entityType: string | null;
  entityName: string | null;
  operation: PredictedConflict['operation'];
}

function describeOp(metadataJson: string | null): OpDescriptor {
  const empty: OpDescriptor = { entityType: null, entityName: null, operation: null };
  if (!metadataJson) return empty;
  try {
    const parsed = JSON.parse(metadataJson) as { entity?: unknown; name?: unknown; operation?: unknown };
    const operation =
      parsed.operation === 'create' || parsed.operation === 'update' || parsed.operation === 'delete'
        ? parsed.operation
        : null;
    return {
      entityType: typeof parsed.entity === 'string' ? parsed.entity : null,
      entityName: typeof parsed.name === 'string' ? parsed.name : null,
      operation,
    };
  } catch {
    return empty;
  }
}

function parsePcdOpId(filepath: string): number | null {
  if (!filepath.startsWith('pcd_ops:')) return null;
  const id = Number(filepath.slice('pcd_ops:'.length));
  return Number.isInteger(id) ? id : null;
}

function loadPriorConflictReasons(databaseId: number): Map<number, string | null> {
  const reasons = new Map<number, string | null>();
  try {
    for (const entry of pcdOpHistoryQueries.listLatestByDatabaseWithOps(databaseId, [
      'conflicted',
      'conflicted_pending',
    ])) {
      reasons.set(entry.history.op_id, entry.history.conflict_reason);
    }
  } catch (error) {
    // Only used for log de-duplication in the real build; the decision never depends on it.
    void logger.warn('Incoming preview: failed to load prior conflicts', {
      source: SOURCE,
      meta: { databaseId, error: String(error) },
    });
  }
  return reasons;
}

export async function replayUserOpsDry(
  cache: PCDCache,
  databaseId: number,
  conflictStrategy: ConflictStrategy
): Promise<{ predictedConflicts: PredictedConflict[]; predictedErrors: PredictedError[] }> {
  const rawDb: Database | null = cache.getRawDb();
  if (!rawDb) {
    throw new Error('Incoming preview replay requires a built cache');
  }

  const userOpsById = new Map(
    pcdOpsQueries.listByDatabaseAndOrigin(databaseId, 'user', { states: ['published'] }).map((op) => [op.id, op])
  );
  const priorConflicts = loadPriorConflictReasons(databaseId);
  const predictedConflicts: PredictedConflict[] = [];
  const predictedErrors: PredictedError[] = [];

  for (const operation of loadPublishedUserOperations(databaseId)) {
    const opId = parsePcdOpId(operation.filepath);
    const userOp = opId === null ? undefined : userOpsById.get(opId);
    if (opId === null || !userOp) continue;

    const descriptor = describeOp(userOp.metadata);
    const priorReason = priorConflicts.get(opId) ?? null;
    const beforeChanges = rawDb.totalChanges;
    rawDb.exec(`SAVEPOINT ${SAVEPOINT}`);
    let rollback = false;

    try {
      try {
        rawDb.exec(operation.sql);
      } catch (error) {
        const errorStr = String(error);
        const gateError = evaluateValueGuardError({
          conflictStrategy,
          error: errorStr,
          isUserOp: true,
          trackHistory: true,
          priorConflictReason: priorReason,
        });

        if (gateError.errorCategory === 'non_conflict_error') {
          predictedErrors.push({ opId, error: errorStr });
        } else {
          predictedConflicts.push({
            opId,
            ...descriptor,
            kind: 'conflict',
            predictedStatus: gateError.status === 'conflicted_pending' ? 'conflicted_pending' : 'conflicted',
            conflictReason: gateError.conflictReason ?? 'guard_mismatch',
            decision: null,
            autoAlignRule: null,
            strategy: conflictStrategy,
          });
        }
        // The real build `continue`s here: statements that ran before the failure stay applied.
        continue;
      }

      const gate = evaluateValueGuardApply({
        db: rawDb,
        conflictStrategy,
        isUserOp: true,
        rowcount: rawDb.totalChanges - beforeChanges,
        metadataJson: userOp.metadata,
        desiredStateJson: userOp.desired_state,
        priorConflictReason: priorReason,
      });

      if (gate.shouldAttemptAutoDrop) {
        predictedConflicts.push({
          opId,
          ...descriptor,
          kind: 'aligned',
          predictedStatus: 'dropped',
          conflictReason: 'aligned',
          decision: gate.decision,
          autoAlignRule: gate.autoAlignRule,
          strategy: conflictStrategy,
        });
        // A force-dropped op that already mutated the cache is rebuilt without it in the real
        // pull (`needsRebuild`); undo its writes so later ops see the same state.
        rollback = gate.needsRebuild;
      } else if (gate.status === 'conflicted' || gate.status === 'conflicted_pending') {
        predictedConflicts.push({
          opId,
          ...descriptor,
          kind: 'conflict',
          predictedStatus: gate.status,
          conflictReason: gate.conflictReason ?? 'guard_mismatch',
          decision: gate.decision,
          autoAlignRule: null,
          strategy: conflictStrategy,
        });
      }
    } finally {
      if (rollback) {
        rawDb.exec(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
      }
      rawDb.exec(`RELEASE SAVEPOINT ${SAVEPOINT}`);
    }
  }

  return { predictedConflicts, predictedErrors };
}
