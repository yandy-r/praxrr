/**
 * PluginHost integration tests — the key Phase-1 behavioral surface (issue #35).
 *
 * Exercises the optional-subsystem orchestrator end-to-end against the shared `pluginRegistry`
 * singleton and the `$shared/plugins` contract:
 *
 * - `initialize()` is a hard NO-OP when the plugin ecosystem flag is off (and never stats `PLUGINS_DIR`),
 *   warns + degrades to an empty registry when the dir is missing, and registers valid manifests
 *   while skipping invalid ones — never throwing on any of those paths.
 * - `notifyObservers` swallows the default executor's `PluginRuntimeUnavailableError`, projects a
 *   secret-scrubbed input across the seam before `execute`, and throws `PluginPointNotWiredError`
 *   for a declared-but-unwired point.
 *
 * Feature enablement is flipped via `withPluginsFeature` (process cache over DB-backed settings).
 * `PLUGINS_DIR` is read lazily by the `config.paths.plugins` getter, so it is steered with
 * `Deno.env.set` / `Deno.env.delete`. See docs/plans/35-wasm-plugin-system/plan.md for the
 * authoritative Phase-1 spec.
 */

import { assert, assertEquals, assertExists, assertRejects, assertStrictEquals } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { pluginRegistryQueries, type ReconcilePluginInput } from '$db/queries/pluginRegistry.ts';
import {
  PluginHost,
  pluginHost,
  PluginPointNotWiredError,
  pluginRegistry,
  withPluginsFeature,
  type PluginExecutionRequest,
  type PluginExecutor,
} from '$server/plugins/index.ts';
import { PLUGIN_API_VERSION, type PluginJsonValue, type PluginManifest } from '$shared/plugins/index.ts';

/** Run `fn` with the plugin ecosystem feature flag forced to `enabled`. */
async function withPluginsEnabled(enabled: boolean, fn: () => Promise<void>): Promise<void> {
  await withPluginsFeature(enabled, fn);
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

/** Run an initialize test against the complete app migration chain and restore the DB singleton. */
async function withMigratedDb(fn: () => Promise<void>): Promise<void> {
  const originalBasePath = config.paths.base;
  const tempBasePath = `/tmp/praxrr-tests/plugin-host-${crypto.randomUUID()}`;
  await Deno.mkdir(tempBasePath, { recursive: true });
  db.close();
  config.setBasePath(tempBasePath);
  pluginRegistry.clear();

  try {
    await db.initialize();
    await runMigrations();
    await fn();
  } finally {
    pluginRegistry.clear();
    db.close();
    config.setBasePath(originalBasePath);
    await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
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

function makeManifest(id: string, overrides: Partial<PluginManifest> = {}): PluginManifest {
  return { ...wiredManifest, id, name: id, ...overrides };
}

function manifestEntry(dir: string, manifest: PluginManifest): { readonly dir: string; readonly raw: PluginManifest } {
  return { dir, raw: manifest };
}

Deno.test('initialize() is a hard NO-OP and never stats PLUGINS_DIR when plugins are disabled', async () => {
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
    await withMigratedDb(async () => {
      await withPluginsEnabled(true, async () => {
        await withPluginsDir(missing, async () => {
          pluginRegistry.clear();
          // Must resolve without throwing even though the directory is absent.
          await pluginHost.initialize();
          assertEquals(pluginRegistry.listByApiVersion(PLUGIN_API_VERSION).length, 0);
        });
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

    await withMigratedDb(async () => {
      await withPluginsEnabled(true, async () => {
        await withPluginsDir(tmp, async () => {
          pluginRegistry.clear();
          await pluginHost.initialize();

          const registered = pluginRegistry.listByApiVersion(PLUGIN_API_VERSION);
          assertEquals(registered.length, 1);
          assertEquals(registered[0].manifest.id, 'com.example.observer');
        });
      });
    });
  } finally {
    await Deno.remove(tmp, { recursive: true });
    pluginRegistry.clear();
  }
});

Deno.test('initialize() rejects an oversized manifest without aborting reload', async () => {
  const tmp = await Deno.makeTempDir({ prefix: 'praxrr-plugins-host-oversized-' });
  try {
    await writeManifest(tmp, 'valid', VALID_MANIFEST);
    await writeManifest(tmp, 'oversized', JSON.stringify({ value: 'x'.repeat(65_536) }));

    await withMigratedDb(async () => {
      await withPluginsEnabled(true, async () => {
        await withPluginsDir(tmp, async () => {
          const summary = await new PluginHost().reload();

          assertEquals(summary.discovered, 2);
          assertEquals(summary.registered, 1);
          assertEquals(summary.rejected, 1);
          assertEquals(pluginRegistry.listByApiVersion(PLUGIN_API_VERSION).length, 1);
        });
      });
    });
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
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

Deno.test('notifyObservers isolates a generic executor throw and still dispatches the next plugin', async () => {
  pluginRegistry.clear();
  const first: PluginManifest = { ...wiredManifest, id: 'com.example.first' };
  const second: PluginManifest = { ...wiredManifest, id: 'com.example.second' };
  pluginRegistry.register('/tmp/first', first);
  pluginRegistry.register('/tmp/second', second);

  const calls: string[] = [];
  const flakyExecutor: PluginExecutor = {
    execute(request: PluginExecutionRequest): Promise<PluginJsonValue> {
      calls.push(request.plugin.manifest.id);
      if (request.plugin.manifest.id === 'com.example.first') {
        return Promise.reject(new Error('boom'));
      }
      return Promise.resolve(null);
    },
  };

  try {
    const host = new PluginHost(flakyExecutor);
    // The first plugin's generic throw must be isolated (never propagated) and must not block the second.
    await host.notifyObservers('sync.previewComputed.observe', () => ({ summary: 'preview' }));
    assertEquals(calls, ['com.example.first', 'com.example.second']);
  } finally {
    pluginRegistry.clear();
  }
});

Deno.test(
  'initialize() never aborts boot when two manifests share an id (duplicate registration is skipped)',
  async () => {
    const tmp = await Deno.makeTempDir({ prefix: 'praxrr-plugins-host-' });
    try {
      // Both subdirs carry the same id, so the second registration throws a duplicate-id error the host
      // must isolate — initialize() still resolves and exactly one plugin is registered.
      await writeManifest(tmp, 'a', VALID_MANIFEST);
      await writeManifest(tmp, 'b', VALID_MANIFEST);

      await withMigratedDb(async () => {
        await withPluginsEnabled(true, async () => {
          await withPluginsDir(tmp, async () => {
            pluginRegistry.clear();
            await pluginHost.initialize();
            assertEquals(pluginRegistry.listByApiVersion(PLUGIN_API_VERSION).length, 1);
          });
        });
      });
    } finally {
      await Deno.remove(tmp, { recursive: true });
      pluginRegistry.clear();
    }
  }
);

Deno.test('restart reconciliation restores durable enablement into a new host snapshot', async () => {
  const pluginsDir = await Deno.makeTempDir({ prefix: 'praxrr-plugins-host-restart-' });
  const manifest = makeManifest('com.example.restart');
  try {
    await writeManifest(pluginsDir, 'restart', JSON.stringify(manifest));
    await withMigratedDb(async () => {
      await withPluginsEnabled(true, async () => {
        await withPluginsDir(pluginsDir, async () => {
          const firstHost = new PluginHost();
          await firstHost.initialize();
          assertEquals(pluginRegistryQueries.setEnabled('1', manifest.id, false)?.enabled, false);

          pluginRegistry.clear();
          db.close();
          await db.initialize();

          const restartedHost = new PluginHost();
          const summary = await restartedHost.initialize();
          const restored = pluginRegistry.get('1', manifest.id);
          assertExists(restored);
          assertEquals(restored.enabled, false);
          assertEquals(restored.sourceDir, `${pluginsDir}/restart`);
          assertEquals(summary, {
            pluginsEnabled: true,
            reloaded: true,
            discovered: 1,
            registered: 1,
            rejected: 0,
            missing: 0,
          });
        });
      });
    });
  } finally {
    await Deno.remove(pluginsDir, { recursive: true }).catch(() => {});
  }
});

Deno.test('only enabled and discovered durable plugins are dispatched after a new host reload', async () => {
  const pluginsDir = await Deno.makeTempDir({ prefix: 'praxrr-plugins-host-dispatch-' });
  const enabledManifest = makeManifest('com.example.enabled');
  const disabledManifest = makeManifest('com.example.disabled');
  try {
    await writeManifest(pluginsDir, 'enabled', JSON.stringify(enabledManifest));
    await writeManifest(pluginsDir, 'disabled', JSON.stringify(disabledManifest));
    await withMigratedDb(async () => {
      await withPluginsEnabled(true, async () => {
        await withPluginsDir(pluginsDir, async () => {
          await new PluginHost().reload();
          pluginRegistryQueries.setEnabled('1', disabledManifest.id, false);

          const calls: string[] = [];
          const executor: PluginExecutor = {
            execute(request: PluginExecutionRequest): Promise<PluginJsonValue> {
              calls.push(request.plugin.manifest.id);
              return Promise.resolve(null);
            },
          };
          const restartedHost = new PluginHost(executor);
          await restartedHost.reload();
          await restartedHost.notifyObservers('sync.previewComputed.observe', () => ({ summary: 'preview' }));

          assertEquals(calls, [enabledManifest.id]);
          assertEquals(pluginRegistry.get('1', disabledManifest.id)?.enabled, false);
        });
      });
    });
  } finally {
    await Deno.remove(pluginsDir, { recursive: true }).catch(() => {});
  }
});

Deno.test('disable commits durable state and immediately removes the plugin from live dispatch', async () => {
  const pluginsDir = await Deno.makeTempDir({ prefix: 'praxrr-plugins-host-immediate-disable-' });
  const manifest = makeManifest('com.example.immediate-disable');
  const calls: string[] = [];
  const executor: PluginExecutor = {
    execute(request: PluginExecutionRequest): Promise<PluginJsonValue> {
      calls.push(request.plugin.manifest.id);
      return Promise.resolve(null);
    },
  };

  try {
    await writeManifest(pluginsDir, 'immediate-disable', JSON.stringify(manifest));
    await withMigratedDb(async () => {
      await withPluginsEnabled(true, async () => {
        await withPluginsDir(pluginsDir, async () => {
          const host = new PluginHost(executor);
          await host.reload();
          await host.notifyObservers('sync.previewComputed.observe', () => ({ summary: 'before' }));
          assertEquals(calls, [manifest.id]);

          const disabled = await host.setPluginEnabled('1', manifest.id.toUpperCase(), false);
          assertExists(disabled);
          assertEquals(disabled.enabled, false);
          assertEquals(pluginRegistryQueries.get('1', manifest.id)?.enabled, false);
          assertEquals(pluginRegistry.get('1', manifest.id)?.enabled, false);

          await host.notifyObservers('sync.previewComputed.observe', () => ({ summary: 'after' }));
          assertEquals(calls, [manifest.id]);
        });
      });
    });
  } finally {
    await Deno.remove(pluginsDir, { recursive: true }).catch(() => {});
  }
});

Deno.test('enablement mutation and reload are serialized into one durable and live decision', async () => {
  const pluginsDir = await Deno.makeTempDir({ prefix: 'praxrr-plugins-host-mutation-reload-' });
  const manifest = makeManifest('com.example.mutation-reload');
  let releaseMutation: (() => void) | undefined;
  const mutationGate = new Promise<void>((resolve) => {
    releaseMutation = resolve;
  });

  try {
    await writeManifest(pluginsDir, 'mutation-reload', JSON.stringify(manifest));
    await withMigratedDb(async () => {
      await withPluginsEnabled(true, async () => {
        await withPluginsDir(pluginsDir, async () => {
          await new PluginHost().reload();

          let persistenceCalls = 0;
          let scans = 0;
          const host = new PluginHost(undefined, {
            scan: () => {
              scans += 1;
              return Promise.resolve([manifestEntry(`${pluginsDir}/mutation-reload`, manifest)]);
            },
            setEnabled: async (apiVersion, pluginId, enabled) => {
              persistenceCalls += 1;
              await mutationGate;
              return pluginRegistryQueries.setEnabled(apiVersion, pluginId, enabled);
            },
          });

          const mutation = host.setPluginEnabled('1', manifest.id, false);
          const reload = host.reload();
          await Promise.resolve();
          await Promise.resolve();
          assertEquals(persistenceCalls, 1);
          assertEquals(scans, 0);

          releaseMutation?.();
          const [mutated, summary] = await Promise.all([mutation, reload]);
          assertExists(mutated);
          assertEquals(mutated.enabled, false);
          assertEquals(summary.registered, 1);
          assertEquals(scans, 1);
          assertEquals(pluginRegistryQueries.get('1', manifest.id)?.enabled, false);
          assertEquals(pluginRegistry.get('1', manifest.id)?.enabled, false);
        });
      });
    });
  } finally {
    releaseMutation?.();
    await Deno.remove(pluginsDir, { recursive: true }).catch(() => {});
  }
});

Deno.test('feature-off reload performs no filesystem scan or durable reconciliation', async () => {
  await withMigratedDb(async () => {
    const persisted = makeManifest('com.example.feature-off');
    await pluginRegistryQueries.reconcile([{ manifest: persisted }]);
    pluginRegistry.register('/tmp/feature-off', persisted);
    const previousMemory = pluginRegistry.get('1', persisted.id);
    const beforeRows = pluginRegistryQueries.list();
    let scans = 0;
    let reconciliations = 0;
    let enablementMutations = 0;
    const host = new PluginHost(undefined, {
      scan: () => {
        scans += 1;
        return Promise.reject(new Error('scan must not run'));
      },
      reconcile: () => {
        reconciliations += 1;
        return Promise.reject(new Error('reconcile must not run'));
      },
      setEnabled: () => {
        enablementMutations += 1;
        throw new Error('enablement persistence must not run');
      },
    });

    await withPluginsEnabled(false, async () => {
      const summary = await host.reload();
      assertEquals(summary, {
        pluginsEnabled: false,
        reloaded: false,
        discovered: 0,
        registered: 0,
        rejected: 0,
        missing: 0,
      });
      assertEquals(await host.setPluginEnabled('1', persisted.id, false), undefined);
    });

    assertEquals(scans, 0);
    assertEquals(reconciliations, 0);
    assertEquals(enablementMutations, 0);
    assertEquals(pluginRegistryQueries.list(), beforeRows);
    assertStrictEquals(pluginRegistry.get('1', persisted.id), previousMemory);
  });
});

Deno.test('missing plugin directory commits an empty snapshot and reports durable missing rows', async () => {
  const pluginsDir = await Deno.makeTempDir({ prefix: 'praxrr-plugins-host-missing-' });
  const manifest = makeManifest('com.example.missing');
  const missingDir = `${pluginsDir}/removed`;
  try {
    await writeManifest(pluginsDir, 'present', JSON.stringify(manifest));
    await withMigratedDb(async () => {
      await withPluginsEnabled(true, async () => {
        await withPluginsDir(pluginsDir, async () => {
          await new PluginHost().reload();
        });
        await withPluginsDir(missingDir, async () => {
          const summary = await new PluginHost().reload();
          assertEquals(summary, {
            pluginsEnabled: true,
            reloaded: true,
            discovered: 0,
            registered: 0,
            rejected: 0,
            missing: 1,
          });
        });
      });

      assertEquals(pluginRegistry.listByApiVersion('1'), []);
      const durable = pluginRegistryQueries.get('1', manifest.id);
      assertExists(durable);
      assertEquals(durable.discovered, false);
      assertEquals(durable.state, 'unloaded');
    });
  } finally {
    await Deno.remove(pluginsDir, { recursive: true }).catch(() => {});
  }
});

Deno.test('enable and disable decisions survive across distinct host instances', async () => {
  const pluginsDir = await Deno.makeTempDir({ prefix: 'praxrr-plugins-host-toggle-' });
  const manifest = makeManifest('com.example.host-toggle');
  try {
    await writeManifest(pluginsDir, 'toggle', JSON.stringify(manifest));
    await withMigratedDb(async () => {
      await withPluginsEnabled(true, async () => {
        await withPluginsDir(pluginsDir, async () => {
          await new PluginHost().reload();
          pluginRegistryQueries.setEnabled('1', manifest.id, false);
          await new PluginHost().reload();
          assertEquals(pluginRegistry.get('1', manifest.id)?.enabled, false);

          pluginRegistryQueries.setEnabled('1', manifest.id, true);
          await new PluginHost().reload();
          assertEquals(pluginRegistry.get('1', manifest.id)?.enabled, true);
        });
      });
    });
  } finally {
    await Deno.remove(pluginsDir, { recursive: true }).catch(() => {});
  }
});

Deno.test('concurrent reload callers share one exact promise, scan, and reconciliation', async () => {
  const pluginsDir = await Deno.makeTempDir({ prefix: 'praxrr-plugins-host-concurrent-' });
  const manifest = makeManifest('com.example.concurrent');
  let releaseScan: (() => void) | undefined;
  const scanGate = new Promise<void>((resolve) => {
    releaseScan = resolve;
  });
  try {
    await withMigratedDb(async () => {
      await withPluginsEnabled(true, async () => {
        await withPluginsDir(pluginsDir, async () => {
          let scans = 0;
          let reconciliations = 0;
          const host = new PluginHost(undefined, {
            scan: async () => {
              scans += 1;
              await scanGate;
              return [manifestEntry(`${pluginsDir}/concurrent`, manifest)];
            },
            reconcile: async (inputs: readonly ReconcilePluginInput[]) => {
              reconciliations += 1;
              return await pluginRegistryQueries.reconcile(inputs);
            },
          });

          const first = host.reload();
          const second = host.reload();
          assertStrictEquals(second, first);
          releaseScan?.();
          const [firstSummary, secondSummary] = await Promise.all([first, second]);

          assertStrictEquals(firstSummary, secondSummary);
          assertEquals(scans, 1);
          assertEquals(reconciliations, 1);
          assertEquals(firstSummary.registered, 1);
        });
      });
    });
  } finally {
    releaseScan?.();
    await Deno.remove(pluginsDir, { recursive: true }).catch(() => {});
  }
});

Deno.test('reload counts invalid, malformed, and duplicate manifests without partial rejection', async () => {
  const pluginsDir = await Deno.makeTempDir({ prefix: 'praxrr-plugins-host-rejected-' });
  const valid = makeManifest('com.example.counted');
  try {
    await withMigratedDb(async () => {
      await withPluginsEnabled(true, async () => {
        await withPluginsDir(pluginsDir, async () => {
          const host = new PluginHost(undefined, {
            scan: () =>
              Promise.resolve([
                manifestEntry(`${pluginsDir}/valid`, valid),
                { dir: `${pluginsDir}/invalid`, raw: JSON.parse(INVALID_MANIFEST) as unknown },
                { dir: `${pluginsDir}/malformed`, parseError: 'invalid JSON' },
                manifestEntry(`${pluginsDir}/duplicate`, valid),
              ]),
          });

          const summary = await host.reload();
          assertEquals(summary, {
            pluginsEnabled: true,
            reloaded: true,
            discovered: 4,
            registered: 1,
            rejected: 3,
            missing: 0,
          });
          assertEquals(
            pluginRegistryQueries.list().map((record) => record.pluginId),
            [valid.id]
          );
        });
      });
    });
  } finally {
    await Deno.remove(pluginsDir, { recursive: true }).catch(() => {});
  }
});

Deno.test('unexpected scan failure preserves the previous in-memory and durable snapshots', async () => {
  const pluginsDir = await Deno.makeTempDir({ prefix: 'praxrr-plugins-host-scan-failure-' });
  const manifest = makeManifest('com.example.scan-stable');
  try {
    await writeManifest(pluginsDir, 'stable', JSON.stringify(manifest));
    await withMigratedDb(async () => {
      await withPluginsEnabled(true, async () => {
        await withPluginsDir(pluginsDir, async () => {
          await new PluginHost().reload();
          const previousMemory = pluginRegistry.get('1', manifest.id);
          const previousRows = pluginRegistryQueries.list();
          const failingHost = new PluginHost(undefined, {
            scan: () => Promise.reject(new Error('unexpected scan failure')),
          });

          await assertRejects(() => failingHost.reload(), Error, 'unexpected scan failure');
          assertStrictEquals(pluginRegistry.get('1', manifest.id), previousMemory);
          assertEquals(pluginRegistryQueries.list(), previousRows);
        });
      });
    });
  } finally {
    await Deno.remove(pluginsDir, { recursive: true }).catch(() => {});
  }
});

Deno.test('unexpected reconcile failure rolls back durable changes and preserves the live snapshot', async () => {
  const pluginsDir = await Deno.makeTempDir({ prefix: 'praxrr-plugins-host-reconcile-failure-' });
  const stable = makeManifest('com.example.reconcile-stable');
  const candidate = makeManifest('com.example.reconcile-candidate');
  try {
    await writeManifest(pluginsDir, 'stable', JSON.stringify(stable));
    await withMigratedDb(async () => {
      await withPluginsEnabled(true, async () => {
        await withPluginsDir(pluginsDir, async () => {
          await new PluginHost().reload();
          const previousMemory = pluginRegistry.get('1', stable.id);
          const previousRows = pluginRegistryQueries.list();
          const failingHost = new PluginHost(undefined, {
            scan: () => Promise.resolve([manifestEntry(`${pluginsDir}/candidate`, candidate)]),
            reconcile: () =>
              db.transaction(() => {
                db.execute('UPDATE plugin_registry SET enabled = 0, discovered = 0');
                throw new Error('unexpected reconcile failure');
              }),
          });

          await assertRejects(() => failingHost.reload(), Error, 'unexpected reconcile failure');
          assertStrictEquals(pluginRegistry.get('1', stable.id), previousMemory);
          assertEquals(pluginRegistryQueries.list(), previousRows);
        });
      });
    });
  } finally {
    await Deno.remove(pluginsDir, { recursive: true }).catch(() => {});
  }
});
