import { Database } from '@jsr/db__sqlite';
import { assertEquals, assertMatch } from '@std/assert';
import { deleteCache, setCache } from '$pcd/database/registry.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { __testOnly_runValueGuardGate } from '$pcd/ops/writer.ts';
import type { PCDCache } from '$pcd/database/cache.ts';
import { buildContentHash } from '$db/queries/pcdOps.ts';

function patch<T extends object, K extends keyof T>(
  target: T,
  key: K,
  replacement: T[K],
  restores: Array<() => void>
): void {
  const original = target[key];
  target[key] = replacement;
  restores.push(() => {
    target[key] = original;
  });
}

Deno.test('writer: runValueGuardGate rolls back all statements when a multi-op sequence fails', () => {
  const restores: Array<() => void> = [];
  const databaseId = 9101;
  const cacheDb = new Database(':memory:', { int64: true });
  const tableName = 'pcd_writer_gate_test';

  try {
    cacheDb.exec(`CREATE TABLE ${tableName} (name TEXT PRIMARY KEY)`);
    setCache(databaseId, {
      getRawDb: () => cacheDb,
      close: () => {},
    } as unknown as PCDCache);

    patch(
      databaseInstancesQueries,
      'getById',
      () => ({
        id: databaseId,
        uuid: 'writer-gate',
        name: 'writer-gate',
        repository_url: '',
        local_path: '',
        sync_strategy: 0,
        auto_pull: 1,
        enabled: 1,
        personal_access_token: null,
        is_private: 0,
        local_ops_enabled: 0,
        git_user_name: null,
        git_user_email: null,
        conflict_strategy: 'override',
        last_synced_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
      restores
    );

    const result = __testOnly_runValueGuardGate(databaseId, 'user', [
      {
        sql: `INSERT INTO ${tableName} (name) VALUES ('dup')`,
      },
      {
        sql: `INSERT INTO ${tableName} (name) VALUES ('dup')`,
        metadata: {
          operation: 'create',
          entity: 'custom_entity',
          name: 'dup',
        },
      },
    ]);

    assertEquals(result.ok, false);
    if (!result.ok) {
      assertMatch(result.error, /operation 2/);
    }

    const count = cacheDb.prepare(`SELECT COUNT(*) as total FROM ${tableName}`).get() as { total: number };
    assertEquals(count.total, 0);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
    cacheDb.close();
    deleteCache(databaseId);
  }
});

Deno.test('writer: runValueGuardGate bypasses savepoint checks without cache for non-user layers', () => {
  const result = __testOnly_runValueGuardGate(9102, 'base', [
    {
      sql: 'CREATE TABLE should_not_exist (id INTEGER)',
    },
  ]);

  assertEquals(result, { ok: true });
});

Deno.test('writer: runValueGuardGate skips empty SQL statements', () => {
  const restores: Array<() => void> = [];
  const databaseId = 9103;
  const cacheDb = new Database(':memory:', { int64: true });

  try {
    cacheDb.exec('CREATE TABLE pcd_writer_gate_empty (name TEXT)');
    setCache(databaseId, {
      getRawDb: () => cacheDb,
      close: () => {},
    } as unknown as PCDCache);

    patch(
      databaseInstancesQueries,
      'getById',
      () => ({
        id: databaseId,
        uuid: 'writer-gate-empty',
        name: 'writer-gate-empty',
        repository_url: '',
        local_path: '',
        sync_strategy: 0,
        auto_pull: 1,
        enabled: 1,
        personal_access_token: null,
        is_private: 0,
        local_ops_enabled: 0,
        git_user_name: null,
        git_user_email: null,
        conflict_strategy: 'override',
        last_synced_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
      restores
    );

    const result = __testOnly_runValueGuardGate(databaseId, 'user', [{ sql: '   ' }]);

    assertEquals(result, { ok: true });
    const count = cacheDb.prepare('SELECT COUNT(*) as total FROM pcd_writer_gate_empty').get() as { total: number };
    assertEquals(count.total, 0);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
    cacheDb.close();
    deleteCache(databaseId);
  }
});

Deno.test('pcdOps: buildContentHash is deterministic for SQL payloads', async () => {
  assertEquals(
    await buildContentHash('CREATE TABLE x (id INTEGER);', '{"operation":"create"}'),
    '4887682114438c9438001a61c3c88a128f5b3332e5f3ccbf0c2a3f0c91d0dcf0'
  );

  assertEquals(
    await buildContentHash('INSERT INTO t VALUES (1);', null),
    'ded6194afab0fba8959725b981c2f9a089f131f83b175c06a1a82166decaa6ea'
  );

  assertEquals(
    await buildContentHash('INSERT INTO t VALUES (1);', 'null'),
    'b7f15d99947c7d1c7a34b702cc79e44a7bf002b38c3b2a2b3b02a23166a3b493'
  );
});
