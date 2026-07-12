// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals } from '@std/assert';
import { isPublicPath } from '$auth/middleware.ts';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { pluginRegistryQueries, type PluginRegistryRecord } from '$db/queries/pluginRegistry.ts';
import {
  pluginHost,
  UnavailablePluginExecutor,
  type PluginExecutionRequest,
  type PluginExecutor,
} from '$server/plugins/index.ts';
import type { PluginJsonValue, PluginManifest } from '$shared/plugins/index.ts';
import { GET as GET_LIST } from '../../routes/api/v1/plugins/+server.ts';
import { GET as GET_DETAIL } from '../../routes/api/v1/plugins/[apiVersion]/[id]/+server.ts';
import { POST as POST_ENABLE } from '../../routes/api/v1/plugins/[apiVersion]/[id]/enable/+server.ts';
import { POST as POST_DISABLE } from '../../routes/api/v1/plugins/[apiVersion]/[id]/disable/+server.ts';
import { POST as POST_RELOAD } from '../../routes/api/v1/plugins/reload/+server.ts';

type ListEvent = Parameters<typeof GET_LIST>[0];
type DetailEvent = Parameters<typeof GET_DETAIL>[0];
type EnableEvent = Parameters<typeof POST_ENABLE>[0];
type DisableEvent = Parameters<typeof POST_DISABLE>[0];
type ReloadEvent = Parameters<typeof POST_RELOAD>[0];

type PluginFlag = { pluginsEnabled: boolean };

const TEST_MANIFEST: PluginManifest = {
  apiVersion: '1',
  id: 'com.example.route',
  name: 'Route Plugin',
  version: '1.0.0',
  runtime: 'wasm',
  entry: 'plugin.wasm',
  extensionPoints: ['sync.previewComputed.observe'],
  capabilities: ['read:sync-preview'],
};

function migratedTest(name: string, fn: (pluginsDir: string) => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const originalPluginsDir = Deno.env.get('PLUGINS_DIR');
      const pluginsConfig = config as unknown as PluginFlag;
      const originalPluginsEnabled = pluginsConfig.pluginsEnabled;
      const tempBasePath = `/tmp/praxrr-tests/plugins-route-${crypto.randomUUID()}`;
      const pluginsDir = `${tempBasePath}/plugins`;
      await Deno.mkdir(pluginsDir, { recursive: true });

      db.close();
      pluginHost.reset();
      config.setBasePath(tempBasePath);
      Deno.env.set('PLUGINS_DIR', pluginsDir);

      try {
        await db.initialize();
        await runMigrations();
        await fn(pluginsDir);
      } finally {
        pluginsConfig.pluginsEnabled = originalPluginsEnabled;
        pluginHost.reset();
        db.close();
        config.setBasePath(originalBasePath);
        if (originalPluginsDir === undefined) {
          Deno.env.delete('PLUGINS_DIR');
        } else {
          Deno.env.set('PLUGINS_DIR', originalPluginsDir);
        }
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

async function withPluginsEnabled<T>(enabled: boolean, fn: () => Promise<T> | T): Promise<T> {
  const pluginsConfig = config as unknown as PluginFlag;
  const original = pluginsConfig.pluginsEnabled;
  pluginsConfig.pluginsEnabled = enabled;
  try {
    return await fn();
  } finally {
    pluginsConfig.pluginsEnabled = original;
  }
}

function requestContext(path: string, method: 'GET' | 'POST', headers: HeadersInit = {}) {
  const url = new URL(path, 'http://localhost');
  return {
    request: new Request(url, { method, headers }),
    url,
  };
}

function listEvent(headers: HeadersInit = {}): ListEvent {
  return requestContext('/api/v1/plugins', 'GET', headers) as unknown as ListEvent;
}

function detailEvent(apiVersion: string, id: string, headers: HeadersInit = {}): DetailEvent {
  return {
    ...requestContext(`/api/v1/plugins/${encodeURIComponent(apiVersion)}/${encodeURIComponent(id)}`, 'GET', headers),
    params: { apiVersion, id },
  } as unknown as DetailEvent;
}

function enableEvent(apiVersion: string, id: string, headers: HeadersInit = {}): EnableEvent {
  return {
    ...requestContext(
      `/api/v1/plugins/${encodeURIComponent(apiVersion)}/${encodeURIComponent(id)}/enable`,
      'POST',
      headers
    ),
    params: { apiVersion, id },
  } as unknown as EnableEvent;
}

function disableEvent(apiVersion: string, id: string, headers: HeadersInit = {}): DisableEvent {
  return {
    ...requestContext(
      `/api/v1/plugins/${encodeURIComponent(apiVersion)}/${encodeURIComponent(id)}/disable`,
      'POST',
      headers
    ),
    params: { apiVersion, id },
  } as unknown as DisableEvent;
}

function reloadEvent(headers: HeadersInit = {}): ReloadEvent {
  return requestContext('/api/v1/plugins/reload', 'POST', headers) as unknown as ReloadEvent;
}

async function jsonBody<T = Record<string, unknown>>(response: Response): Promise<T> {
  assertEquals(response.headers.get('cache-control'), 'no-store');
  return (await response.json()) as T;
}

async function assertOriginForbidden(response: Response): Promise<void> {
  assertEquals(response.status, 403);
  assertEquals(response.headers.get('cache-control'), 'no-store');
  assertEquals(await response.text(), '');
}

function assertRfc3339Timestamp(value: string): void {
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value), value);
  assertEquals(new Date(value).toISOString(), value);
}

async function seedPlugin(manifest: PluginManifest = TEST_MANIFEST): Promise<void> {
  await pluginRegistryQueries.reconcile([{ manifest }]);
}

async function writePlugin(pluginsDir: string, manifest: PluginManifest = TEST_MANIFEST): Promise<void> {
  const dir = `${pluginsDir}/${manifest.id}`;
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(`${dir}/praxrr.plugin.json`, JSON.stringify(manifest));
}

migratedTest('same-origin and absent-Origin clients can enable, disable, and reload plugins', async (pluginsDir) => {
  await writePlugin(pluginsDir);

  await withPluginsEnabled(true, async () => {
    const absentReload = await POST_RELOAD(reloadEvent());
    assertEquals(absentReload.status, 200);
    await jsonBody(absentReload);

    const sameOriginReload = await POST_RELOAD(reloadEvent({ origin: 'http://localhost' }));
    assertEquals(sameOriginReload.status, 200);
    await jsonBody(sameOriginReload);

    const sameOriginDisable = await POST_DISABLE(disableEvent('1', TEST_MANIFEST.id, { origin: 'http://localhost' }));
    assertEquals(sameOriginDisable.status, 200);
    assertEquals((await jsonBody<{ plugin: { enabled: boolean } }>(sameOriginDisable)).plugin.enabled, false);

    const absentEnable = await POST_ENABLE(enableEvent('1', TEST_MANIFEST.id));
    assertEquals(absentEnable.status, 200);
    assertEquals((await jsonBody<{ plugin: { enabled: boolean } }>(absentEnable)).plugin.enabled, true);

    const absentDisable = await POST_DISABLE(disableEvent('1', TEST_MANIFEST.id));
    assertEquals(absentDisable.status, 200);
    assertEquals((await jsonBody<{ plugin: { enabled: boolean } }>(absentDisable)).plugin.enabled, false);

    const sameOriginEnable = await POST_ENABLE(enableEvent('1', TEST_MANIFEST.id, { origin: 'http://localhost' }));
    assertEquals(sameOriginEnable.status, 200);
    assertEquals((await jsonBody<{ plugin: { enabled: boolean } }>(sameOriginEnable)).plugin.enabled, true);
  });
});

migratedTest(
  'foreign, malformed, and explicit cross-site mutations are empty 403s with no side effects',
  async (pluginsDir) => {
    await writePlugin(pluginsDir);
    const executionCalls: string[] = [];
    const executor: PluginExecutor = {
      execute(request: PluginExecutionRequest): Promise<PluginJsonValue> {
        executionCalls.push(request.plugin.manifest.id);
        return Promise.resolve(null);
      },
    };

    await withPluginsEnabled(true, async () => {
      pluginHost.setExecutor(executor);
      const initialReload = await POST_RELOAD(reloadEvent());
      assertEquals(initialReload.status, 200);
      await jsonBody(initialReload);
      await Deno.remove(`${pluginsDir}/${TEST_MANIFEST.id}`, { recursive: true });

      const mutableHost = pluginHost as unknown as { reload: typeof pluginHost.reload };
      const originalReload = mutableHost.reload;
      let reloadCalls = 0;
      mutableHost.reload = () => {
        reloadCalls += 1;
        return originalReload.call(pluginHost);
      };

      const rejectedHeaders: Array<{ label: string; headers: HeadersInit }> = [
        { label: 'foreign Origin', headers: { origin: 'https://evil.example' } },
        { label: 'malformed Origin', headers: { origin: '://not-an-origin' } },
        { label: 'same-host Origin with credentials', headers: { origin: 'http://user:pass@localhost' } },
        { label: 'same-host Origin with path', headers: { origin: 'http://localhost/admin' } },
        { label: 'same-host Origin with query', headers: { origin: 'http://localhost?source=browser' } },
        { label: 'same-host Origin with fragment', headers: { origin: 'http://localhost#fragment' } },
        {
          label: 'explicit cross-site browser request',
          headers: { origin: 'http://localhost', 'sec-fetch-site': 'cross-site' },
        },
      ];

      try {
        for (const { label, headers } of rejectedHeaders) {
          pluginRegistryQueries.setEnabled('1', TEST_MANIFEST.id, true);
          await assertOriginForbidden(await POST_DISABLE(disableEvent('1', TEST_MANIFEST.id, headers)));
          assertEquals(pluginRegistryQueries.get('1', TEST_MANIFEST.id)?.enabled, true, label);

          pluginRegistryQueries.setEnabled('1', TEST_MANIFEST.id, false);
          await assertOriginForbidden(await POST_ENABLE(enableEvent('1', TEST_MANIFEST.id, headers)));
          assertEquals(pluginRegistryQueries.get('1', TEST_MANIFEST.id)?.enabled, false, label);

          await assertOriginForbidden(await POST_RELOAD(reloadEvent(headers)));
          assertEquals(reloadCalls, 0, `${label} must not scan or reconcile`);
          assertEquals(pluginRegistryQueries.get('1', TEST_MANIFEST.id)?.discovered, true, label);
        }

        pluginRegistryQueries.setEnabled('1', TEST_MANIFEST.id, true);
        await pluginHost.notifyObservers('sync.previewComputed.observe', () => ({ summary: 'after-rejection' }));
        assertEquals(executionCalls, [TEST_MANIFEST.id]);
      } finally {
        mutableHost.reload = originalReload;
        pluginHost.setExecutor(new UnavailablePluginExecutor());
      }
    });
  }
);

migratedTest('foreign browser Origin does not change plugin list or detail reads', async () => {
  await seedPlugin();
  const foreignBrowserHeaders = { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' };

  await withPluginsEnabled(true, async () => {
    const list = await GET_LIST(listEvent(foreignBrowserHeaders));
    assertEquals(list.status, 200);
    assertEquals((await jsonBody<{ items: unknown[] }>(list)).items.length, 1);

    const detail = await GET_DETAIL(detailEvent('1', TEST_MANIFEST.id, foreignBrowserHeaders));
    assertEquals(detail.status, 200);
    assertEquals(
      (await jsonBody<{ plugin: { manifest: { id: string } } }>(detail)).plugin.manifest.id,
      TEST_MANIFEST.id
    );
  });
});

migratedTest(
  'feature-off list/reload succeed while detail and mutations reject without changing durable state',
  async () => {
    await seedPlugin();

    await withPluginsEnabled(false, async () => {
      const list = await GET_LIST(listEvent());
      assertEquals(list.status, 200);
      assertEquals(await jsonBody(list), { pluginsEnabled: false, items: [] });

      const reload = await POST_RELOAD(reloadEvent());
      assertEquals(reload.status, 200);
      assertEquals(await jsonBody(reload), {
        pluginsEnabled: false,
        reloaded: false,
        discovered: 0,
        registered: 0,
        rejected: 0,
        missing: 0,
      });

      const detail = await GET_DETAIL(detailEvent('1', TEST_MANIFEST.id));
      assertEquals(detail.status, 409);
      assertEquals((await jsonBody<{ code: string }>(detail)).code, 'plugins_disabled');

      const enable = await POST_ENABLE(enableEvent('1', TEST_MANIFEST.id));
      assertEquals(enable.status, 409);
      assertEquals((await jsonBody<{ code: string }>(enable)).code, 'plugins_disabled');

      const disable = await POST_DISABLE(disableEvent('1', TEST_MANIFEST.id));
      assertEquals(disable.status, 409);
      assertEquals((await jsonBody<{ code: string }>(disable)).code, 'plugins_disabled');
    });

    assertEquals(pluginRegistryQueries.get('1', TEST_MANIFEST.id)?.enabled, true);
  }
);

migratedTest('list/get expose the allow-listed nested manifest and preserve exact namespace semantics', async () => {
  await seedPlugin();

  await withPluginsEnabled(true, async () => {
    const record = pluginRegistryQueries.get('1', TEST_MANIFEST.id);
    assert(record);
    const queries = pluginRegistryQueries as unknown as { list: typeof pluginRegistryQueries.list };
    const originalList = queries.list;
    const privatePath = '/tmp/private-plugin-root/com.example.route';
    const rawSecret = 'RAW-PLUGIN-API-KEY-MUST-NOT-LEAK';
    queries.list = () =>
      [
        {
          ...record,
          sourceDir: privatePath,
          source_dir: privatePath,
          manifest_json: JSON.stringify({ api_key: rawSecret }),
          api_key: rawSecret,
          manifest: {
            ...record.manifest,
            sourceDir: privatePath,
            source_dir: privatePath,
            manifest_json: JSON.stringify({ api_key: rawSecret }),
            api_key: rawSecret,
          },
        },
      ] as unknown as readonly PluginRegistryRecord[];

    let list: Response;
    try {
      list = await GET_LIST(listEvent());
    } finally {
      queries.list = originalList;
    }
    assertEquals(list.status, 200);
    const listBody = await jsonBody<{
      pluginsEnabled: boolean;
      items: Array<{ manifest: Record<string, unknown> } & Record<string, unknown>>;
    }>(list);
    assertEquals(listBody.pluginsEnabled, true);
    assertEquals(listBody.items.length, 1);
    assertEquals(Object.keys(listBody.items[0]).sort(), [
      'createdAt',
      'discovered',
      'enabled',
      'lastError',
      'manifest',
      'registeredAt',
      'state',
      'updatedAt',
    ]);
    assertEquals(Object.keys(listBody.items[0].manifest).sort(), [
      'apiVersion',
      'capabilities',
      'entry',
      'extensionPoints',
      'id',
      'name',
      'runtime',
      'version',
    ]);
    assertRfc3339Timestamp(listBody.items[0].registeredAt as string);
    assertRfc3339Timestamp(listBody.items[0].createdAt as string);
    assertRfc3339Timestamp(listBody.items[0].updatedAt as string);
    const serialized = JSON.stringify(listBody);
    assert(!serialized.includes('sourceDir'));
    assert(!serialized.includes('source_dir'));
    assert(!serialized.includes('manifest_json'));
    assert(!serialized.includes(privatePath));
    assert(!serialized.includes(rawSecret));

    const caseInsensitive = await GET_DETAIL(detailEvent('1', 'COM.EXAMPLE.ROUTE'));
    assertEquals(caseInsensitive.status, 200);
    const detail = await jsonBody<{ plugin: { manifest: { id: string } } }>(caseInsensitive);
    assertEquals(detail.plugin.manifest.id, TEST_MANIFEST.id);

    const wrongNamespace = await GET_DETAIL(detailEvent('2', TEST_MANIFEST.id));
    assertEquals(wrongNamespace.status, 404);
    assertEquals((await jsonBody<{ code: string }>(wrongNamespace)).code, 'plugin_not_found');
  });
});

migratedTest('empty and whitespace-only identities fail before lookup on every entity handler', async () => {
  await withPluginsEnabled(true, async () => {
    const responses = await Promise.all([
      GET_DETAIL(detailEvent('   ', TEST_MANIFEST.id)),
      GET_DETAIL(detailEvent('1', '   ')),
      POST_ENABLE(enableEvent('', TEST_MANIFEST.id)),
      POST_ENABLE(enableEvent('1', '   ')),
      POST_DISABLE(disableEvent('   ', TEST_MANIFEST.id)),
      POST_DISABLE(disableEvent('1', '')),
    ]);

    for (const response of responses) {
      assertEquals(response.status, 400);
      assertEquals((await jsonBody<{ code: string }>(response)).code, 'invalid_identity');
    }
  });
});

migratedTest('not-found, enable, and disable outcomes remain namespace-qualified and durable', async () => {
  await seedPlugin();

  await withPluginsEnabled(true, async () => {
    const missingEnable = await POST_ENABLE(enableEvent('1', 'com.example.missing'));
    assertEquals(missingEnable.status, 404);
    assertEquals((await jsonBody<{ code: string }>(missingEnable)).code, 'plugin_not_found');

    const disable = await POST_DISABLE(disableEvent('1', 'COM.EXAMPLE.ROUTE'));
    assertEquals(disable.status, 200);
    assertEquals((await jsonBody<{ plugin: { enabled: boolean } }>(disable)).plugin.enabled, false);
    assertEquals(pluginRegistryQueries.get('1', TEST_MANIFEST.id)?.enabled, false);

    const enable = await POST_ENABLE(enableEvent('1', TEST_MANIFEST.id));
    assertEquals(enable.status, 200);
    assertEquals((await jsonBody<{ plugin: { enabled: boolean } }>(enable)).plugin.enabled, true);
    assertEquals(pluginRegistryQueries.get('1', TEST_MANIFEST.id)?.enabled, true);

    const missingDisable = await POST_DISABLE(disableEvent('2', TEST_MANIFEST.id));
    assertEquals(missingDisable.status, 404);
    assertEquals((await jsonBody<{ code: string }>(missingDisable)).code, 'plugin_not_found');
  });
});

migratedTest('disable route updates live dispatch before returning success', async (pluginsDir) => {
  await writePlugin(pluginsDir);
  const calls: string[] = [];
  const executor: PluginExecutor = {
    execute(request: PluginExecutionRequest): Promise<PluginJsonValue> {
      calls.push(request.plugin.manifest.id);
      return Promise.resolve(null);
    },
  };

  await withPluginsEnabled(true, async () => {
    pluginHost.setExecutor(executor);
    try {
      const reload = await POST_RELOAD(reloadEvent());
      assertEquals(reload.status, 200);
      await jsonBody(reload);

      const disable = await POST_DISABLE(disableEvent('1', TEST_MANIFEST.id));
      assertEquals(disable.status, 200);
      assertEquals((await jsonBody<{ plugin: { enabled: boolean } }>(disable)).plugin.enabled, false);

      await pluginHost.notifyObservers('sync.previewComputed.observe', () => ({ summary: 'after-disable' }));
      assertEquals(calls, []);
    } finally {
      pluginHost.setExecutor(new UnavailablePluginExecutor());
    }
  });
});

migratedTest(
  'reload discovers, removes, and restores a plugin without losing its enablement decision',
  async (pluginsDir) => {
    await writePlugin(pluginsDir);

    await withPluginsEnabled(true, async () => {
      const discovered = await POST_RELOAD(reloadEvent());
      assertEquals(discovered.status, 200);
      const discoveredBody = await jsonBody<{ discovered: number; registered: number; missing: number }>(discovered);
      assertEquals(discoveredBody.discovered, 1);
      assertEquals(discoveredBody.registered, 1);
      assertEquals(discoveredBody.missing, 0);

      const disable = await POST_DISABLE(disableEvent('1', TEST_MANIFEST.id));
      assertEquals(disable.status, 200);
      await jsonBody(disable);

      await Deno.remove(`${pluginsDir}/${TEST_MANIFEST.id}`, { recursive: true });
      const removed = await POST_RELOAD(reloadEvent());
      assertEquals(removed.status, 200);
      const removedBody = await jsonBody<{ discovered: number; registered: number; missing: number }>(removed);
      assertEquals(removedBody.discovered, 0);
      assertEquals(removedBody.registered, 0);
      assertEquals(removedBody.missing, 1);
      assertEquals(pluginRegistryQueries.get('1', TEST_MANIFEST.id)?.discovered, false);
      assertEquals(pluginRegistryQueries.get('1', TEST_MANIFEST.id)?.enabled, false);

      await writePlugin(pluginsDir);
      const restored = await POST_RELOAD(reloadEvent());
      assertEquals(restored.status, 200);
      const restoredBody = await jsonBody<{ discovered: number; registered: number; missing: number }>(restored);
      assertEquals(restoredBody.discovered, 1);
      assertEquals(restoredBody.registered, 1);
      assertEquals(restoredBody.missing, 0);
      assertEquals(pluginRegistryQueries.get('1', TEST_MANIFEST.id)?.discovered, true);
      assertEquals(pluginRegistryQueries.get('1', TEST_MANIFEST.id)?.enabled, false);
    });
  }
);

migratedTest('reload failures are logged server-side and return only the redacted contract error', async () => {
  const mutableHost = pluginHost as unknown as { reload: typeof pluginHost.reload };
  const originalReload = mutableHost.reload;
  mutableHost.reload = () => Promise.reject(new Error('private reload diagnostic'));

  try {
    const response = await withPluginsEnabled(true, () => POST_RELOAD(reloadEvent()));
    assertEquals(response.status, 500);
    const body = await jsonBody<{ code: string; error: string }>(response);
    assertEquals(body, {
      code: 'internal_error',
      error: 'Plugin management operation failed',
    });
    assert(!JSON.stringify(body).includes('private reload diagnostic'));
  } finally {
    mutableHost.reload = originalReload;
  }
});

Deno.test('plugin management routes remain protected by the existing auth classification', () => {
  for (const path of [
    '/api/v1/plugins',
    '/api/v1/plugins/reload',
    '/api/v1/plugins/1/com.example.route',
    '/api/v1/plugins/1/com.example.route/enable',
    '/api/v1/plugins/1/com.example.route/disable',
  ]) {
    assertEquals(isPublicPath(path), false, `${path} must remain auth-gated`);
  }
});
