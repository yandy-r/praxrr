/**
 * Rollback execution — verified op-log rewind (issue #16).
 *
 * Restores PCD state to a snapshot by making the live `state='published'` op set equal the
 * snapshot's reconstructed published-op set `T`, then recompiling and re-verifying the
 * fingerprint. No op rows are ever deleted (append-only invariant): ops written since the
 * snapshot are transitioned to `superseded` with a DATABLE marker (`superseded_by_op_id =
 * boundaryId`) so pre-rollback and later snapshots stay reconstructable; pre-snapshot ops
 * that were deactivated since are re-published. The rollback is recorded as a durable
 * `pcd_rollbacks` audit row and preceded by a pre-rollback snapshot, so it is itself
 * reversible.
 */

import { db } from '$db/db.ts';
import { pcdSnapshotQueries } from '$db/queries/pcdSnapshots.ts';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import { rollbackQueries } from '$db/queries/pcdRollbacks.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { logger } from '$logger/logger.ts';
import { uuid } from '$shared/utils/uuid.ts';
import { compile } from '../../database/compiler.ts';
import { computeOpsMetadata, computePublishedOpIds, computeStateHash } from '../fingerprint.ts';
import { snapshotPublishedOpIds, verifySnapshot } from '../reconstruct.ts';
import {
  RollbackPostVerifyError,
  RollbackStaleError,
  RollbackUnverifiableError,
  type RollbackResult,
} from './types.ts';

/**
 * Injectable dependencies (mirrors the `CompareDeps` convention). `compile` is injected so
 * restore can be unit-tested against a real app DB without a full PCD checkout on disk.
 */
export interface RestoreDeps {
  compile: typeof compile;
}

const defaultDeps: RestoreDeps = { compile };

export interface RestoreOptions {
  /**
   * Internal recovery pass: skips the from-state guard, the pre-rollback capture, and any
   * further nested recovery. Used to re-restore the pre-rollback snapshot when a rollback's
   * post-verify fails, guaranteeing termination.
   */
  recovery?: boolean;
  deps?: RestoreDeps;
}

interface RewindCounts {
  opsUndone: number;
  opsReactivated: number;
}

/**
 * Pure set arithmetic for the op-log rewind: which currently-published ops must be undone
 * (not in the target set) and which target ops must be reactivated (not currently published).
 * After applying, the published set equals exactly `targetOpIds`.
 */
export function computeRewindSets(
  currentPublishedIds: ReadonlySet<number>,
  targetOpIds: ReadonlySet<number>
): { undoIds: number[]; reactivateIds: number[] } {
  const undoIds = [...currentPublishedIds].filter((id) => !targetOpIds.has(id));
  const reactivateIds = [...targetOpIds].filter((id) => !currentPublishedIds.has(id));
  return { undoIds, reactivateIds };
}

/**
 * Apply the op-log rewind + audit insert in a single transaction. Returns the audit row id
 * and the counts. Never recompiles (that happens after commit).
 */
function applyRewind(
  databaseId: number,
  snapshotId: number,
  targetOpIds: ReadonlySet<number>,
  targetStateHash: string | null,
  preRollbackSnapshotId: number | null
): { rollbackId: number } & RewindCounts {
  const batchId = uuid();
  db.beginTransaction();
  try {
    const currentPublished = db.query<{ id: number }>(
      "SELECT id FROM pcd_ops WHERE database_id = ? AND state = 'published'",
      databaseId
    );
    const currentPublishedIds = new Set(currentPublished.map((row) => row.id));

    const { undoIds, reactivateIds } = computeRewindSets(currentPublishedIds, targetOpIds);

    // Reconstruction replays the snapshot's immutable published-op manifest, never the
    // mutable state columns, so these transitions cannot corrupt any snapshot's
    // reconstruction. Undone ops move to a non-published state (excluded from compile +
    // fingerprint); reactivated ops return to published. No op rows are deleted.
    for (const id of undoIds) {
      pcdOpsQueries.update(id, { state: 'superseded', supersededByOpId: null });
    }

    for (const id of reactivateIds) {
      pcdOpsQueries.update(id, { state: 'published', supersededByOpId: null });
      // Neutralize any stale conflicted/conflicted_pending history so the recompile applies
      // the reactivated op rather than re-dropping it from a prior conflict.
      pcdOpHistoryQueries.create({
        opId: id,
        databaseId,
        batchId,
        status: 'applied',
        rowcount: null,
        conflictReason: 'rollback',
      });
    }

    const rollbackId = rollbackQueries.insert({
      databaseId,
      snapshotId,
      preRollbackSnapshotId,
      targetStateHash,
      opsUndone: undoIds.length,
      opsReactivated: reactivateIds.length,
      status: 'success',
    });

    db.commit();
    return { rollbackId, opsUndone: undoIds.length, opsReactivated: reactivateIds.length };
  } catch (error) {
    db.rollback();
    throw error;
  }
}

/**
 * Restore PCD state to a snapshot. `expectedCurrentStateHash` is the from-state value-guard
 * echoed from the preview; a mismatch means the state changed since preview (422).
 *
 * Throws:
 * - {@link RollbackUnverifiableError} when the snapshot cannot be reconstructed/verified.
 * - {@link RollbackStaleError} when the live state no longer matches `expectedCurrentStateHash`.
 * - {@link RollbackPostVerifyError} when the recompiled state does not match the snapshot.
 */
export async function restore(
  snapshotId: number,
  expectedCurrentStateHash: string,
  options: RestoreOptions = {}
): Promise<RollbackResult> {
  const recovery = options.recovery ?? false;
  const deps = options.deps ?? defaultDeps;

  const snapshot = pcdSnapshotQueries.getById(snapshotId);
  if (!snapshot) {
    throw new Error(`Snapshot ${snapshotId} not found`);
  }
  const { databaseId } = snapshot;

  // 1. Re-verify — never restore an unverified snapshot.
  const verification = await verifySnapshot(snapshot);
  if (!verification.reconstructable) {
    throw new RollbackUnverifiableError(verification.reason ?? 'Snapshot cannot be safely restored');
  }

  const targetOpIds = snapshotPublishedOpIds(snapshotId);
  if (targetOpIds === null) {
    throw new RollbackUnverifiableError('Snapshot has no published-op manifest and cannot be restored');
  }

  // 2. From-state value-guard (skipped during internal recovery).
  if (!recovery) {
    const liveHash = await computeStateHash(databaseId);
    if (expectedCurrentStateHash !== (liveHash ?? '')) {
      throw new RollbackStaleError('Database state changed since preview; regenerate the preview and retry');
    }
  }

  // 3. Resolve the PCD path.
  const instance = databaseInstancesQueries.getById(databaseId);
  if (!instance) {
    throw new Error(`Database instance ${databaseId} not found`);
  }
  const pcdPath = instance.local_path;

  // 4. Durable pre-rollback capture (never auto-pruned) so this rollback is reversible.
  let preRollbackSnapshotId: number | null = null;
  if (!recovery) {
    const meta = computeOpsMetadata(databaseId);
    const preSnapshot = pcdSnapshotQueries.create({
      databaseId,
      type: 'manual',
      trigger: 'rollback',
      description: `Pre-rollback auto-capture before restoring snapshot #${snapshotId}`,
      opsSequenceMaxId: meta.opsSequenceMaxId,
      opsCountBase: meta.opsCountBase,
      opsCountUser: meta.opsCountUser,
      cacheStateHash: await computeStateHash(databaseId),
      publishedOpIds: computePublishedOpIds(databaseId),
    });
    preRollbackSnapshotId = preSnapshot.id;
  }

  // 5. Rewind the op log + record the audit row (transactional).
  const { rollbackId, opsUndone, opsReactivated } = applyRewind(
    databaseId,
    snapshotId,
    targetOpIds,
    snapshot.cacheStateHash,
    preRollbackSnapshotId
  );

  // 6. Recompile the live cache AFTER commit.
  await deps.compile(pcdPath, databaseId);

  // 7. Post-verify the recompiled state against the snapshot fingerprint.
  const postHash = await computeStateHash(databaseId);
  if (postHash !== snapshot.cacheStateHash) {
    const message = `Post-rollback fingerprint mismatch (expected ${snapshot.cacheStateHash}, got ${postHash})`;
    rollbackQueries.updateStatus(rollbackId, 'failed', message);
    await logger.error('Rollback post-verify failed', {
      source: 'RollbackRestore',
      meta: { snapshotId, databaseId, rollbackId, expected: snapshot.cacheStateHash, actual: postHash },
    });

    // Best-effort recovery: restore the pre-rollback snapshot. {recovery:true} guarantees
    // termination (no capture, no nested recovery).
    if (!recovery && preRollbackSnapshotId !== null) {
      try {
        await restore(preRollbackSnapshotId, postHash ?? '', { recovery: true, deps });
      } catch (recoveryError) {
        await logger.error('Rollback recovery failed; PCD state may be inconsistent', {
          source: 'RollbackRestore',
          meta: {
            snapshotId,
            databaseId,
            preRollbackSnapshotId,
            error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
          },
        });
      }
    }

    throw new RollbackPostVerifyError(message);
  }

  const detail = rollbackQueries.getById(rollbackId);
  return {
    rollbackId,
    snapshotId,
    databaseId,
    status: 'success',
    opsUndone,
    opsReactivated,
    preRollbackSnapshotId,
    targetStateHash: snapshot.cacheStateHash,
    postVerified: true,
    error: null,
    createdAt: detail?.createdAt ?? '',
  };
}
