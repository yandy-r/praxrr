// T3: writer capture mode. Repo-import base writes made under `withBaseOpCapture` are returned in
// memory, applied to the scoped cache only, and never reach pcd_ops / pcd_op_history.

import { assert, assertEquals, assertRejects } from '@std/assert';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import { PCDCache } from '$pcd/database/cache.ts';
import { getCache, getRegisteredCache, withScopedCache } from '$pcd/database/registry.ts';
import { getEntityDeserializer } from '$pcd/entities/deserialize.ts';
import { withBaseOpCapture, withRepoImportWriteContext } from '$pcd/ops/writer.ts';
import { migratedTest } from '../snapshots/rollbackTestHelpers.ts';
import { cfYaml, setUpGitFixture, writeEntity } from './incomingTestHelpers.ts';

const NEW_CF = {
  name: 'Captured Format',
  description: 'captured',
  includeInRename: false,
  tags: [],
  conditions: [],
  tests: [],
};

migratedTest('withBaseOpCapture returns ops in memory and leaves pcd_ops/history untouched', async () => {
  const fixture = await setUpGitFixture(async (local) => {
    await writeEntity(local, 'custom-formats/existing.yaml', cfYaml('Existing', 'x'));
  });
  const { databaseId, localPath } = fixture;
  const scoped = new PCDCache(localPath, databaseId);
  try {
    await scoped.buildReadOnly({ layers: new Set(['schema', 'base', 'tweaks']) });
    const registered = getRegisteredCache(databaseId);
    const opsBefore = pcdOpsQueries.listByDatabase(databaseId);
    const historyBefore = pcdOpHistoryQueries.listByDatabase(databaseId);

    const captured = await withScopedCache(databaseId, scoped, () =>
      withRepoImportWriteContext(
        {
          filenamePrefix: 'entities/custom-formats/captured.yaml',
          sequenceStart: 4_000_000_000,
          maxOperations: 10_000,
          lastSeenInRepoAt: new Date().toISOString(),
        },
        async () => {
          const cache = getCache(databaseId)!;
          assert(cache === scoped, 'scoped cache must be visible to the writer');
          const { result, captured: ops } = await withBaseOpCapture(() =>
            getEntityDeserializer('custom_format')({ databaseId, cache, layer: 'base', data: NEW_CF })
          );
          assertEquals((result as { success: boolean }).success, true);
          return ops;
        }
      )
    );

    // Deterministic filenames/sequences exactly as a persisting import would assign.
    assert(captured.length > 0);
    captured.forEach((op, index) => {
      assertEquals(op.filename, `entities/custom-formats/captured.yaml#${String(index).padStart(5, '0')}.sql`);
      assertEquals(op.sequence, 4_000_000_000 + index);
      assert(op.sql.length > 0);
    });
    assert(captured[0].metadataJson?.includes('Captured Format'));

    // App DB untouched.
    assertEquals(pcdOpsQueries.listByDatabase(databaseId), opsBefore);
    assertEquals(pcdOpHistoryQueries.listByDatabase(databaseId), historyBefore);

    // Scoped cache holds the entity; the registered cache does not and was not swapped.
    const inScoped = await scoped.kb
      .selectFrom('custom_formats')
      .select('name')
      .where('name', '=', 'Captured Format')
      .executeTakeFirst();
    assertEquals(inScoped?.name, 'Captured Format');
    assert(getRegisteredCache(databaseId) === registered);
    const inRegistered = await registered!.kb
      .selectFrom('custom_formats')
      .select('name')
      .where('name', '=', 'Captured Format')
      .executeTakeFirst();
    assertEquals(inRegistered, undefined);
  } finally {
    scoped.close();
    await fixture.cleanup();
  }
});

migratedTest('withBaseOpCapture requires an active repo-import write context', async () => {
  await assertRejects(() => withBaseOpCapture(async () => 1), Error, 'withRepoImportWriteContext');
});
