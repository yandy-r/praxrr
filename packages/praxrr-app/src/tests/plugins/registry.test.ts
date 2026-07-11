/**
 * PluginRegistry tests — apiVersion-namespaced, case-insensitive in-memory store (issue #35, Phase-1).
 *
 * Exercises register/get/unregister, cross-apiVersion namespace isolation (a rollback/upgrade cannot
 * resurrect a plugin registered under an incompatible contract version), case-insensitive per-namespace
 * id uniqueness, `listForPoint` namespace + point scoping, and `clear()`. Pure in-memory — no DB, no fs,
 * no env — so each case runs against a fresh `PluginRegistry` to avoid singleton cross-contamination.
 */

import { assert, assertEquals, assertThrows } from '@std/assert';
import { PluginRegistry, pluginRegistry, type RegisteredPlugin } from '$server/plugins/index.ts';
import type { PluginManifest } from '$shared/plugins/index.ts';

/** Build a well-shaped `PluginManifest`; `overrides` tailor the fields a given case cares about. */
function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    apiVersion: '1',
    id: 'com.acme.plugin',
    name: 'Acme Plugin',
    version: '1.0.0',
    runtime: 'wasm',
    entry: 'plugin.wasm',
    extensionPoints: ['config.profileCompiled.observe'],
    capabilities: ['read:resolved-profile'],
    ...overrides,
  };
}

Deno.test('register returns a registered entry that get resolves case-insensitively', () => {
  const registry = new PluginRegistry();
  const manifest = makeManifest({ id: 'com.acme.tool' });

  const entry: RegisteredPlugin = registry.register('/plugins/acme-tool', manifest);
  assertEquals(entry.manifest, manifest);
  assertEquals(entry.sourceDir, '/plugins/acme-tool');
  assertEquals(entry.state, 'registered');
  assert(!Number.isNaN(Date.parse(entry.registeredAt)));

  assertEquals(registry.get('1', 'com.acme.tool'), entry);
  assertEquals(registry.get('1', 'COM.ACME.TOOL'), entry);
});

Deno.test('unregister removes a plugin and is idempotent for a missing id', () => {
  const registry = new PluginRegistry();
  registry.register('/plugins/acme', makeManifest({ id: 'com.acme.tool' }));

  assertEquals(registry.unregister('1', 'COM.ACME.TOOL'), true);
  assertEquals(registry.get('1', 'com.acme.tool'), undefined);
  assertEquals(registry.unregister('1', 'com.acme.tool'), false);
});

Deno.test('same id under two apiVersions coexists, stays isolated, and misses a wrong namespace', () => {
  const registry = new PluginRegistry();
  const v1 = registry.register('/plugins/v1', makeManifest({ apiVersion: '1', id: 'com.acme.tool' }));
  const v2 = registry.register('/plugins/v2', makeManifest({ apiVersion: '2', id: 'com.acme.tool' }));

  assertEquals(registry.get('1', 'com.acme.tool'), v1);
  assertEquals(registry.get('2', 'com.acme.tool'), v2);
  assertEquals(v1.sourceDir, '/plugins/v1');
  assertEquals(v2.sourceDir, '/plugins/v2');
  assertEquals(registry.get('3', 'com.acme.tool'), undefined);
});

Deno.test('case-insensitive duplicate id within one apiVersion is rejected', () => {
  const registry = new PluginRegistry();
  registry.register('/plugins/first', makeManifest({ apiVersion: '1', id: 'com.acme.tool' }));

  assertThrows(
    () => {
      registry.register('/plugins/second', makeManifest({ apiVersion: '1', id: 'com.acme.Tool' }));
    },
    Error,
    'Duplicate plugin id'
  );

  // A colliding id under a different apiVersion namespace still registers.
  const other = registry.register('/plugins/third', makeManifest({ apiVersion: '2', id: 'com.acme.tool' }));
  assertEquals(registry.get('2', 'com.acme.tool'), other);
});

Deno.test('listByApiVersion returns only in-namespace plugins and is empty for an unknown namespace', () => {
  const registry = new PluginRegistry();
  registry.register('/plugins/a', makeManifest({ apiVersion: '1', id: 'com.acme.a' }));
  registry.register('/plugins/b', makeManifest({ apiVersion: '1', id: 'com.acme.b' }));
  registry.register('/plugins/c', makeManifest({ apiVersion: '2', id: 'com.acme.c' }));

  const namespaceOne = registry.listByApiVersion('1');
  assertEquals(namespaceOne.length, 2);
  assertEquals(new Set(namespaceOne.map((plugin) => plugin.manifest.id)), new Set(['com.acme.a', 'com.acme.b']));
  assertEquals(registry.listByApiVersion('9'), []);
});

Deno.test('listForPoint returns only in-namespace plugins declaring that point', () => {
  const registry = new PluginRegistry();
  registry.register(
    '/plugins/profile',
    makeManifest({ apiVersion: '1', id: 'com.acme.profile', extensionPoints: ['config.profileCompiled.observe'] })
  );
  registry.register(
    '/plugins/preview',
    makeManifest({ apiVersion: '1', id: 'com.acme.preview', extensionPoints: ['sync.previewComputed.observe'] })
  );
  registry.register(
    '/plugins/other-namespace',
    makeManifest({ apiVersion: '2', id: 'com.acme.profile', extensionPoints: ['config.profileCompiled.observe'] })
  );

  const matches = registry.listForPoint('1', 'config.profileCompiled.observe');
  assertEquals(matches.length, 1);
  assertEquals(matches[0].manifest.id, 'com.acme.profile');
  assertEquals(matches[0].sourceDir, '/plugins/profile');
});

Deno.test('clear empties every namespace', () => {
  const registry = new PluginRegistry();
  registry.register('/plugins/a', makeManifest({ apiVersion: '1', id: 'com.acme.a' }));
  registry.register('/plugins/b', makeManifest({ apiVersion: '2', id: 'com.acme.b' }));

  registry.clear();

  assertEquals(registry.get('1', 'com.acme.a'), undefined);
  assertEquals(registry.get('2', 'com.acme.b'), undefined);
  assertEquals(registry.listByApiVersion('1'), []);
  assertEquals(registry.listByApiVersion('2'), []);
});

Deno.test('the exported pluginRegistry singleton is a PluginRegistry instance', () => {
  assert(pluginRegistry instanceof PluginRegistry);
});
