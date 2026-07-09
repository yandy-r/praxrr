import { assert, assertEquals, assertRejects } from '@std/assert';
import { db } from '$db/db.ts';
import { pcdSnapshotQueries } from '$db/queries/pcdSnapshots.ts';
import { rollbackQueries } from '$db/queries/pcdRollbacks.ts';
import { computeStateHash } from '$pcd/snapshots/fingerprint.ts';
import { computeRewindSets, restore, type RestoreDeps } from '$pcd/snapshots/rollback/restore.ts';
import { RollbackStaleError, RollbackUnverifiableError } from '$pcd/snapshots/rollback/types.ts';
import { createTestDatabase, insertOp, migratedTest, opRowCount, publishedOpIds } from './rollbackTestHelpers.ts';

/** No-op compile so restore can be tested without a PCD checkout on disk. */
const noopCompile: RestoreDeps['compile'] = async () => ({ schema: 0, base: 0, tweaks: 0, user: 0, timing: 0 });
const deps: RestoreDeps = { compile: noopCompile };

function sortedIds(set: Set<number>): number[] {
  return [...set].sort((a, b) => a - b);
}

function createSnapshot(dbId: number, opsSequenceMaxId: number, cacheStateHash: string | null) {
  return pcdSnapshotQueries.create({
    databaseId: dbId,
    type: 'manual',
    trigger: 'manual',
    opsSequenceMaxId,
    opsCountBase: 1,
    opsCountUser: 1,
    cacheStateHash,
  });
}

Deno.test('computeRewindSets: undo extras, reactivate missing, no-op when equal', () => {
  assertEquals(computeRewindSets(new Set([2, 3]), new Set([1, 2])), { undoIds: [3], reactivateIds: [1] });
  assertEquals(computeRewindSets(new Set([1, 2]), new Set([1, 2])), { undoIds: [], reactivateIds: [] });
});

migratedTest('restore: undoes ops after the snapshot, post-verifies, and is append-only', async () => {
  const dbId = createTestDatabase();
  insertOp({ id: 1, databaseId: dbId, origin: 'base', state: 'published', contentHash: 'c1' });
  insertOp({ id: 2, databaseId: dbId, origin: 'user', state: 'published', contentHash: 'c2' });
  const hashAtSnapshot = await computeStateHash(dbId);
  const snapshot = createSnapshot(dbId, 2, hashAtSnapshot);

  // A new op written after the snapshot.
  insertOp({ id: 3, databaseId: dbId, origin: 'user', state: 'published', contentHash: 'c3' });
  const currentHash = await computeStateHash(dbId);
  const rowsBefore = opRowCount(dbId);

  const result = await restore(snapshot.id, currentHash ?? '', { deps });

  assertEquals(result.status, 'success');
  assertEquals(result.postVerified, true);
  assertEquals(result.opsUndone, 1);
  assertEquals(result.opsReactivated, 0);
  assert(result.preRollbackSnapshotId !== null);

  // Published set is back to the snapshot state.
  assertEquals(sortedIds(publishedOpIds(dbId)), [1, 2]);

  // Audit row recorded.
  const audit = rollbackQueries.getById(result.rollbackId);
  assertEquals(audit?.status, 'success');
  assertEquals(audit?.snapshotId, snapshot.id);

  // Pre-rollback capture is a durable manual snapshot tagged 'rollback'.
  const pre = pcdSnapshotQueries.getById(result.preRollbackSnapshotId ?? -1);
  assertEquals(pre?.type, 'manual');
  assertEquals(pre?.trigger, 'rollback');

  // Append-only: original ops still present; only the boundary marker was added, nothing deleted.
  assertEquals(opRowCount(dbId), rowsBefore + 1);
  for (const id of [1, 2, 3]) {
    const exists = db.queryFirst<{ id: number }>('SELECT id FROM pcd_ops WHERE database_id = ? AND id = ?', dbId, id);
    assert(exists, `op ${id} must still exist`);
  }
});

migratedTest('restore: reactivates a pre-snapshot op superseded after the snapshot', async () => {
  const dbId = createTestDatabase();
  insertOp({ id: 1, databaseId: dbId, origin: 'user', state: 'published', contentHash: 'c1' });
  insertOp({ id: 2, databaseId: dbId, origin: 'user', state: 'published', contentHash: 'c2' });
  const hashAtSnapshot = await computeStateHash(dbId);
  const snapshot = createSnapshot(dbId, 2, hashAtSnapshot);

  // op 3 supersedes op 1 after the snapshot.
  insertOp({ id: 3, databaseId: dbId, origin: 'user', state: 'published', contentHash: 'c3' });
  db.execute("UPDATE pcd_ops SET state = 'superseded', superseded_by_op_id = 3 WHERE database_id = ? AND id = 1", dbId);
  const currentHash = await computeStateHash(dbId);

  const result = await restore(snapshot.id, currentHash ?? '', { deps });

  assertEquals(result.status, 'success');
  assertEquals(result.postVerified, true);
  assertEquals(result.opsUndone, 1); // op 3
  assertEquals(result.opsReactivated, 1); // op 1
  assertEquals(sortedIds(publishedOpIds(dbId)), [1, 2]);
});

migratedTest('restore: is reversible via the pre-rollback snapshot (undo-only case)', async () => {
  const dbId = createTestDatabase();
  insertOp({ id: 1, databaseId: dbId, origin: 'base', state: 'published', contentHash: 'c1' });
  insertOp({ id: 2, databaseId: dbId, origin: 'user', state: 'published', contentHash: 'c2' });
  const hashAtSnapshot = await computeStateHash(dbId);
  const snapshot = createSnapshot(dbId, 2, hashAtSnapshot);

  insertOp({ id: 3, databaseId: dbId, origin: 'user', state: 'published', contentHash: 'c3' });
  const beforeRollbackHash = await computeStateHash(dbId);

  const result = await restore(snapshot.id, beforeRollbackHash ?? '', { deps });
  assertEquals(sortedIds(publishedOpIds(dbId)), [1, 2]);

  // Reverse: restore the pre-rollback snapshot to get back to {1,2,3}.
  const afterRollbackHash = await computeStateHash(dbId);
  const reversal = await restore(result.preRollbackSnapshotId ?? -1, afterRollbackHash ?? '', { deps });
  assertEquals(reversal.status, 'success');
  assertEquals(reversal.postVerified, true);
  assertEquals(sortedIds(publishedOpIds(dbId)), [1, 2, 3]);
});

migratedTest('restore: rejects a stale from-state hash without mutating anything', async () => {
  const dbId = createTestDatabase();
  insertOp({ id: 1, databaseId: dbId, origin: 'user', state: 'published', contentHash: 'c1' });
  const hashAtSnapshot = await computeStateHash(dbId);
  const snapshot = createSnapshot(dbId, 1, hashAtSnapshot);
  const rowsBefore = opRowCount(dbId);

  await assertRejects(() => restore(snapshot.id, 'not-the-current-hash', { deps }), RollbackStaleError);

  assertEquals(opRowCount(dbId), rowsBefore); // no marker, no mutation
});

migratedTest('restore: refuses an unverifiable (legacy, no fingerprint) snapshot', async () => {
  const dbId = createTestDatabase();
  insertOp({ id: 1, databaseId: dbId, origin: 'user', state: 'published', contentHash: 'c1' });
  const snapshot = createSnapshot(dbId, 1, null);

  await assertRejects(() => restore(snapshot.id, '', { deps }), RollbackUnverifiableError);
});
