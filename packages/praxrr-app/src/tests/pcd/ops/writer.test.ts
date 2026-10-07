import { Database } from '@jsr/db__sqlite';
import { assertEquals, assertMatch } from '@std/assert';
import { deleteCache, setCache } from '$pcd/database/registry.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { __testOnly_runValueGuardGate, __testOnly_supersedePriorUserOps } from '$pcd/ops/writer.ts';
import type { OperationMetadata } from '$pcd/core/types.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import type { PCDCache } from '$pcd/database/cache.ts';
import { buildContentHash, type PcdOp, pcdOpsQueries } from '$db/queries/pcdOps.ts';

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

// YAN-462: a prior user op may be superseded only when it is redundant, never when it
// produces the pre-image the new op's guard was built on.
type PriorSpec = { changed: string[]; desired: unknown };

function supersedeHarness(entity: string, priors: PriorSpec[]) {
  const restores: Array<() => void> = [];
  const superseded: number[] = [];
  const ops = priors.map(
    ({ changed, desired }, index) =>
      ({
        id: index + 1,
        metadata: JSON.stringify({
          operation: 'update',
          entity,
          name: 'Foo',
          stable_key: { key: 'name', value: 'Foo' },
          changed_fields: changed,
        }),
        desired_state: desired === undefined ? null : JSON.stringify(desired),
      }) as unknown as PcdOp
  );
  patch(pcdOpsQueries, 'listByDatabaseAndOrigin', () => ops, restores);
  patch(
    pcdOpsQueries,
    'update',
    (id: number) => {
      superseded.push(id);
      return true;
    },
    restores
  );
  patch(pcdOpHistoryQueries, 'create', () => 1, restores);
  return { restores, superseded };
}

const pattern = (from: string, to: string) => ({ pattern: { from, to } });

const supersedeCases: Array<{
  label: string;
  entity: string;
  changed: string[];
  priors: PriorSpec[];
  next: Record<string, unknown>;
  expected: number[];
}> = [
  {
    label: 'keeps chained edit a->b, b->c',
    entity: 'regular_expression',
    changed: ['pattern'],
    priors: [{ changed: ['pattern'], desired: pattern('a', 'b') }],
    next: pattern('b', 'c'),
    expected: [],
  },
  {
    label: 'keeps every link of a longer chain a->b, b->c, c->d',
    entity: 'regular_expression',
    changed: ['pattern'],
    priors: [
      { changed: ['pattern'], desired: pattern('a', 'b') },
      { changed: ['pattern'], desired: pattern('b', 'c') },
    ],
    next: pattern('c', 'd'),
    expected: [],
  },
  {
    label: 'supersedes same pre-image a->b, a->d',
    entity: 'regular_expression',
    changed: ['pattern'],
    priors: [{ changed: ['pattern'], desired: pattern('a', 'b') }],
    next: pattern('a', 'd'),
    expected: [1],
  },
  {
    label: 'keeps same pre-image prior that carries a tag delta',
    entity: 'regular_expression',
    changed: ['pattern', 'tags'],
    priors: [
      {
        changed: ['pattern', 'tags'],
        desired: { ...pattern('a', 'b'), tags: { add: ['X'], remove: [] } },
      },
    ],
    next: { ...pattern('a', 'd'), tags: { add: ['Y'], remove: [] } },
    expected: [],
  },
  {
    label: 'supersedes same pre-image when changed_fields are camelCase',
    entity: 'delay_profile',
    changed: ['usenetDelay'],
    priors: [{ changed: ['usenetDelay'], desired: { usenet_delay: { from: 60, to: 120 } } }],
    next: { usenet_delay: { from: 60, to: 90 } },
    expected: [1],
  },
  {
    label: 'supersedes nothing when any prior desired_state is unknown',
    entity: 'regular_expression',
    changed: ['pattern'],
    priors: [
      { changed: ['pattern'], desired: pattern('a', 'z') },
      { changed: ['pattern'], desired: pattern('a', 'd') },
      { changed: ['pattern'], desired: undefined },
    ],
    next: pattern('a', 'x'),
    expected: [],
  },
  {
    label: 'keeps prior op without desired_state',
    entity: 'regular_expression',
    changed: ['pattern'],
    priors: [{ changed: ['pattern'], desired: undefined }],
    next: pattern('b', 'c'),
    expected: [],
  },
];

for (const { label, entity, changed, priors, next, expected } of supersedeCases) {
  Deno.test(`writer: supersedePriorUserOps ${label}`, async () => {
    const { restores, superseded } = supersedeHarness(entity, priors);
    try {
      await __testOnly_supersedePriorUserOps(
        9200,
        priors.length + 1,
        {
          operation: 'update',
          entity,
          name: 'Foo',
          stableKey: { key: 'name', value: 'Foo' },
          changedFields: changed,
        } satisfies OperationMetadata,
        next
      );
      assertEquals(superseded, expected);
    } finally {
      for (const restore of restores.reverse()) restore();
    }
  });
}
