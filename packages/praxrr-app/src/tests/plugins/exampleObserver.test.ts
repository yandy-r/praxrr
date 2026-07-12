/**
 * Drift-proof tests for the shipped example plugin (issue #265).
 *
 * These bind the published example at `examples/plugins/sync-preview-observer/` to the REAL Phase-1
 * contract, scan boundary, validator, registry, and host — so the developer-facing docs cannot drift
 * from what the runtime actually accepts. They deliberately build NO WebAssembly: discovery,
 * validation, and registration read only the JSON manifest (the `.wasm` entry is validated as a string
 * and never opened), which is exactly the slice that works today.
 *
 * They also pin the honest boundary the docs promise: a registered plugin is NOT observed/executed in
 * Phase-1 — `notifyObservers` dispatches through the default `UnavailablePluginExecutor`, whose
 * rejection is swallowed, so the call resolves without ever running guest code.
 */

import { assert, assertEquals } from '@std/assert';
import {
  checkCapabilityGrant,
  getExtensionPoint,
  PLUGIN_API_VERSION,
  validatePluginManifest,
  type PluginJsonValue,
} from '$shared/plugins/index.ts';
import { scanPluginDir } from '$server/plugins/scan.ts';
import { PluginHost, pluginRegistry } from '$server/plugins/index.ts';

/** The shipped example manifest, resolved at the repo root (5 levels up from `src/tests/plugins/`). */
const EXAMPLE_MANIFEST_URL = new URL(
  '../../../../../examples/plugins/sync-preview-observer/praxrr.plugin.json',
  import.meta.url
);

/** Read the shipped manifest bytes; a missing file is a loud failure, not a silent skip. */
async function readExampleManifest(): Promise<{ text: string; raw: unknown }> {
  const text = await Deno.readTextFile(EXAMPLE_MANIFEST_URL);
  return { text, raw: JSON.parse(text) };
}

Deno.test('example manifest validates and matches its documented contract', async () => {
  const { raw } = await readExampleManifest();

  const result = validatePluginManifest(raw);
  assert(result.ok, `example manifest must be valid: ${JSON.stringify(result)}`);

  const { manifest } = result;
  assertEquals(manifest.apiVersion, PLUGIN_API_VERSION);
  assertEquals(manifest.id, 'dev.praxrr.examples.sync-preview-observer');
  assertEquals(manifest.runtime, 'wasm');
  assertEquals(manifest.entry, 'plugin.wasm');
  assertEquals(manifest.extensionPoints, ['sync.previewComputed.observe']);
  assertEquals(manifest.capabilities, ['read:sync-preview']);

  // The example targets a WIRED observe point and declares a capability that point can legitimately
  // consume — so any rename/unwiring or capability-map change breaks this test, not just the docs.
  assertEquals(getExtensionPoint('sync.previewComputed.observe')?.wired, true);
  assert(checkCapabilityGrant('sync.previewComputed.observe', 'read:sync-preview'));
});

Deno.test('example is discovered and registered by the real scan/validator/registry (no wasm)', async () => {
  const { text } = await readExampleManifest();
  const dir = await Deno.makeTempDir({ prefix: 'plugin-example-observer-' });
  try {
    // Install the manifest into a temp PLUGINS_DIR exactly as a developer would — WITHOUT a
    // plugin.wasm present, proving discovery/validation/registration never touch the binary.
    const pluginDir = `${dir}/dev.praxrr.examples.sync-preview-observer`;
    await Deno.mkdir(pluginDir);
    await Deno.writeTextFile(`${pluginDir}/praxrr.plugin.json`, text);

    // Discovery — the only filesystem boundary.
    const entries = await scanPluginDir(dir);
    assertEquals(entries.length, 1);
    assertEquals(entries[0].parseError, undefined);
    assert(entries[0].raw !== undefined);

    // Validation — the real fail-fast validator.
    const result = validatePluginManifest(entries[0].raw);
    assert(result.ok, `discovered example manifest must validate: ${JSON.stringify(result)}`);

    // Registration — the real apiVersion-namespaced registry.
    pluginRegistry.clear();
    try {
      const registered = pluginRegistry.register(entries[0].dir, result.manifest);
      assertEquals(registered.state, 'registered');
      const forPoint = pluginRegistry.listForPoint(PLUGIN_API_VERSION, 'sync.previewComputed.observe');
      assert(forPoint.some((plugin) => plugin.manifest.id === result.manifest.id));
    } finally {
      pluginRegistry.clear();
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test('a registered example plugin is not observed: dispatch no-ops via the unavailable executor', async () => {
  const { raw } = await readExampleManifest();
  const result = validatePluginManifest(raw);
  assert(result.ok);

  pluginRegistry.clear();
  try {
    pluginRegistry.register('/virtual/example', result.manifest);

    // A fresh host uses the default UnavailablePluginExecutor and reads the shared registry. The
    // dispatch settles as runtime-unavailable (swallowed), so this resolves WITHOUT running guest code
    // and WITHOUT throwing — the exact "registered, not observed" guarantee the docs describe.
    const host = new PluginHost();
    const snapshot: PluginJsonValue = { arrType: 'radarr', instanceId: 1, summary: {}, sections: [] };
    await host.notifyObservers('sync.previewComputed.observe', () => snapshot);
  } finally {
    pluginRegistry.clear();
  }
});
