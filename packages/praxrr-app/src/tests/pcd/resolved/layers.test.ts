// Patch-and-restore idiom (mirrors `tests/pcd/resolved/cacheBuildReadOnly.test.ts` and
// `tests/pcd/resolved/liveDiff.test.ts`). Two different patch targets are used here,
// deliberately:
//
// - `databaseInstancesQueries.getById` is an object method (`db/queries/databaseInstances.ts`
//   exports a plain object of functions), so it is monkeypatched directly via
//   `patchTarget`, same as `pcdOpsQueries`/`pcdOpHistoryQueries` elsewhere.
// - `PCDCache.buildReadOnly`/`close` are class instance methods, not bare named function
//   exports (unlike `generatePreview` in `liveDiff.test.ts`), so they are equally
//   patchable as plain properties on `PCDCache.prototype` -- no `deps` injection
//   parameter is needed on `withBaseOnlyCache` for this.
// - `setCache` (registry.ts) IS a bare named function export and cannot be monkeypatched
//   the same way. Rather than reshaping `layers.ts` around it, these tests assert the
//   *behavioral* invariant directly: they call the real, unmocked `getCache()` from the
//   registry before/after `withBaseOnlyCache` runs and assert it stays `undefined` for
//   the test's database id -- proving the ephemeral cache was never registered, without
//   needing to intercept `setCache` itself.

import { assert, assertEquals, assertRejects } from '@std/assert';
import { PCDCache, getCache } from '$pcd/index.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import type { DatabaseInstance } from '$db/queries/databaseInstances.ts';
import { logger } from '$logger/logger.ts';
import { ResolvedConfigDatabaseNotFoundError, withBaseOnlyCache } from '$pcd/resolved/layers.ts';

type Restore = () => void;

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

function patchLoggerForTest(restores: Restore[]): void {
  patchTarget(logger, 'debug', (async () => undefined) as typeof logger.debug, restores);
}

// Distinctive id per test to guarantee no cross-test/registry collisions.
const DATABASE_ID = 555111;

function buildDatabaseInstance(overrides: Partial<DatabaseInstance> = {}): DatabaseInstance {
  return {
    id: DATABASE_ID,
    uuid: 'resolved-config-layers-test-uuid',
    name: 'Resolved Config Layers Test DB',
    repository_url: 'https://example.invalid/repo.git',
    local_path: '/tmp/resolved-config-layers-test-does-not-exist',
    sync_strategy: 0,
    auto_pull: 0,
    enabled: 1,
    personal_access_token: null,
    is_private: 0,
    local_ops_enabled: 0,
    git_user_name: null,
    git_user_email: null,
    conflict_strategy: 'override',
    last_synced_at: null,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
    ...overrides,
  };
}

interface PatchedCacheMethods {
  restores: Restore[];
  buildReadOnlyCalls: Array<{ layers: ReadonlySet<'schema' | 'base' | 'tweaks' | 'user'> }>;
  closeCalls: number;
}

function patchCacheMethods(options: {
  buildReadOnlyImpl?: (
    this: PCDCache,
    opts: { layers: ReadonlySet<'schema' | 'base' | 'tweaks' | 'user'> }
  ) => Promise<void>;
  databaseInstance?: DatabaseInstance | undefined;
}): PatchedCacheMethods {
  const restores: Restore[] = [];
  const buildReadOnlyCalls: Array<{ layers: ReadonlySet<'schema' | 'base' | 'tweaks' | 'user'> }> = [];
  let closeCalls = 0;

  patchLoggerForTest(restores);

  const buildReadOnlyImpl =
    options.buildReadOnlyImpl ??
    async function (this: PCDCache, _opts: { layers: ReadonlySet<'schema' | 'base' | 'tweaks' | 'user'> }) {
      // No-op success by default -- these tests exercise `withBaseOnlyCache`'s control
      // flow, not `buildReadOnly`'s own op-replay behavior (covered separately by
      // `cacheBuildReadOnly.test.ts`).
    };

  patchTarget(
    PCDCache.prototype,
    'buildReadOnly',
    async function (this: PCDCache, opts: { layers: ReadonlySet<'schema' | 'base' | 'tweaks' | 'user'> }) {
      buildReadOnlyCalls.push({ layers: opts.layers });
      return buildReadOnlyImpl.call(this, opts);
    } as typeof PCDCache.prototype.buildReadOnly,
    restores
  );

  patchTarget(
    PCDCache.prototype,
    'close',
    function (this: PCDCache) {
      closeCalls += 1;
    } as typeof PCDCache.prototype.close,
    restores
  );

  const databaseInstance = 'databaseInstance' in options ? options.databaseInstance : buildDatabaseInstance();
  patchTarget(
    databaseInstancesQueries,
    'getById',
    ((id: number) => (id === DATABASE_ID ? databaseInstance : undefined)) as typeof databaseInstancesQueries.getById,
    restores
  );

  return {
    restores,
    buildReadOnlyCalls,
    get closeCalls() {
      return closeCalls;
    },
  };
}

Deno.test('withBaseOnlyCache builds a schema+base+tweaks-only cache, runs fn, and closes it', async () => {
  const patched = patchCacheMethods({});

  try {
    let receivedCacheIsInstance = false;
    const result = await withBaseOnlyCache(DATABASE_ID, async (cache) => {
      receivedCacheIsInstance = cache instanceof PCDCache;
      return 'fn-result';
    });

    assertEquals(result, 'fn-result');
    assert(receivedCacheIsInstance, 'fn should receive the ephemeral PCDCache instance');
    assertEquals(patched.buildReadOnlyCalls.length, 1);
    assertEquals(
      [...patched.buildReadOnlyCalls[0].layers].sort(),
      ['base', 'schema', 'tweaks'],
      'must build schema+base+tweaks only, excluding the user layer'
    );
    assertEquals(patched.closeCalls, 1);
    assertEquals(getCache(DATABASE_ID), undefined, 'the ephemeral cache must never be registered via setCache');
  } finally {
    patched.restores.reverse().forEach((restore) => restore());
  }
});

Deno.test('withBaseOnlyCache always closes the cache even when fn throws', async () => {
  const patched = patchCacheMethods({});

  try {
    await assertRejects(
      () =>
        withBaseOnlyCache(DATABASE_ID, async () => {
          throw new Error('fn boom');
        }),
      Error,
      'fn boom'
    );

    assertEquals(patched.closeCalls, 1, 'close() must run even when fn throws');
    assertEquals(getCache(DATABASE_ID), undefined);
  } finally {
    patched.restores.reverse().forEach((restore) => restore());
  }
});

Deno.test('withBaseOnlyCache always closes the cache even when buildReadOnly throws', async () => {
  const patched = patchCacheMethods({
    buildReadOnlyImpl: async () => {
      throw new Error('buildReadOnly boom');
    },
  });

  try {
    let fnCalled = false;
    await assertRejects(
      () =>
        withBaseOnlyCache(DATABASE_ID, async () => {
          fnCalled = true;
          return 'unreachable';
        }),
      Error,
      'buildReadOnly boom'
    );

    assertEquals(fnCalled, false, 'fn must never run when buildReadOnly fails');
    assertEquals(patched.closeCalls, 1, 'close() must still run when buildReadOnly throws');
    assertEquals(getCache(DATABASE_ID), undefined);
  } finally {
    patched.restores.reverse().forEach((restore) => restore());
  }
});

Deno.test('withBaseOnlyCache throws ResolvedConfigDatabaseNotFoundError for an unknown databaseId', async () => {
  const patched = patchCacheMethods({ databaseInstance: undefined });

  try {
    await assertRejects(
      () => withBaseOnlyCache(DATABASE_ID, async () => 'unreachable'),
      ResolvedConfigDatabaseNotFoundError
    );

    assertEquals(
      patched.buildReadOnlyCalls.length,
      0,
      'buildReadOnly must never run without a resolved database instance'
    );
    assertEquals(patched.closeCalls, 0, 'no cache was ever constructed, so close() has nothing to do');
  } finally {
    patched.restores.reverse().forEach((restore) => restore());
  }
});

Deno.test('withBaseOnlyCache builds a fresh cache per call -- no memoization', async () => {
  const patched = patchCacheMethods({});

  try {
    const seenCaches: PCDCache[] = [];
    await withBaseOnlyCache(DATABASE_ID, async (cache) => {
      seenCaches.push(cache);
    });
    await withBaseOnlyCache(DATABASE_ID, async (cache) => {
      seenCaches.push(cache);
    });

    assertEquals(patched.buildReadOnlyCalls.length, 2, 'each call must build its own cache');
    assertEquals(patched.closeCalls, 2, 'each call must close its own cache');
    assert(seenCaches[0] !== seenCaches[1], 'the two calls must not share a cache instance');
  } finally {
    patched.restores.reverse().forEach((restore) => restore());
  }
});
