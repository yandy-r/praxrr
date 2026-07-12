import { assert, assertEquals, assertFalse, assertMatch, assertThrows } from '@std/assert';
import { CAPABILITY_CATALOG } from '$shared/plugins/capabilities.ts';
import { EXTENSION_POINTS } from '$shared/plugins/extensionPoints.ts';
import {
  capabilityPresentations,
  discoveryPresentation,
  enablementIntentPresentation,
  executionTelemetryPresentation,
  extensionPointPresentations,
  lifecyclePresentation,
  pluginIdentityKey,
  type PluginLifecycleState,
  pluginMutationUrl,
  type PluginRecord,
  sortPluginsForPresentation,
} from '../../routes/settings/plugins/presentation.ts';

const timestamp = '2026-07-12T00:00:00.000Z';

function plugin(overrides: Partial<PluginRecord> = {}): PluginRecord {
  return {
    manifest: {
      apiVersion: '1',
      id: 'Example.Plugin',
      name: 'Example Plugin',
      version: '1.0.0',
      runtime: 'wasm',
      entry: 'plugin.wasm',
      extensionPoints: [],
      capabilities: [],
    },
    enabled: false,
    discovered: true,
    state: 'registered',
    registeredAt: timestamp,
    lastError: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

Deno.test('pluginIdentityKey scopes case-insensitive ids by exact API version without delimiter collisions', () => {
  assertEquals(pluginIdentityKey(plugin()), '["1","example.plugin"]');
  assertEquals(
    pluginIdentityKey(plugin({ manifest: { ...plugin().manifest, id: 'EXAMPLE.PLUGIN' } })),
    pluginIdentityKey(plugin())
  );
  assertFalse(
    pluginIdentityKey(plugin({ manifest: { ...plugin().manifest, apiVersion: '2' } })) === pluginIdentityKey(plugin())
  );
  assertFalse(
    pluginIdentityKey(
      plugin({
        manifest: { ...plugin().manifest, apiVersion: 'one:two', id: 'three' },
      })
    ) ===
      pluginIdentityKey(
        plugin({
          manifest: {
            ...plugin().manifest,
            apiVersion: 'one',
            id: 'two:three',
          },
        })
      )
  );
});

Deno.test('pluginMutationUrl independently encodes exact namespace and id segments', () => {
  const record = plugin({
    manifest: {
      ...plugin().manifest,
      apiVersion: 'v1/preview',
      id: 'Mixed/ID ?#%',
    },
  });

  assertEquals(pluginMutationUrl(record, 'enable'), '/api/v1/plugins/v1%2Fpreview/Mixed%2FID%20%3F%23%25/enable');
  assertEquals(pluginMutationUrl(record, 'disable'), '/api/v1/plugins/v1%2Fpreview/Mixed%2FID%20%3F%23%25/disable');
});

Deno.test('sortPluginsForPresentation is discovered-first, deterministic, and non-mutating', () => {
  const missingAlpha = plugin({
    discovered: false,
    manifest: { ...plugin().manifest, id: 'missing', name: 'Alpha' },
  });
  const presentZuluV2 = plugin({
    manifest: {
      ...plugin().manifest,
      apiVersion: '2',
      id: 'zulu',
      name: 'Zulu',
    },
  });
  const presentAlphaUpper = plugin({
    manifest: { ...plugin().manifest, apiVersion: '1', id: 'B', name: 'alpha' },
  });
  const presentAlphaLower = plugin({
    manifest: { ...plugin().manifest, apiVersion: '1', id: 'a', name: 'alpha' },
  });
  const source = [missingAlpha, presentZuluV2, presentAlphaUpper, presentAlphaLower];

  assertEquals(
    sortPluginsForPresentation(source).map((item) => item.manifest.id),
    ['a', 'B', 'zulu', 'missing']
  );
  assertEquals(
    source.map((item) => item.manifest.id),
    ['missing', 'zulu', 'B', 'a']
  );

  const same = [plugin(), plugin()];
  assertEquals(sortPluginsForPresentation(same), same);
});

Deno.test('lifecyclePresentation exhaustively labels lifecycle evidence without run claims', () => {
  const states: PluginLifecycleState[] = [
    'discovered',
    'validated',
    'registered',
    'rejected',
    'activated',
    'failed',
    'unloaded',
  ];

  assertEquals(
    states.map((state) => lifecyclePresentation(state).label),
    ['Discovered', 'Validated', 'Registered', 'Rejected', 'Activated', 'Failed', 'Unloaded']
  );
  for (const state of states) {
    const view = lifecyclePresentation(state);
    assert(view.description.length > 0);
    assertFalse(/currently active|currently running|last run succeeded|last run failed/i.test(view.description));
  }
  assertMatch(lifecyclePresentation('registered').description, /does not prove activation or execution/i);
  assertMatch(lifecyclePresentation('failed').description, /not a recent run result/i);
});

Deno.test('discovery and enablement intent stay independent and use rediscovery wording', () => {
  assertEquals(discoveryPresentation({ discovered: true }).label, 'Present');
  assertEquals(discoveryPresentation({ discovered: false }).label, 'Missing from latest scan');

  assertEquals(enablementIntentPresentation({ enabled: true, discovered: true }).label, 'Enabled for future dispatch');
  assertEquals(enablementIntentPresentation({ enabled: false, discovered: true }).label, 'Disabled');
  for (const enabled of [true, false]) {
    const view = enablementIntentPresentation({ enabled, discovered: false });
    assertMatch(`${view.label} ${view.description} ${view.actionLabel}`, /when (the plugin is )?rediscovered/i);
    assertFalse(/active|running/i.test(`${view.label} ${view.description} ${view.actionLabel}`));
  }
});

Deno.test('capabilityPresentations resolves every grant from the authoritative catalog', () => {
  const record = plugin({
    manifest: {
      ...plugin().manifest,
      capabilities: CAPABILITY_CATALOG.map((capability) => capability.id),
    },
  });
  const views = capabilityPresentations(record);

  assertEquals(views.length, CAPABILITY_CATALOG.length);
  assertEquals(
    views,
    CAPABILITY_CATALOG.map((capability) => ({
      id: capability.id,
      label: capability.label,
      description: capability.description,
      mutates: false,
      touchesSecrets: false,
      compatiblePoints: capability.compatiblePoints,
    }))
  );
});

Deno.test('extensionPointPresentations resolves every declaration and wiring fact from the catalog', () => {
  const record = plugin({
    manifest: {
      ...plugin().manifest,
      extensionPoints: EXTENSION_POINTS.map((point) => point.id),
    },
  });
  const views = extensionPointPresentations(record);

  assertEquals(views.length, EXTENSION_POINTS.length);
  assertEquals(
    views,
    EXTENSION_POINTS.map((point) => ({
      id: point.id,
      kind: point.kind,
      wired: point.wired,
      wiringLabel: point.wired ? 'Wired' : 'Declared, not wired',
      mutates: point.mutates,
      requiredCapability: point.requiredCapability,
    }))
  );
});

Deno.test('catalog drift fails closed instead of manufacturing grant or wiring metadata', () => {
  const unknownCapability = plugin({
    manifest: {
      ...plugin().manifest,
      capabilities: ['read:invented'] as unknown as PluginRecord['manifest']['capabilities'],
    },
  });
  const unknownPoint = plugin({
    manifest: {
      ...plugin().manifest,
      extensionPoints: ['invented.point'] as unknown as PluginRecord['manifest']['extensionPoints'],
    },
  });

  assertThrows(() => capabilityPresentations(unknownCapability), Error, 'Unsupported plugin capability');
  assertThrows(() => extensionPointPresentations(unknownPoint), Error, 'Unsupported plugin extension point');
});

Deno.test('execution telemetry is explicitly unavailable and cannot be inferred from plugin state', () => {
  const states: PluginLifecycleState[] = ['registered', 'activated', 'failed'];
  const baseline = executionTelemetryPresentation();

  assertEquals(baseline.available, false);
  assertEquals(baseline.label, 'Execution telemetry unavailable in this build');
  assertMatch(baseline.description, /does not expose runtime availability, recent executions, results, or durations/i);
  for (const state of states) {
    const record = plugin({
      state,
      enabled: true,
      discovered: true,
      lastError: 'lifecycle-only',
    });
    assert(record.state === state);
    assertEquals(executionTelemetryPresentation(), baseline);
  }
  assertFalse('active' in baseline);
  assertFalse('running' in baseline);
});
