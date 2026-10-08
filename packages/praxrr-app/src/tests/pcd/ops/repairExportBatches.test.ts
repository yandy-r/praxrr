// YAN-746 regression: legacy export batch ops (written before the export_batch metadata
// flag existed) must be repairable explicitly: published rows get flagged, orphaned rows
// are republished only when the upstream entity is unchanged, stale ones are skipped.

import { assertEquals } from '@std/assert';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import { repairExportBatchOps } from '$pcd/ops/repairExportBatches.ts';
import { createTestDatabase, insertOp, migratedTest } from '../snapshots/rollbackTestHelpers.ts';

const SCHEMA_SQL = Deno.readTextFileSync(new URL('../../../../../praxrr-schema/ops/0.schema.sql', import.meta.url));

const NO_FLAG_METADATA = JSON.stringify({
  operation: 'export',
  entity: 'batch',
  name: 'export batch',
  opIds: [],
  exported_at: '2026-01-01T00:00:00Z',
});

const FLAGGED_METADATA = JSON.stringify({ ...JSON.parse(NO_FLAG_METADATA), export_batch: true });

/** Bare pcdPath with a schema deps dir so the export snapshot cache can replay ops. */
async function seedRepo(pcdPath: string): Promise<void> {
  await Deno.mkdir(`${pcdPath}/deps/schema/ops`, { recursive: true });
  await Deno.writeTextFile(`${pcdPath}/deps/schema/ops/0.schema.sql`, SCHEMA_SQL);
}

function batchSql(entities: string[]): string {
  return entities
    .map((entity, index) => `-- --- BEGIN op ${index + 1} ( update custom_format "${entity}" )`)
    .join('\n');
}

migratedTest('repairExportBatchOps: flags a published pre-flag batch row', async () => {
  const pcdPath = `/tmp/praxrr-tests/repair-${crypto.randomUUID()}`;
  await seedRepo(pcdPath);
  const databaseId = createTestDatabase(pcdPath);
  try {
    insertOp({
      id: 1,
      databaseId,
      origin: 'base',
      state: 'published',
      source: 'repo',
      sql: "-- --- BEGIN op 1 ( update custom_format \"CF A\" )\nUPDATE custom_formats SET description = 'x' WHERE name = 'CF A';",
      metadata: NO_FLAG_METADATA,
    });

    const result = await repairExportBatchOps(databaseId);
    assertEquals(result.inspected, 1);
    assertEquals(result.flagged, 1);
    assertEquals(result.republished, 0);
    assertEquals(result.skipped, []);

    const row = pcdOpsQueries.getById(1);
    assertEquals(row?.state, 'published');
    assertEquals(JSON.parse(row?.metadata ?? '{}').export_batch, true);
  } finally {
    await Deno.remove(pcdPath, { recursive: true }).catch(() => {});
  }
});

migratedTest('repairExportBatchOps: republishes an orphaned batch when upstream is unchanged', async () => {
  const pcdPath = `/tmp/praxrr-tests/repair-${crypto.randomUUID()}`;
  await seedRepo(pcdPath);
  const databaseId = createTestDatabase(pcdPath);
  try {
    // Published base state: CF A description 'a'. The orphaned batch op would set the
    // same value, so replaying it is a no-op and republish is safe.
    insertOp({
      id: 1,
      databaseId,
      origin: 'base',
      state: 'published',
      source: 'repo',
      sequence: 1,
      sql: "INSERT INTO custom_formats (name, description, include_in_rename) VALUES ('CF A', 'a', 0);",
    });
    insertOp({
      id: 2,
      databaseId,
      origin: 'base',
      state: 'orphaned',
      source: 'repo',
      sequence: 3,
      sql: `${batchSql(['CF A'])}\nUPDATE custom_formats SET description = 'a' WHERE name = 'CF A';`,
      metadata: NO_FLAG_METADATA,
    });

    const result = await repairExportBatchOps(databaseId);
    assertEquals(result.inspected, 1);
    assertEquals(result.flagged, 0);
    assertEquals(result.republished, 1);
    assertEquals(result.skipped, []);

    const row = pcdOpsQueries.getById(2);
    assertEquals(row?.state, 'published');
    assertEquals(JSON.parse(row?.metadata ?? '{}').export_batch, true);
  } finally {
    await Deno.remove(pcdPath, { recursive: true }).catch(() => {});
  }
});

migratedTest('repairExportBatchOps: skips an orphaned batch when upstream diverged', async () => {
  const pcdPath = `/tmp/praxrr-tests/repair-${crypto.randomUUID()}`;
  await seedRepo(pcdPath);
  const databaseId = createTestDatabase(pcdPath);
  try {
    insertOp({
      id: 1,
      databaseId,
      origin: 'base',
      state: 'published',
      source: 'repo',
      sequence: 1,
      sql: "INSERT INTO custom_formats (name, description, include_in_rename) VALUES ('CF B', 'orig', 0);",
    });
    // A newer published base op moved the description forward; the orphaned batch op
    // would set 'old-new' over that newer upstream state.
    insertOp({
      id: 3,
      databaseId,
      origin: 'base',
      state: 'published',
      source: 'repo',
      sequence: 2,
      sql: "UPDATE custom_formats SET description = 'evolved' WHERE name = 'CF B';",
    });
    insertOp({
      id: 4,
      databaseId,
      origin: 'base',
      state: 'orphaned',
      source: 'repo',
      sequence: 3,
      sql: `${batchSql(['CF B'])}\nUPDATE custom_formats SET description = 'old-new' WHERE name = 'CF B';`,
      metadata: NO_FLAG_METADATA,
    });

    const result = await repairExportBatchOps(databaseId);
    assertEquals(result.inspected, 1);
    assertEquals(result.flagged, 0);
    assertEquals(result.republished, 0);
    assertEquals(result.skipped.length, 1);
    assertEquals(result.skipped[0].entity, 'custom_format');
    assertEquals(result.skipped[0].name, 'CF B');
    assertEquals(result.skipped[0].reason, 'upstream changed since export');

    const row = pcdOpsQueries.getById(4);
    assertEquals(row?.state, 'orphaned');
    assertEquals(JSON.parse(row?.metadata ?? '{}').export_batch, undefined);
  } finally {
    await Deno.remove(pcdPath, { recursive: true }).catch(() => {});
  }
});

migratedTest('repairExportBatchOps: leaves already-flagged batch rows untouched', async () => {
  const pcdPath = `/tmp/praxrr-tests/repair-${crypto.randomUUID()}`;
  await seedRepo(pcdPath);
  const databaseId = createTestDatabase(pcdPath);
  try {
    insertOp({
      id: 1,
      databaseId,
      origin: 'base',
      state: 'published',
      source: 'repo',
      sql: '-- noop',
      metadata: FLAGGED_METADATA,
    });

    const result = await repairExportBatchOps(databaseId);
    assertEquals(result.inspected, 0);
    assertEquals(result.flagged, 0);
    assertEquals(result.republished, 0);
    assertEquals(result.skipped, []);
  } finally {
    await Deno.remove(pcdPath, { recursive: true }).catch(() => {});
  }
});
