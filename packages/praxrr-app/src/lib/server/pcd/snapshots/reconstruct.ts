/**
 * PCD Snapshot Reconstruction + Verification (issue #16).
 *
 * A snapshot stores a marker (`ops_sequence_max_id = N`) plus a fingerprint
 * (`cache_state_hash`), NOT a copy of state. `pcd_ops` rows are append-only, but the
 * `state` column is mutated destructively (published → superseded/dropped/orphaned), so a
 * naive `id <= N AND state='published'` replay is unsound. This module reconstructs the set
 * of ops that were published AT capture time (`T`) and then verifies it against the stored
 * fingerprint — restore proceeds only on a match (fail-closed).
 *
 * Membership of `T` (see the corrected predicate below):
 *   id <= N AND state != 'draft'
 *     AND ( superseded_by_op_id > N                          -- superseded AFTER N (datable)
 *        OR (superseded_by_op_id IS NULL AND state != 'superseded') )  -- still active
 * This includes ops superseded after N, currently-published ops, and undatable
 * dropped/orphaned ops (optimistic — the fingerprint rejects an over/under-inclusion). It
 * excludes drafts, ops superseded on/before N, and "superseded with a NULL back-pointer"
 * rows (never included merely because the pointer is NULL — e.g. a legacy naive-rollback
 * artifact). Supersession is the one datable transition: the superseding op always has a
 * higher id, so `superseded_by_op_id > N` means it was still published at N.
 */

import { db } from '$db/db.ts';
import type { PcdSnapshotDetail } from './types.ts';
import { computeStateFingerprint, type FingerprintOpRow } from './fingerprint.ts';

export interface VerifyResult {
  reconstructable: boolean;
  reason: string | null;
  recomputedHash: string | null;
}

/**
 * Reconstruct the ordered set of op rows that were published at snapshot time (`N`).
 * Rows are ordered by `id` ascending to match `computeStateHash`'s canonical ordering.
 */
export function reconstructSnapshotOpRows(databaseId: number, opsSequenceMaxId: number): FingerprintOpRow[] {
  return db.query<FingerprintOpRow>(
    `SELECT id, origin, sequence, state, source, content_hash, sql, metadata
		FROM pcd_ops
		WHERE database_id = ?
			AND id <= ?
			AND state != 'draft'
			AND (superseded_by_op_id > ? OR (superseded_by_op_id IS NULL AND state != 'superseded'))
		ORDER BY id`,
    databaseId,
    opsSequenceMaxId,
    opsSequenceMaxId
  );
}

/**
 * The reconstructed published-op id set for a snapshot — the exact ops a snapshot replay /
 * restore must apply.
 */
export function reconstructSnapshotOpIds(databaseId: number, opsSequenceMaxId: number): Set<number> {
  const rows = reconstructSnapshotOpRows(databaseId, opsSequenceMaxId);
  return new Set(rows.map((row) => row.id));
}

/**
 * Verify a snapshot is safely restorable: reconstruct `T`, recompute its fingerprint (with
 * every member's `state` forced to `'published'`, matching what capture saw), and compare to
 * the stored `cacheStateHash`. A null stored hash (legacy snapshot) or any mismatch is
 * reported as non-reconstructable — restore then refuses (fail-closed).
 */
export async function verifySnapshot(snapshot: PcdSnapshotDetail): Promise<VerifyResult> {
  if (snapshot.cacheStateHash === null) {
    return {
      reconstructable: false,
      reason: 'Snapshot has no state fingerprint (legacy snapshot) and cannot be safely restored',
      recomputedHash: null,
    };
  }

  const rows = reconstructSnapshotOpRows(snapshot.databaseId, snapshot.opsSequenceMaxId);
  const recomputedHash = await computeStateFingerprint(rows, { forceStatePublished: true });

  if (recomputedHash === snapshot.cacheStateHash) {
    return { reconstructable: true, reason: null, recomputedHash };
  }

  return {
    reconstructable: false,
    reason:
      'Reconstructed state fingerprint does not match the snapshot; the op history has diverged since capture (fail-closed)',
    recomputedHash,
  };
}
