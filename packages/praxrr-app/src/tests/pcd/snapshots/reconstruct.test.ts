import { assert, assertEquals } from '@std/assert';
import { db } from '$db/db.ts';
import { computeStateHash } from '$pcd/snapshots/fingerprint.ts';
import { reconstructSnapshotOpIds, verifySnapshot } from '$pcd/snapshots/reconstruct.ts';
import type { PcdSnapshotDetail } from '$pcd/snapshots/types.ts';
import { createTestDatabase, insertOp, migratedTest } from './rollbackTestHelpers.ts';

function snapshotStub(databaseId: number, opsSequenceMaxId: number, cacheStateHash: string | null): PcdSnapshotDetail {
  return {
    id: 1,
    databaseId,
    type: 'manual',
    trigger: 'manual',
    description: null,
    opsSequenceMaxId,
    opsCountBase: 0,
    opsCountUser: 0,
    cacheStateHash,
    targetInstanceIds: null,
    createdAt: '2026-07-09 00:00:00',
  };
}

migratedTest('reconstruct: includes supersede-after-N, excludes supersede-before-N, drafts, and toxic rows', () => {
  const dbId = createTestDatabase();
  const N = 5;

  // Insert every row first (superseded_by_op_id is a self-FK to pcd_ops, so targets must
  // exist before the pointer is set).
  insertOp({ id: 1, databaseId: dbId, origin: 'base', state: 'published' }); // plain published -> include
  insertOp({ id: 2, databaseId: dbId, state: 'superseded' }); // superseded AFTER N (set below) -> include
  insertOp({ id: 3, databaseId: dbId, state: 'dropped' }); // dropped, NULL back-pointer -> optimistic include
  insertOp({ id: 4, databaseId: dbId, state: 'superseded' }); // superseded ON/before N (set below) -> exclude
  insertOp({ id: 5, databaseId: dbId, state: 'draft' }); // draft was not published at N -> exclude
  insertOp({ id: 6, databaseId: dbId, state: 'superseded', supersededByOpId: null }); // toxic: superseded + NULL -> exclude
  insertOp({ id: 9, databaseId: dbId, state: 'published' }); // id > N -> exclude

  db.execute('UPDATE pcd_ops SET superseded_by_op_id = 9 WHERE database_id = ? AND id = 2', dbId); // 9 > N
  db.execute('UPDATE pcd_ops SET superseded_by_op_id = 5 WHERE database_id = ? AND id = 4', dbId); // 5 <= N

  const ids = reconstructSnapshotOpIds(dbId, N);
  assertEquals(
    [...ids].sort((a, b) => a - b),
    [1, 2, 3]
  );
});

migratedTest('reconstruct: verify passes for a faithful snapshot and fails after tampering a pre-N op', async () => {
  const dbId = createTestDatabase();

  // Capture point: two published ops, interleaved base + user, N = 2.
  insertOp({ id: 1, databaseId: dbId, origin: 'base', state: 'published', contentHash: 'c1' });
  insertOp({ id: 2, databaseId: dbId, origin: 'user', state: 'published', contentHash: 'c2' });
  const capturedHash = await computeStateHash(dbId);
  assert(capturedHash !== null);

  // After capture: op 3 supersedes op 1 (id 3 > N=2).
  insertOp({ id: 3, databaseId: dbId, origin: 'user', state: 'published', contentHash: 'c3' });
  db_update_supersede(dbId, 1, 3);

  const snapshot = snapshotStub(dbId, 2, capturedHash);
  const ok = await verifySnapshot(snapshot);
  assertEquals(ok.reconstructable, true);
  assertEquals(ok.recomputedHash, capturedHash);

  // Tamper a pre-N op's content -> fingerprint diverges -> fail-closed.
  db_tamper_content(dbId, 1, 'tampered');
  const bad = await verifySnapshot(snapshot);
  assertEquals(bad.reconstructable, false);
  assert(bad.reason !== null);
});

migratedTest('reconstruct: NULL content_hash op verifies true (fallback hash reproduced)', async () => {
  const dbId = createTestDatabase();
  insertOp({
    id: 1,
    databaseId: dbId,
    origin: 'base',
    state: 'published',
    contentHash: null,
    sql: 'SEED',
    metadata: null,
  });
  insertOp({ id: 2, databaseId: dbId, origin: 'user', state: 'published', contentHash: 'c2' });
  const capturedHash = await computeStateHash(dbId);

  const snapshot = snapshotStub(dbId, 2, capturedHash);
  const result = await verifySnapshot(snapshot);
  assertEquals(result.reconstructable, true);
});

migratedTest('reconstruct: legacy snapshot with NULL cacheStateHash is not restorable', async () => {
  const dbId = createTestDatabase();
  insertOp({ id: 1, databaseId: dbId, state: 'published' });
  const snapshot = snapshotStub(dbId, 1, null);
  const result = await verifySnapshot(snapshot);
  assertEquals(result.reconstructable, false);
});

// -- local raw-SQL mutators (kept out of the shared helper: rollback-reconstruct-specific) --

function db_update_supersede(databaseId: number, opId: number, bySupersedingId: number): void {
  db.execute(
    "UPDATE pcd_ops SET state = 'superseded', superseded_by_op_id = ? WHERE database_id = ? AND id = ?",
    bySupersedingId,
    databaseId,
    opId
  );
}

function db_tamper_content(databaseId: number, opId: number, contentHash: string): void {
  db.execute('UPDATE pcd_ops SET content_hash = ? WHERE database_id = ? AND id = ?', contentHash, databaseId, opId);
}
