/**
 * Scoped cache registry semantics (YAN-461).
 *
 * `withScopedCache` makes an ephemeral import cache visible to `getCache` for the
 * duration of a callback while the registered cache stays untouched for every other
 * reader. `compile()` must refuse to run inside a scope for the same database so a
 * mid-import full compile can never replay user ops against the partial base layer.
 */

import { assertEquals, assertRejects } from '@std/assert';
import { PCDCache } from '$pcd/database/cache.ts';
import {
  getCache,
  getRegisteredCache,
  isCacheScoped,
  setCache,
  deleteCache,
  withScopedCache,
} from '$pcd/database/registry.ts';
import { compile } from '$pcd/database/compiler.ts';

function stubCache(id: number): PCDCache {
  return {
    close: () => {},
    toString: () => `stub-cache-${id}`,
  } as unknown as PCDCache;
}

Deno.test('registry: withScopedCache overrides getCache inside the scope only', () => {
  const databaseId = 9301;
  const registered = stubCache(1);
  const scoped = stubCache(2);

  setCache(databaseId, registered);
  try {
    assertEquals(getCache(databaseId), registered);
    assertEquals(isCacheScoped(databaseId), false);

    withScopedCache(databaseId, scoped, () => {
      assertEquals(getCache(databaseId), scoped);
      assertEquals(getRegisteredCache(databaseId), registered);
      assertEquals(isCacheScoped(databaseId), true);
    });

    assertEquals(getCache(databaseId), registered);
    assertEquals(getRegisteredCache(databaseId), registered);
    assertEquals(isCacheScoped(databaseId), false);
  } finally {
    deleteCache(databaseId);
  }
});

Deno.test('registry: scopes are isolated per database id and not leaked between concurrent scopes', async () => {
  const first = 9302;
  const second = 9303;
  const registeredFirst = stubCache(3);
  setCache(first, registeredFirst);
  try {
    await withScopedCache(first, stubCache(4), async () => {
      assertEquals(getCache(first) !== registeredFirst, true);
      // Other database ids are untouched by the first scope...
      assertEquals(getCache(second), undefined);
      // ...and an inner scope for the second id sees its own override.
      await withScopedCache(second, stubCache(5), async () => {
        assertEquals(getCache(second) !== undefined, true);
        assertEquals(getCache(first) !== registeredFirst, true);
      });
      assertEquals(getCache(second), undefined);
    });
    assertEquals(getCache(first), registeredFirst);
  } finally {
    deleteCache(first);
  }
});

Deno.test('registry: compile() refuses to run inside a scoped import cache', async () => {
  const databaseId = 9304;
  try {
    await withScopedCache(databaseId, stubCache(6), async () => {
      await assertRejects(() => compile('/tmp/unused', databaseId), Error, 'cannot run inside a scoped import cache');
    });
  } finally {
    deleteCache(databaseId);
  }
});
