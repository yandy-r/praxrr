import { assertEquals, assertExists, assertStringIncludes } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { compile, invalidate } from '$pcd/database/compiler.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import { overrideConflict } from '$pcd/conflicts/override.ts';

/**
 * YAN-465: a failed conflict override used to leave the user op `dropped` (and the conflict
 * gone). These tests drive the real override path against a migrated scratch DB and assert the op
 * is restored to `published` and still listed as a conflict.
 */
function overrideTest(name: string, fn: () => Promise<void>): void {
  Deno.test({
    name,
    sanitizeResources: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/override-conflict-restore-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);

      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        invalidate(1);
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

function seedConflictedUserOp(options: { enabled: boolean; operation: string }): { databaseId: number; opId: number } {
  const databaseId = 1;
  db.execute(
    `INSERT INTO database_instances (id, uuid, name, repository_url, local_path, enabled)
		VALUES (?, 'uuid-1', 'db-one', 'https://example.com/db.git', '/nonexistent/praxrr-override-restore', ?)`,
    databaseId,
    options.enabled ? 1 : 0
  );
  const opId = pcdOpsQueries.create({
    databaseId,
    origin: 'user',
    state: 'published',
    source: 'local',
    sql: 'SELECT 1',
    metadata: JSON.stringify({
      operation: options.operation,
      entity: 'regular_expression',
      name: 'Upstream Deleted Regex',
    }),
    desiredState: JSON.stringify({ pattern: { from: 'a', to: 'b' } }),
  });
  pcdOpHistoryQueries.create({
    opId,
    databaseId,
    batchId: 'batch-1',
    status: 'conflicted',
    conflictReason: 'guard failed',
  });
  return { databaseId, opId };
}

function conflictedHistoryRows(opId: number) {
  return pcdOpHistoryQueries.listByOp(opId).filter((row) => row.status === 'conflicted');
}

function assertConflictStillPending(databaseId: number, opId: number): void {
  const op = pcdOpsQueries.getById(opId);
  assertExists(op);
  assertEquals(op.state, 'published');
  assertEquals(op.superseded_by_op_id, null);

  const history = pcdOpHistoryQueries.listByOp(opId);
  assertEquals(
    history.filter((row) => row.status === 'dropped'),
    []
  );

  const conflicts = pcdOpHistoryQueries.listLatestConflictsByDatabase(databaseId);
  assertEquals(
    conflicts.map((c) => [c.op.id, c.history.status]),
    [[opId, 'conflicted']]
  );
}

overrideTest('overrideConflict restores the op when the entity override returns success:false', async () => {
  // Instance disabled: no compile; the regex override fails because no cache is registered.
  const { databaseId, opId } = seedConflictedUserOp({ enabled: false, operation: 'update' });

  const result = await overrideConflict({ databaseId, opId });

  assertEquals(result.success, false);
  assertEquals(result.error, 'Cache not available');
  assertConflictStillPending(databaseId, opId);
});

overrideTest('overrideConflict restores the op when the entity override throws', async () => {
  // Enabled instance: compile builds an empty cache (no PCD tables), so the regex override throws
  // `no such table: regular_expressions` after the op was dropped.
  const { databaseId, opId } = seedConflictedUserOp({ enabled: true, operation: 'update' });

  const conflictedBefore = conflictedHistoryRows(opId).length;

  const result = await overrideConflict({ databaseId, opId });

  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'no such table');
  assertConflictStillPending(databaseId, opId);
  // Manual path: the restore recompile must not auto-retry the override, so it adds exactly one
  // conflicted row (the restored op re-evaluated) and no dropped/superseded rows.
  assertEquals(conflictedHistoryRows(opId).length, conflictedBefore + 1);
});

// ---------------------------------------------------------------------------
// Partial writes: a custom_format create override writes a published user op (and recompiles)
// in its first step; a later step throws. The whole attempt must be undone.
// ---------------------------------------------------------------------------

const SCHEMA_OPS_DIR = new URL('../../../../../praxrr-schema/ops/', import.meta.url).pathname;

async function createPcdRepoDir(): Promise<string> {
  const pcdPath = await Deno.makeTempDir({ prefix: 'override-restore-pcd-' });
  await Deno.mkdir(`${pcdPath}/deps/schema/ops`, { recursive: true });
  await Deno.mkdir(`${pcdPath}/tweaks`, { recursive: true });
  for await (const entry of Deno.readDir(SCHEMA_OPS_DIR)) {
    if (entry.isFile && entry.name.endsWith('.sql')) {
      await Deno.copyFile(`${SCHEMA_OPS_DIR}${entry.name}`, `${pcdPath}/deps/schema/ops/${entry.name}`);
    }
  }
  return pcdPath;
}

function opSnapshot(): unknown[] {
  return db.query(
    `SELECT id, origin, state, source, sql, metadata, desired_state, superseded_by_op_id, updated_at
		FROM pcd_ops ORDER BY id`
  );
}

overrideTest('overrideConflict undoes partial writes when a later override step throws', async () => {
  const pcdPath = await createPcdRepoDir();
  try {
    const databaseId = 1;
    db.execute(
      `INSERT INTO database_instances (id, uuid, name, repository_url, local_path, enabled, conflict_strategy)
			VALUES (?, 'uuid-1', 'db-one', 'https://example.com/db.git', ?, 1, 'override')`,
      databaseId,
      pcdPath
    );

    // Unrelated published user op that must survive untouched.
    const bystanderId = pcdOpsQueries.create({
      databaseId,
      origin: 'user',
      state: 'published',
      source: 'local',
      sql: "INSERT INTO custom_formats (name, description) VALUES ('Bystander', '')",
      metadata: JSON.stringify({ operation: 'create', entity: 'custom_format', name: 'Bystander' }),
    });

    // Conflicted user create op: its SQL updates a row that does not exist (rowcount 0 -> conflict).
    // The override re-creates the format via overrideGeneral (step 1, succeeds and writes an op)
    // and then overrideConditions throws on a condition with two patterns (step 2).
    const opId = pcdOpsQueries.create({
      databaseId,
      origin: 'user',
      state: 'published',
      source: 'local',
      sql: "UPDATE custom_formats SET description = 'x' WHERE name = 'Partial CF' AND description = 'never'",
      metadata: JSON.stringify({ operation: 'create', entity: 'custom_format', name: 'Partial CF' }),
      desiredState: JSON.stringify({
        name: 'Partial CF',
        conditions: {
          added: [
            {
              name: 'Two patterns',
              base: { type: 'release_title', arrType: 'all', negate: false, required: false },
              values: { patterns: [{ name: 'a' }, { name: 'b' }] },
            },
          ],
        },
      }),
    });

    // Build the cache once so the conflict is recorded the way the conflicts page sees it.
    await compile(pcdPath, databaseId);
    assertEquals(
      pcdOpHistoryQueries.listLatestConflictsByDatabase(databaseId).map((c) => c.op.id),
      [opId]
    );
    const before = opSnapshot();
    const conflictedBefore = conflictedHistoryRows(opId).length;

    const result = await overrideConflict({ databaseId, opId });

    assertEquals(result.success, false);
    assertStringIncludes(result.error ?? '', 'single pattern');

    // No extra published user op survives; every pre-existing op is unchanged.
    assertEquals(opSnapshot(), before);
    assertEquals(pcdOpsQueries.getById(bystanderId)?.state, 'published');
    assertConflictStillPending(databaseId, opId);
    // Exactly one new conflicted row (the restore compile re-evaluating the original op): no retry.
    assertEquals(conflictedHistoryRows(opId).length, conflictedBefore + 1);
  } finally {
    invalidate(1);
    await Deno.remove(pcdPath, { recursive: true }).catch(() => {});
  }
});
