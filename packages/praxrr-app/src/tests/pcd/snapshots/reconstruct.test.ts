import { assert, assertEquals } from '@std/assert';
import { db } from '$db/db.ts';
import { pcdSnapshotQueries } from '$db/queries/pcdSnapshots.ts';
import { computePublishedOpIds, computeStateHash } from '$pcd/snapshots/fingerprint.ts';
import { snapshotPublishedOpIds, verifySnapshot } from '$pcd/snapshots/reconstruct.ts';
import type { PcdSnapshotDetail } from '$pcd/snapshots/types.ts';
import { createTestDatabase, insertOp, migratedTest } from './rollbackTestHelpers.ts';

/** Capture a manifest-backed manual snapshot of the current published state. */
async function captureSnapshot(dbId: number): Promise<PcdSnapshotDetail> {
  return pcdSnapshotQueries.create({
    databaseId: dbId,
    type: 'manual',
    trigger: 'manual',
    opsSequenceMaxId: 0,
    opsCountBase: 0,
    opsCountUser: 0,
    cacheStateHash: await computeStateHash(dbId),
    publishedOpIds: computePublishedOpIds(dbId),
  });
}

migratedTest('snapshotPublishedOpIds returns the captured manifest set, null for legacy', () => {
  const dbId = createTestDatabase();
  insertOp({ id: 1, databaseId: dbId, state: 'published' });
  insertOp({ id: 2, databaseId: dbId, state: 'published' });

  const withManifest = pcdSnapshotQueries.create({
    databaseId: dbId,
    type: 'manual',
    trigger: 'manual',
    opsSequenceMaxId: 2,
    opsCountBase: 0,
    opsCountUser: 2,
    cacheStateHash: 'h',
    publishedOpIds: [1, 2],
  });
  assertEquals([...(snapshotPublishedOpIds(withManifest.id) ?? new Set())].sort(), [1, 2]);

  const legacy = pcdSnapshotQueries.create({
    databaseId: dbId,
    type: 'manual',
    trigger: 'manual',
    opsSequenceMaxId: 2,
    opsCountBase: 0,
    opsCountUser: 2,
    cacheStateHash: 'h',
    // no publishedOpIds → NULL manifest
  });
  assertEquals(snapshotPublishedOpIds(legacy.id), null);
});

migratedTest('verifySnapshot passes for a faithful manifest snapshot', async () => {
  const dbId = createTestDatabase();
  insertOp({ id: 1, databaseId: dbId, origin: 'base', state: 'published', contentHash: 'c1' });
  insertOp({ id: 2, databaseId: dbId, origin: 'user', state: 'published', contentHash: 'c2' });
  const snapshot = await captureSnapshot(dbId);

  // Later churn: op 3 supersedes op 1. The manifest is immutable, so verify still passes.
  insertOp({ id: 3, databaseId: dbId, origin: 'user', state: 'published', contentHash: 'c3' });
  db.execute("UPDATE pcd_ops SET state = 'superseded', superseded_by_op_id = 3 WHERE database_id = ? AND id = 1", dbId);

  const result = await verifySnapshot(snapshot);
  assertEquals(result.reconstructable, true);
  assertEquals(result.recomputedHash, snapshot.cacheStateHash);
});

migratedTest('verifySnapshot fails (fail-closed) when a manifest op content changed', async () => {
  const dbId = createTestDatabase();
  insertOp({ id: 1, databaseId: dbId, origin: 'base', state: 'published', contentHash: 'c1' });
  insertOp({ id: 2, databaseId: dbId, origin: 'user', state: 'published', contentHash: 'c2' });
  const snapshot = await captureSnapshot(dbId);

  db.execute('UPDATE pcd_ops SET content_hash = ? WHERE database_id = ? AND id = 1', 'tampered', dbId);
  const result = await verifySnapshot(snapshot);
  assertEquals(result.reconstructable, false);
  assert(result.reason !== null);
});

migratedTest('verifySnapshot fails when a manifest op no longer exists', async () => {
  const dbId = createTestDatabase();
  insertOp({ id: 1, databaseId: dbId, origin: 'base', state: 'published', contentHash: 'c1' });
  insertOp({ id: 2, databaseId: dbId, origin: 'user', state: 'published', contentHash: 'c2' });
  const snapshot = await captureSnapshot(dbId);

  db.execute('DELETE FROM pcd_ops WHERE database_id = ? AND id = 2', dbId);
  const result = await verifySnapshot(snapshot);
  assertEquals(result.reconstructable, false);
});

migratedTest('verifySnapshot: NULL content_hash op verifies true (fallback hash reproduced)', async () => {
  const dbId = createTestDatabase();
  insertOp({ id: 1, databaseId: dbId, origin: 'base', state: 'published', contentHash: null, sql: 'SEED', metadata: null });
  insertOp({ id: 2, databaseId: dbId, origin: 'user', state: 'published', contentHash: 'c2' });
  const snapshot = await captureSnapshot(dbId);

  const result = await verifySnapshot(snapshot);
  assertEquals(result.reconstructable, true);
});

migratedTest('verifySnapshot: legacy snapshot without a manifest is not restorable', async () => {
  const dbId = createTestDatabase();
  insertOp({ id: 1, databaseId: dbId, state: 'published' });
  const legacy = pcdSnapshotQueries.create({
    databaseId: dbId,
    type: 'manual',
    trigger: 'manual',
    opsSequenceMaxId: 1,
    opsCountBase: 0,
    opsCountUser: 1,
    cacheStateHash: 'whatever',
    // no manifest
  });
  const result = await verifySnapshot(legacy);
  assertEquals(result.reconstructable, false);
});
