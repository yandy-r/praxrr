// Test strategy note: `loadAllOperations` (imported by cache.ts from `../ops/loadOps.ts`) is a
// bare named export, not an object method. Under Deno's native ESM, a module namespace object's
// bindings are read-only (`namespace.fn = ...` throws), so it cannot be monkeypatched the way
// `pcdOpsQueries.update`/`pcdOpHistoryQueries.create` (object methods) can via `patchTarget`
// below — see `packages/praxrr-app/src/tests/pcd/ops/importBaseOps.test.ts` for the same
// `import * as mod` read-only-destructure convention used elsewhere in this codebase. So this
// suite exercises the REAL `buildReadOnly()` end-to-end against a temp-dir `pcdPath` (schema +
// tweaks ops as files, matching `loadOps.ts`'s file-based layers) while patching the DB-backed
// base/user layers via `pcdOpsQueries.listByDatabaseAndOrigin` (an object method, patchable).
// `pcdOpsQueries.update` and `pcdOpHistoryQueries.create` are spied on to assert zero writes.

import { assert, assertEquals } from '@std/assert';
import { PCDCache } from '$pcd/index.ts';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import type { ListPcdOpsOptions, PcdOp, PcdOpOrigin, UpdatePcdOpInput } from '$db/queries/pcdOps.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import type { CreatePcdOpHistoryInput } from '$db/queries/pcdOpHistory.ts';
import { logger } from '$logger/logger.ts';

type Restore = () => void;
type Restores = Restore[];

const DATABASE_ID = 90210;

function patchTarget<T extends object, K extends keyof T>(
  target: T,
  key: K,
  replacement: T[K],
  restores: Restore[]
): void {
  const original = target[key];
  target[key] = replacement;
  restores.push(() => {
    target[key] = original;
  });
}

function patchLoggerForTest(restores: Restores, onWarn?: (message: string) => void): void {
  patchTarget(logger, 'debug', (async () => undefined) as typeof logger.debug, restores);
  patchTarget(logger, 'info', (async () => undefined) as typeof logger.info, restores);
  patchTarget(
    logger,
    'warn',
    (async (message: string) => {
      onWarn?.(message);
    }) as typeof logger.warn,
    restores
  );
  patchTarget(logger, 'error', (async () => undefined) as typeof logger.error, restores);
  patchTarget(logger, 'errorWithTrace', (async () => undefined) as typeof logger.errorWithTrace, restores);
}

function makeOpRow(overrides: Partial<PcdOp> & Pick<PcdOp, 'id' | 'sql'>): PcdOp {
  return {
    database_id: DATABASE_ID,
    origin: 'base',
    state: 'published',
    source: 'repo',
    filename: null,
    op_number: null,
    sequence: null,
    metadata: null,
    desired_state: null,
    content_hash: null,
    last_seen_in_repo_at: null,
    superseded_by_op_id: null,
    pushed_at: null,
    pushed_commit: null,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
    ...overrides,
  };
}

// Base layer: one valid insert + one op with invalid SQL (unknown column) that must be skipped
// without aborting the remaining operations.
const BASE_GOOD_OP = makeOpRow({
  id: 1,
  sequence: 1,
  filename: '1.base-good.sql',
  sql: "INSERT INTO items (name, layer) VALUES ('base-item', 'base')",
});
const BASE_BAD_OP = makeOpRow({
  id: 2,
  sequence: 2,
  filename: '2.base-bad.sql',
  sql: "INSERT INTO items (name, layer, does_not_exist) VALUES ('bad-item', 'base', 1)",
});
// User layer: must be excluded from the built cache when `layers` omits 'user'.
const USER_OP = makeOpRow({
  id: 3,
  origin: 'user',
  sequence: 4,
  filename: '4.user.sql',
  sql: "INSERT INTO items (name, layer) VALUES ('user-item', 'user')",
});

function stubListByDatabaseAndOrigin(_databaseId: number, origin: PcdOpOrigin, options?: ListPcdOpsOptions): PcdOp[] {
  const states = options?.states ?? [];
  if (origin === 'base' && states.includes('published')) {
    return [BASE_GOOD_OP, BASE_BAD_OP];
  }
  if (origin === 'user' && states.includes('published')) {
    return [USER_OP];
  }
  return [];
}

async function createFixturePcdDir(): Promise<string> {
  const pcdPath = await Deno.makeTempDir({ prefix: 'pcd-build-read-only-' });
  await Deno.mkdir(`${pcdPath}/deps/schema/ops`, { recursive: true });
  await Deno.mkdir(`${pcdPath}/tweaks`, { recursive: true });

  await Deno.writeTextFile(
    `${pcdPath}/deps/schema/ops/0.schema.sql`,
    `CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  layer TEXT NOT NULL
);`
  );

  // Tweaks layer: file-based, applied after the base (DB) layer, before the user (DB) layer.
  await Deno.writeTextFile(
    `${pcdPath}/tweaks/3.tweak.sql`,
    "INSERT INTO items (name, layer) VALUES ('tweaks-item', 'tweaks');"
  );

  return pcdPath;
}

interface Fixture {
  cache: PCDCache;
  updateCalls: number[];
  historyCreateCalls: number[];
  warnMessages: string[];
  cleanup: () => Promise<void>;
}

async function setUpFixture(): Promise<Fixture> {
  const restores: Restores = [];
  const warnMessages: string[] = [];
  const updateCalls: number[] = [];
  const historyCreateCalls: number[] = [];

  patchLoggerForTest(restores, (message) => warnMessages.push(message));

  patchTarget(
    pcdOpsQueries,
    'listByDatabaseAndOrigin',
    stubListByDatabaseAndOrigin as typeof pcdOpsQueries.listByDatabaseAndOrigin,
    restores
  );

  patchTarget(
    pcdOpsQueries,
    'update',
    ((id: number, _input: UpdatePcdOpInput) => {
      updateCalls.push(id);
      return true;
    }) as typeof pcdOpsQueries.update,
    restores
  );

  patchTarget(
    pcdOpHistoryQueries,
    'create',
    ((input: CreatePcdOpHistoryInput) => {
      historyCreateCalls.push(input.opId);
      return 0;
    }) as typeof pcdOpHistoryQueries.create,
    restores
  );

  const pcdPath = await createFixturePcdDir();
  const cache = new PCDCache(pcdPath, DATABASE_ID);

  return {
    cache,
    updateCalls,
    historyCreateCalls,
    warnMessages,
    cleanup: async () => {
      cache.close();
      await Deno.remove(pcdPath, { recursive: true });
      for (const restore of restores.reverse()) {
        restore();
      }
    },
  };
}

Deno.test('PCDCache.buildReadOnly excludes the user layer and never writes pcdOps/pcdOpHistory', async () => {
  const fixture = await setUpFixture();

  try {
    await fixture.cache.buildReadOnly({ layers: new Set(['schema', 'base', 'tweaks']) });

    assertEquals(fixture.cache.isBuilt(), true);

    const rows = fixture.cache.query<{ name: string; layer: string }>('SELECT name, layer FROM items ORDER BY id');
    const names = rows.map((row) => row.name);

    assertEquals(names.includes('base-item'), true, 'valid base op should apply');
    assertEquals(names.includes('tweaks-item'), true, 'tweaks op after the failing base op should still apply');
    assertEquals(names.includes('bad-item'), false, 'op with invalid SQL must be skipped, not partially applied');
    assertEquals(names.includes('user-item'), false, 'user layer must be excluded when not requested');

    assertEquals(fixture.updateCalls.length, 0, 'buildReadOnly must never call pcdOpsQueries.update');
    assertEquals(fixture.historyCreateCalls.length, 0, 'buildReadOnly must never call pcdOpHistoryQueries.create');
    assert(
      fixture.warnMessages.some((message) => message.includes('skipping op')),
      'the failing op must be logged via logger.warn'
    );
  } finally {
    await fixture.cleanup();
  }
});

Deno.test('PCDCache.buildReadOnly includes the user layer when requested and still performs zero writes', async () => {
  const fixture = await setUpFixture();

  try {
    await fixture.cache.buildReadOnly({ layers: new Set(['schema', 'base', 'tweaks', 'user']) });

    assertEquals(fixture.cache.isBuilt(), true);

    const rows = fixture.cache.query<{ name: string }>('SELECT name FROM items ORDER BY id');
    const names = rows.map((row) => row.name);

    assertEquals(names.includes('user-item'), true, 'user layer must be included when requested');
    assertEquals(names.includes('bad-item'), false);

    assertEquals(fixture.updateCalls.length, 0, 'zero writes even when the user layer is in scope');
    assertEquals(fixture.historyCreateCalls.length, 0, 'zero writes even when the user layer is in scope');
  } finally {
    await fixture.cleanup();
  }
});

Deno.test('PCDCache.buildReadOnly result supports close(), resetting isBuilt() to false', async () => {
  const fixture = await setUpFixture();

  try {
    await fixture.cache.buildReadOnly({ layers: new Set(['schema', 'base']) });
    assertEquals(fixture.cache.isBuilt(), true);

    fixture.cache.close();
    assertEquals(fixture.cache.isBuilt(), false);
  } finally {
    // cache.close() above already closed the db; fixture.cleanup()'s close() call is a safe no-op.
    await fixture.cleanup();
  }
});
