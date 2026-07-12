import { assertEquals } from '@std/assert';
import type { components } from '$api/v1.d.ts';
import {
  isPluginListResponse,
  isPluginMutationResponse,
  isPluginRecord,
  isPluginReloadResponse,
} from '../../routes/settings/plugins/contract.ts';

type PluginRecord = components['schemas']['PluginRecord'];

const timestamp = '2026-07-12T00:00:00.000Z';

function plugin(): PluginRecord {
  return {
    manifest: {
      apiVersion: '1',
      id: 'example.plugin',
      name: 'Example Plugin',
      version: '1.0.0',
      runtime: 'wasm',
      entry: 'plugin.wasm',
      extensionPoints: ['sync.previewComputed.observe'],
      capabilities: ['read:sync-preview'],
    },
    enabled: false,
    discovered: true,
    state: 'registered',
    registeredAt: timestamp,
    lastError: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

Deno.test('plugin record decoder accepts the generated contract and rejects malformed fields', () => {
  const valid = plugin();

  assertEquals(isPluginRecord(valid), true);
  assertEquals(isPluginRecord({ ...valid, state: 'running' }), false);
  assertEquals(isPluginRecord({ ...valid, manifest: { ...valid.manifest, capabilities: ['write:all'] } }), false);
  assertEquals(isPluginRecord({ ...valid, manifest: { ...valid.manifest, extensionPoints: [42] } }), false);
  assertEquals(isPluginRecord({ ...valid, updatedAt: null }), false);
});

Deno.test('plugin list decoder validates the feature flag, array, and every record', () => {
  const valid = { pluginsEnabled: true, items: [plugin()] };

  assertEquals(isPluginListResponse(valid), true);
  assertEquals(isPluginListResponse({ ...valid, pluginsEnabled: 'true' }), false);
  assertEquals(isPluginListResponse({ ...valid, items: [{ ...plugin(), enabled: 'yes' }] }), false);
});

Deno.test('plugin mutation decoder requires enabled feature state and a complete record', () => {
  const valid = { pluginsEnabled: true as const, plugin: plugin() };

  assertEquals(isPluginMutationResponse(valid), true);
  assertEquals(isPluginMutationResponse({ ...valid, pluginsEnabled: false }), false);
  assertEquals(isPluginMutationResponse({ ...valid, plugin: { ...plugin(), discovered: null } }), false);
});

Deno.test('plugin reload decoder accepts non-negative integer counters only', () => {
  const valid = {
    pluginsEnabled: true,
    reloaded: true,
    discovered: 2,
    registered: 1,
    rejected: 0,
    missing: 1,
  };

  assertEquals(isPluginReloadResponse(valid), true);
  assertEquals(isPluginReloadResponse({ ...valid, reloaded: 'yes' }), false);
  assertEquals(isPluginReloadResponse({ ...valid, rejected: -1 }), false);
  assertEquals(isPluginReloadResponse({ ...valid, missing: 0.5 }), false);
});
