/**
 * PluginHost integration tests — the key Phase-1 behavioral surface (issue #35).
 *
 * Exercises the optional-subsystem orchestrator end-to-end against the shared `pluginRegistry`
 * singleton and the `$shared/plugins` contract:
 *
 * - `initialize()` is a hard NO-OP when `PLUGINS_ENABLED` is off (and never stats `PLUGINS_DIR`),
 *   warns + degrades to an empty registry when the dir is missing, and registers valid manifests
 *   while skipping invalid ones — never throwing on any of those paths.
 * - `notifyObservers` swallows the default executor's `PluginRuntimeUnavailableError`, projects a
 *   secret-scrubbed input across the seam before `execute`, and throws `PluginPointNotWiredError`
 *   for a declared-but-unwired point.
 *
 * `config.pluginsEnabled` is constructor-cached, so it is flipped via a readonly-cast + finally-restore
 * (the `mcp.test.ts` `mcpEnabled` idiom). `PLUGINS_DIR` is read lazily by the `config.paths.plugins`
 * getter, so it is steered with `Deno.env.set` / `Deno.env.delete`. See
 * docs/plans/35-wasm-plugin-system/plan.md for the authoritative Phase-1 spec.
 */

import { assert, assertEquals, assertExists, assertRejects } from '@std/assert';
import { config } from '$config';
import {
  PluginHost,
  pluginHost,
  PluginPointNotWiredError,
  pluginRegistry,
  type PluginExecutionRequest,
  type PluginExecutor,
} from '$server/plugins/index.ts';
import { PLUGIN_API_VERSION, type PluginJsonValue, type PluginManifest } from '$shared/plugins/index.ts';

/** Constructor-cached flag; flipped via readonly-cast + finally-restore (mcp.test.ts idiom). */
const configFlag = config as unknown as { pluginsEnabled: boolean };

/** Run `fn` with `config.pluginsEnabled` forced to `enabled`, restoring the original afterward. */
async function withPluginsEnabled(enabled: boolean, fn: () => Promise<void>): Promise<void> {
  const original = configFlag.pluginsEnabled;
  configFlag.pluginsEnabled = enabled;
  try {
    await fn();
  } finally {
    configFlag.pluginsEnabled = original;
  }
}

/** Steer the lazy `config.paths.plugins` getter at `dir` via `PLUGINS_DIR`, restoring the original. */
async function withPluginsDir(dir: string, fn: () => Promise<void>): Promise<void> {
  const original = Deno.env.get('PLUGINS_DIR');
  Deno.env.set('PLUGINS_DIR', dir);
  try {
    await fn();
  } finally {
    if (original === undefined) {
      Deno.env.delete('PLUGINS_DIR');
    } else {
      Deno.env.set('PLUGINS_DIR', original);
    }
  }
}

/** Write a `praxrr.plugin.json` into `baseDir/subdir`, creating the subdirectory. */
async function writeManifest(baseDir: string, subdir: string, contents: string): Promise<void> {
  const dir = `${baseDir}/${subdir}`;
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(`${dir}/praxrr.plugin.json`, contents);
}

/** A minimal well-formed manifest declaring the wired `sync.previewComputed.observe` point. */
const VALID_MANIFEST = JSON.stringify({
  apiVersion: PLUGIN_API_VERSION,
  id: 'com.example.observer',
  name: 'Observer Plugin',
  version: '1.0.0',
  runtime: 'wasm',
  entry: 'plugin.wasm',
  extensionPoints: ['sync.previewComputed.observe'],
  capabilities: ['read:sync-preview'],
});

/** A fail-closed-invalid manifest: `net:http` is not a member of the closed `CapabilityId` union. */
const INVALID_MANIFEST = JSON.stringify({
  apiVersion: PLUGIN_API_VERSION,
  id: 'com.example.invalid',
  name: 'Invalid Plugin',
  version: '1.0.0',
  runtime: 'wasm',
  entry: 'plugin.wasm',
  extensionPoints: ['sync.previewComputed.observe'],
  capabilities: ['net:http'],
});

/** A registered plugin declaring the wired observe point, used to drive the dispatch seam directly. */
const wiredManifest: PluginManifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'com.example.observer',
  name: 'Observer Plugin',
  version: '1.0.0',
  runtime: 'wasm',
  entry: 'plugin.wasm',
  extensionPoints: ['sync.previewComputed.observe'],
  capabilities: ['read:sync-preview'],
};

Deno.test('initialize() is a hard NO-OP and never stats PLUGINS_DIR when PLUGINS_ENABLED is off', async () => {
  await withPluginsEnabled(false, async () => {
    pluginRegistry.clear();

    const pluginsDir = config.paths.plugins;
    const statted: string[] = [];
    const originalStat = Deno.stat;
    (Deno as unknown as { stat: typeof Deno.stat }).stat = ((path: string | URL) => {
      statted.push(String(path));
      return originalStat(path);
    }) as typeof Deno.stat;

    try {
      await pluginHost.initialize();
    } finally {
      (Deno as unknown as { stat: typeof Deno.stat }).stat = originalStat;
    }

    assertEquals(pluginRegistry.listByApiVersion(PLUGIN_API_VERSION).length, 0);
    assertEquals(statted.includes(pluginsDir), false);
  });
});

Deno.test('initialize() warns and degrades to an empty registry when PLUGINS_DIR is missing', async () => {
  const tmp = await Deno.makeTempDir({ prefix: 'praxrr-plugins-host-' });
  const missing = `${tmp}/does-not-exist`;
  try {
    await withPluginsEnabled(true, async () => {
      await withPluginsDir(missing, async () => {
        pluginRegistry.clear();
        // Must resolve without throwing even though the directory is absent.
        await pluginHost.initialize();
        assertEquals(pluginRegistry.listByApiVersion(PLUGIN_API_VERSION).length, 0);
      });
    });
  } finally {
    await Deno.remove(tmp, { recursive: true });
    pluginRegistry.clear();
  }
});

Deno.test('initialize() registers valid manifests and skips invalid ones', async () => {
  const tmp = await Deno.makeTempDir({ prefix: 'praxrr-plugins-host-' });
  try {
    await writeManifest(tmp, 'valid', VALID_MANIFEST);
    await writeManifest(tmp, 'invalid', INVALID_MANIFEST);
    await writeManifest(tmp, 'malformed', '{ not valid json');
    await Deno.mkdir(`${tmp}/no-manifest`, { recursive: true });

    await withPluginsEnabled(true, async () => {
      await withPluginsDir(tmp, async () => {
        pluginRegistry.clear();
        await pluginHost.initialize();

        const registered = pluginRegistry.listByApiVersion(PLUGIN_API_VERSION);
        assertEquals(registered.length, 1);
        assertEquals(registered[0].manifest.id, 'com.example.observer');
      });
    });
  } finally {
    await Deno.remove(tmp, { recursive: true });
    pluginRegistry.clear();
  }
});

Deno.test({
  name: 'notifyObservers swallows PluginRuntimeUnavailableError from the default executor',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    pluginRegistry.clear();
    pluginRegistry.register('/tmp/observer', wiredManifest);
    try {
      const host = new PluginHost();
      // The default UnavailablePluginExecutor rejects; the host must isolate it and never propagate.
      await host.notifyObservers('sync.previewComputed.observe', () => ({ summary: 'preview' }));
      assertEquals(pluginRegistry.listForPoint(PLUGIN_API_VERSION, 'sync.previewComputed.observe').length, 1);
    } finally {
      pluginRegistry.clear();
    }
  },
});

Deno.test({
  name: 'notifyObservers scrubs secrets from the projected input reaching the executor seam',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    pluginRegistry.clear();
    pluginRegistry.register('/tmp/observer', wiredManifest);

    let captured: PluginJsonValue | undefined;
    const fakeExecutor: PluginExecutor = {
      execute(request: PluginExecutionRequest): Promise<PluginJsonValue> {
        captured = request.input;
        return Promise.resolve(null);
      },
    };

    try {
      const host = new PluginHost(fakeExecutor);
      await host.notifyObservers('sync.previewComputed.observe', () => ({
        summary: 'preview',
        changeCount: 2,
        api_key: 'sk-live-must-not-leak',
        token: 'ghp_must_not_leak',
      }));

      assertExists(captured);
      assert(typeof captured === 'object' && captured !== null && !Array.isArray(captured));
      const record = captured as { readonly [key: string]: PluginJsonValue };
      assertEquals(record.api_key, '[REDACTED]');
      assertEquals(record.token, '[REDACTED]');
      assertEquals(record.summary, 'preview');
      assertEquals(record.changeCount, 2);
    } finally {
      pluginRegistry.clear();
    }
  },
});

Deno.test('notifyObservers throws PluginPointNotWiredError for a declared-but-unwired point', async () => {
  pluginRegistry.clear();
  const host = new PluginHost();
  await assertRejects(() => host.notifyObservers('sync.beforeApply.observe', () => null), PluginPointNotWiredError);
});
