/**
 * PCD Snapshot Reconstruction + Verification (issue #16).
 *
 * A snapshot captures an immutable manifest of the exact `pcd_ops.id`s that were
 * `state='published'` at capture time (`published_op_ids`). Rollback replays THIS manifest —
 * it never derives historical membership from the mutable op-state columns (`state`,
 * `superseded_by_op_id`), because a later supersede/reactivate cycle rewrites those columns
 * and would corrupt the reconstruction of any snapshot taken across it. Because op rows are
 * never hard-deleted at runtime, a manifest id always resolves to its original immutable SQL.
 *
 * `verifySnapshot` is the fail-closed gate: it replays the manifest, recomputes the canonical
 * fingerprint, and only reports `reconstructable` when it matches the stored
 * `cache_state_hash`. Legacy snapshots without a manifest (captured before this column
 * existed) are never restorable.
 */

import { db } from '$db/db.ts';
import { pcdSnapshotQueries } from '$db/queries/pcdSnapshots.ts';
import type { PcdSnapshotDetail } from './types.ts';
import { computeStateFingerprint, type FingerprintOpRow } from './fingerprint.ts';

export interface VerifyResult {
  reconstructable: boolean;
  reason: string | null;
  recomputedHash: string | null;
}

/** Load the manifest's op rows (id order) for hashing/replay. */
function loadManifestRows(databaseId: number, opIds: readonly number[]): FingerprintOpRow[] {
  if (opIds.length === 0) {
    return [];
  }
  const placeholders = opIds.map(() => '?').join(', ');
  return db.query<FingerprintOpRow>(
    `SELECT id, origin, sequence, state, source, content_hash, sql, metadata
		FROM pcd_ops
		WHERE database_id = ? AND id IN (${placeholders})
		ORDER BY id`,
    databaseId,
    ...opIds
  );
}

/**
 * The snapshot's captured published-op-id set, or null when the snapshot has no manifest
 * (legacy) — in which case it is not restorable.
 */
export function snapshotPublishedOpIds(snapshotId: number): Set<number> | null {
  const ids = pcdSnapshotQueries.getPublishedOpIds(snapshotId);
  return ids ? new Set(ids) : null;
}

/**
 * Verify a snapshot is safely restorable: the manifest must exist, all its op rows must still
 * exist, and the fingerprint recomputed over them (each forced to `state='published'`, as at
 * capture) must equal the stored `cacheStateHash`. Any gap fails closed.
 */
export async function verifySnapshot(snapshot: PcdSnapshotDetail): Promise<VerifyResult> {
  const ids = pcdSnapshotQueries.getPublishedOpIds(snapshot.id);
  if (ids === null) {
    return {
      reconstructable: false,
      reason: 'Snapshot has no published-op manifest (legacy snapshot) and cannot be safely restored',
      recomputedHash: null,
    };
  }

  const rows = loadManifestRows(snapshot.databaseId, ids);
  if (rows.length !== ids.length) {
    return {
      reconstructable: false,
      reason: 'Some ops recorded in this snapshot no longer exist; it cannot be reconstructed',
      recomputedHash: null,
    };
  }

  const recomputedHash = await computeStateFingerprint(rows, { forceStatePublished: true });
  if (recomputedHash === snapshot.cacheStateHash) {
    return { reconstructable: true, reason: null, recomputedHash };
  }

  return {
    reconstructable: false,
    reason: 'Reconstructed state fingerprint does not match the snapshot; op content changed since capture (fail-closed)',
    recomputedHash,
  };
}
