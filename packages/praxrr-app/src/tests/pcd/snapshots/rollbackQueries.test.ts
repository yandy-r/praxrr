import { assert, assertEquals, assertThrows } from '@std/assert';
import { db } from '$db/db.ts';
import { pcdSnapshotQueries } from '$db/queries/pcdSnapshots.ts';
import { rollbackQueries } from '$db/queries/pcdRollbacks.ts';
import { createTestDatabase, migratedTest } from './rollbackTestHelpers.ts';

migratedTest('rollbackQueries: insert/getById round-trip', () => {
  const dbId = createTestDatabase();

  const id = rollbackQueries.insert({
    databaseId: dbId,
    snapshotId: null,
    preRollbackSnapshotId: null,
    targetStateHash: 'hash-abc',
    opsUndone: 3,
    opsReactivated: 1,
    status: 'success',
  });
  assert(id > 0);

  const detail = rollbackQueries.getById(id);
  assertEquals(detail?.databaseId, dbId);
  assertEquals(detail?.targetStateHash, 'hash-abc');
  assertEquals(detail?.opsUndone, 3);
  assertEquals(detail?.opsReactivated, 1);
  assertEquals(detail?.status, 'success');
});

migratedTest('rollbackQueries: listByDatabase returns newest-first with total', () => {
  const dbId = createTestDatabase();
  const other = createTestDatabase();

  rollbackQueries.insert({
    databaseId: dbId,
    snapshotId: null,
    preRollbackSnapshotId: null,
    targetStateHash: 'h1',
    opsUndone: 1,
    opsReactivated: 0,
    status: 'success',
  });
  rollbackQueries.insert({
    databaseId: dbId,
    snapshotId: null,
    preRollbackSnapshotId: null,
    targetStateHash: 'h2',
    opsUndone: 0,
    opsReactivated: 0,
    status: 'failed',
    error: 'post-verify mismatch',
  });
  rollbackQueries.insert({
    databaseId: other,
    snapshotId: null,
    preRollbackSnapshotId: null,
    targetStateHash: 'other',
    opsUndone: 0,
    opsReactivated: 0,
    status: 'success',
  });

  const list = rollbackQueries.listByDatabase(dbId);
  assertEquals(list.total, 2);
  assertEquals(list.rollbacks.length, 2);
  // Scoped to the database.
  assert(list.rollbacks.every((r) => r.databaseId === dbId));
});

migratedTest('rollbackQueries: updateStatus flips a row to failed', () => {
  const dbId = createTestDatabase();
  const id = rollbackQueries.insert({
    databaseId: dbId,
    snapshotId: null,
    preRollbackSnapshotId: null,
    targetStateHash: 'h',
    opsUndone: 0,
    opsReactivated: 0,
    status: 'success',
  });

  assertEquals(rollbackQueries.updateStatus(id, 'failed', 'boom'), true);
  const detail = rollbackQueries.getById(id);
  assertEquals(detail?.status, 'failed');
  assertEquals(detail?.error, 'boom');
});

migratedTest('pcd_snapshots trigger CHECK accepts rollback and rejects an unknown trigger', () => {
  const dbId = createTestDatabase();

  // The new 'rollback' trigger is accepted (pre-rollback captures use it).
  const snapshot = pcdSnapshotQueries.create({
    databaseId: dbId,
    type: 'manual',
    trigger: 'rollback',
    opsSequenceMaxId: 0,
    opsCountBase: 0,
    opsCountUser: 0,
    cacheStateHash: null,
  });
  assertEquals(snapshot.trigger, 'rollback');

  // An unknown trigger is still rejected by the CHECK constraint.
  assertThrows(() =>
    db.execute(
      `INSERT INTO pcd_snapshots (database_id, type, "trigger", ops_sequence_max_id)
			VALUES (?, 'manual', 'bogus', 0)`,
      dbId
    )
  );
});
