import { assert, assertEquals, assertExists } from '@std/assert';
import { db } from '$db/db.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import { type CreatedOpRecord, withOpCreationRecorder } from '$db/opCreationRecorder.ts';
import { createTestDatabase, migratedTest } from '../pcd/snapshots/rollbackTestHelpers.ts';

const OLD = '2020-01-01T00:00:00.000Z';

function seedStaleBase(databaseId: number, name: string, metadata: string | null, lastSeen: string | null): number {
  return pcdOpsQueries.create({
    databaseId,
    origin: 'base',
    state: 'published',
    source: 'repo',
    filename: `${name}.sql`,
    sql: `SELECT '${name}'`,
    metadata,
    lastSeenInRepoAt: lastSeen,
  });
}

migratedTest('markBaseOrphaned spares only export_batch=true; malformed/NULL/absent sweep without throwing', () => {
  const dbA = createTestDatabase();
  const dbB = createTestDatabase();

  const flagged = seedStaleBase(dbA, 'flagged', '{"export_batch":true}', OLD);
  const unflagged = [
    seedStaleBase(dbA, 'false', '{"export_batch":false}', OLD),
    seedStaleBase(dbA, 'absent', '{"operation":"export"}', null),
    seedStaleBase(dbA, 'null', null, OLD),
    seedStaleBase(dbA, 'malformed', '{not json', null),
  ];
  const otherDb = seedStaleBase(dbB, 'other', '{"operation":"export"}', OLD);

  const swept = pcdOpsQueries.markBaseOrphaned(dbA, new Date().toISOString());

  assertEquals(swept, unflagged.length);
  assertEquals(pcdOpsQueries.getById(flagged)?.state, 'published');
  for (const id of unflagged) assertEquals(pcdOpsQueries.getById(id)?.state, 'orphaned');
  assertEquals(pcdOpsQueries.getById(otherDb)?.state, 'published');
});

migratedTest('restoreImportSnapshot restores pre-import rows exactly and deletes only recorded rows', async () => {
  const databaseId = createTestDatabase();

  const baseId = pcdOpsQueries.create({
    databaseId,
    origin: 'base',
    state: 'published',
    source: 'repo',
    filename: '1.base.sql',
    opNumber: 1,
    sequence: 1,
    sql: 'SELECT 1',
    metadata: '{"operation":"create"}',
    contentHash: 'h1',
    lastSeenInRepoAt: OLD,
  });
  const userId = pcdOpsQueries.create({
    databaseId,
    origin: 'user',
    state: 'published',
    source: 'local',
    sequence: 2,
    sql: 'SELECT 2',
  });
  // Pin updated_at so a stamped CURRENT_TIMESTAMP would be detectable.
  db.execute("UPDATE pcd_ops SET updated_at = '2020-01-01 00:00:00' WHERE database_id = ?", databaseId);
  const preHistoryId = pcdOpHistoryQueries.create({ opId: baseId, databaseId, batchId: 'pre', status: 'applied' });

  const snapshot = pcdOpsQueries.listByDatabase(databaseId);
  const created: CreatedOpRecord = { opIds: [], historyIds: [] };

  const { createdId, createdHistoryId, survivingHistoryId } = await withOpCreationRecorder(created, async () => {
    await Promise.resolve();
    const createdId = pcdOpsQueries.create({
      databaseId,
      origin: 'base',
      state: 'published',
      source: 'import',
      sql: 'SELECT 3',
    });
    // Mutate pre-existing rows the way an import does.
    pcdOpsQueries.update(baseId, { sql: 'SELECT mutated', state: 'superseded', supersededByOpId: createdId });
    pcdOpsQueries.update(userId, { state: 'dropped', supersededByOpId: createdId });
    return {
      createdId,
      createdHistoryId: pcdOpHistoryQueries.create({ opId: createdId, databaseId, batchId: 'imp', status: 'applied' }),
      survivingHistoryId: pcdOpHistoryQueries.create({ opId: baseId, databaseId, batchId: 'imp', status: 'skipped' }),
    };
  });

  // Unrelated concurrent insert (outside the recorder) pointing at the created op: self-FK must be cleared.
  const unrelatedId = pcdOpsQueries.create({
    databaseId,
    origin: 'user',
    state: 'published',
    source: 'local',
    sql: 'SELECT 4',
    supersededByOpId: createdId,
  });

  assert(created.opIds.includes(createdId));
  assert(created.historyIds.includes(createdHistoryId) && created.historyIds.includes(survivingHistoryId));
  assert(!created.opIds.includes(unrelatedId));

  pcdOpsQueries.restoreImportSnapshot(databaseId, snapshot, created);

  for (const row of snapshot) assertEquals(pcdOpsQueries.getById(row.id), row);
  assertEquals(pcdOpsQueries.getById(createdId), undefined);
  assertEquals(pcdOpHistoryQueries.listByOp(createdId), []);
  assertEquals(
    pcdOpHistoryQueries.listByDatabase(databaseId).map((h) => h.id),
    [preHistoryId]
  );
  const unrelated = pcdOpsQueries.getById(unrelatedId);
  assertExists(unrelated);
  assertEquals(unrelated.superseded_by_op_id, null);
});

migratedTest('restoreImportSnapshot deletes >600 chained created ops within SQLite variable limits', async () => {
  const databaseId = createTestDatabase();
  const snapshot = pcdOpsQueries.listByDatabase(databaseId);
  const created: CreatedOpRecord = { opIds: [], historyIds: [] };

  await withOpCreationRecorder(created, async () => {
    let previous: number | undefined;
    for (let i = 0; i < 650; i++) {
      // Each created op points at the previous one: deletes must not trip the NO ACTION self-FK.
      previous = pcdOpsQueries.create({
        databaseId,
        origin: 'base',
        state: 'superseded',
        source: 'import',
        sql: `SELECT ${i}`,
        supersededByOpId: previous,
      });
    }
    await Promise.resolve();
  });

  assertEquals(created.opIds.length, 650);
  pcdOpsQueries.restoreImportSnapshot(databaseId, snapshot, created);
  assertEquals(pcdOpsQueries.listByDatabase(databaseId), []);
});

migratedTest('restoreImportSnapshot never deletes ids belonging to another database', () => {
  const dbA = createTestDatabase();
  const dbB = createTestDatabase();
  const aId = seedStaleBase(dbA, 'a', null, OLD);
  const bId = seedStaleBase(dbB, 'b', null, OLD);
  const snapshot = pcdOpsQueries.listByDatabase(dbA);

  // Foreign-db id in the record must not be deleted (database_id guard).
  pcdOpsQueries.restoreImportSnapshot(dbA, snapshot, { opIds: [bId], historyIds: [] });

  assertEquals(pcdOpsQueries.getById(aId), snapshot[0]);
  assertExists(pcdOpsQueries.getById(bId));
});
