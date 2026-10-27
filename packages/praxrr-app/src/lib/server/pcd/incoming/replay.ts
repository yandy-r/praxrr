/**
 * Dry replay of published user ops over an incoming-state cache (YAN-570).
 *
 * Mirrors the user-op branch of `PCDCache.build()` + the `compile()` rebuild -- same ordering,
 * same value-guard gate functions, same inputs -- but never writes: no `pcd_op_history` rows, no
 * `pcd_ops` state changes (auto-drops), no `setCache`, no database disabling.
 *
 * Like the real build, pass 1 keeps replaying on the same (possibly dirty) cache after a
 * force-align drop that left partial writes behind (`needsRebuild`); later ops are judged against
 * those leftovers and their auto-align drops persist. `compile()` then rebuilds once with every
 * pass-1 drop excluded (compiler.ts: `if (stats.needsRebuild) { rebuild }`, no further loop), so
 * pass 2 replays the surviving ops on a fresh cache and its outcomes are the final ones.
 *
 * The cache passed in MUST be an ephemeral, unregistered one that already holds the incoming
 * schema + base + tweaks state. It is mutated (user ops are executed on it); the caller owns
 * closing it. Caches produced by `buildFreshCache` are owned and closed here.
 */

import type { Database } from '@jsr/db__sqlite';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { pcdOpsQueries, type PcdOp } from '$db/queries/pcdOps.ts';
import { logger } from '$logger/logger.ts';
import type { ConflictStrategy } from '$pcd/conflicts/autoAlign/types.ts';
import { canOverrideConflict } from '$pcd/conflicts/override.ts';
import { parseJson, type StoredOpMetadata } from '$pcd/conflicts/overrideUtils.ts';
import type { PCDCache } from '../database/cache.ts';
import { loadPublishedUserOperations } from '../ops/loadOps.ts';
import type { Operation } from '../core/types.ts';
import { evaluateValueGuardApply, evaluateValueGuardError } from '../migration/valueGuardGate.ts';
import type { PredictedConflict, PredictedError } from './types.ts';

const SOURCE = 'IncomingPreview';

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

interface OpOutcome {
  opId: number;
  conflict: PredictedConflict | null;
  error: PredictedError | null;
  /** The real build would persist `state = 'dropped'` for this op. */
  dropped: boolean;
  /** The real build would flag `stats.needsRebuild`. */
  needsRebuild: boolean;
}

interface ReplayContext {
  databaseId: number;
  conflictStrategy: ConflictStrategy;
  /** compile() auto-overrides `conflicted` user ops only for enabled, override-strategy databases. */
  autoOverrideActive: boolean;
  userOpsById: ReadonlyMap<number, PcdOp>;
  priorConflicts: ReadonlyMap<number, string | null>;
}

/**
 * Whether `compile()`'s automatic override will resolve this predicted conflict: strategy
 * `override`, status `conflicted`, enabled instance, and `overrideConflict` has a way to resolve
 * the op (same dispatch table as the override itself).
 */
function isAutoResolvable(
  context: ReplayContext,
  status: PredictedConflict['predictedStatus'],
  metadataJson: string | null
): boolean {
  return (
    context.autoOverrideActive &&
    context.conflictStrategy === 'override' &&
    status === 'conflicted' &&
    canOverrideConflict(parseJson<StoredOpMetadata>(metadataJson))
  );
}

/** One pass of the real build's user-op loop. No rollback: later ops see earlier leftovers. */
function replayPass(rawDb: Database, operations: readonly Operation[], context: ReplayContext): OpOutcome[] {
  const outcomes: OpOutcome[] = [];

  for (const operation of operations) {
    const opId = parsePcdOpId(operation.filepath);
    const userOp = opId === null ? undefined : context.userOpsById.get(opId);
    if (opId === null || !userOp) continue;

    const descriptor = describeOp(userOp.metadata);
    const priorReason = context.priorConflicts.get(opId) ?? null;
    const outcome: OpOutcome = { opId, conflict: null, error: null, dropped: false, needsRebuild: false };
    outcomes.push(outcome);
    const beforeChanges = rawDb.totalChanges;

    try {
      rawDb.exec(operation.sql);
    } catch (error) {
      const errorStr = String(error);
      const gateError = evaluateValueGuardError({
        conflictStrategy: context.conflictStrategy,
        error: errorStr,
        isUserOp: true,
        trackHistory: true,
        priorConflictReason: priorReason,
      });

      if (gateError.errorCategory === 'non_conflict_error') {
        outcome.error = { opId, error: errorStr };
      } else {
        const predictedStatus = gateError.status === 'conflicted_pending' ? 'conflicted_pending' : 'conflicted';
        outcome.conflict = {
          opId,
          ...descriptor,
          kind: 'conflict',
          predictedStatus,
          conflictReason: gateError.conflictReason ?? 'guard_mismatch',
          decision: null,
          autoAlignRule: null,
          strategy: context.conflictStrategy,
          autoResolvable: isAutoResolvable(context, predictedStatus, userOp.metadata),
        };
      }
      // The real build `continue`s here: statements that ran before the failure stay applied.
      continue;
    }

    const gate = evaluateValueGuardApply({
      db: rawDb,
      conflictStrategy: context.conflictStrategy,
      isUserOp: true,
      rowcount: rawDb.totalChanges - beforeChanges,
      metadataJson: userOp.metadata,
      desiredStateJson: userOp.desired_state,
      priorConflictReason: priorReason,
    });

    if (gate.needsRebuild) outcome.needsRebuild = true;

    if (gate.shouldAttemptAutoDrop) {
      outcome.dropped = true;
      outcome.conflict = {
        opId,
        ...descriptor,
        kind: 'aligned',
        predictedStatus: 'dropped',
        conflictReason: 'aligned',
        decision: gate.decision,
        autoAlignRule: gate.autoAlignRule,
        strategy: context.conflictStrategy,
        autoResolvable: false,
      };
    } else if (gate.status === 'conflicted' || gate.status === 'conflicted_pending') {
      outcome.conflict = {
        opId,
        ...descriptor,
        kind: 'conflict',
        predictedStatus: gate.status,
        conflictReason: gate.conflictReason ?? 'guard_mismatch',
        decision: gate.decision,
        autoAlignRule: null,
        strategy: context.conflictStrategy,
        autoResolvable: isAutoResolvable(context, gate.status, userOp.metadata),
      };
    }
  }

  return outcomes;
}

export async function replayUserOpsDry(
  cache: PCDCache,
  databaseId: number,
  conflictStrategy: ConflictStrategy,
  buildFreshCache: () => Promise<PCDCache>
): Promise<{ predictedConflicts: PredictedConflict[]; predictedErrors: PredictedError[] }> {
  const rawDb: Database | null = cache.getRawDb();
  if (!rawDb) {
    throw new Error('Incoming preview replay requires a built cache');
  }

  const context: ReplayContext = {
    databaseId,
    conflictStrategy,
    autoOverrideActive: !!databaseInstancesQueries.getById(databaseId)?.enabled,
    userOpsById: new Map(
      pcdOpsQueries.listByDatabaseAndOrigin(databaseId, 'user', { states: ['published'] }).map((op) => [op.id, op])
    ),
    priorConflicts: loadPriorConflictReasons(databaseId),
  };
  const operations = loadPublishedUserOperations(databaseId);

  const pass1 = replayPass(rawDb, operations, context);
  let final = pass1;

  if (pass1.some((outcome) => outcome.needsRebuild)) {
    // compile() rebuilds once, excluding every op pass 1 dropped; the rebuilt cache's outcomes
    // are the surviving ops' final ones (the rebuild is not repeated).
    const dropped = new Set(pass1.filter((outcome) => outcome.dropped).map((outcome) => outcome.opId));
    const survivors = operations.filter((operation) => {
      const opId = parsePcdOpId(operation.filepath);
      return opId !== null && !dropped.has(opId);
    });
    const fresh = await buildFreshCache();
    try {
      const freshDb = fresh.getRawDb();
      if (!freshDb) {
        throw new Error('Incoming preview rebuild requires a built cache');
      }
      const pass2 = new Map(replayPass(freshDb, survivors, context).map((outcome) => [outcome.opId, outcome]));
      final = pass1.flatMap((outcome) => (dropped.has(outcome.opId) ? [outcome] : (pass2.get(outcome.opId) ?? [])));
    } finally {
      fresh.close();
    }
  }

  return {
    predictedConflicts: final.flatMap((outcome) => (outcome.conflict ? [outcome.conflict] : [])),
    predictedErrors: final.flatMap((outcome) => (outcome.error ? [outcome.error] : [])),
  };
}
