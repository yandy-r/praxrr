/**
 * `config.profileCompiled.observe` call-site tests (issue #263).
 *
 * Drives the REAL {@link QualityProfileSyncer} producer through its public `sync()` entrypoint — using
 * the same `fetchSyncBatches` / `getQualityMappings` seams that tests/sync/qualityProfilesSyncer.test.ts
 * overrides — and asserts the newly wired `config.profileCompiled.observe` point behaves exactly as the
 * issue-#263 final design requires:
 *
 *   (i)   FIRES: flag on + a registered observer receives ONLY the finalized minimal, secret-free
 *         snapshot (`arrType`,`customFormats`,`id`,`name`,`qualities`) with an Arr-EXPLICIT `arrType`.
 *   (ii)  DISABLED INVARIANCE: flag off + plugin registered never touches the executor and leaves the
 *         producer output byte-identical to the plugin-absent baseline.
 *   (iii) THROWING-PLUGIN INVARIANCE: a rejecting executor never breaks the sync; the producer still writes.
 *   (iv)  NO-PLUGIN: an empty registry lets the producer return normally without touching the executor.
 *   (v)   CALL-SITE THROW ISOLATION: a `notifyObservers` rejection is swallowed by the call-site's inner
 *         try/catch so the syncer still writes and returns normally.
 *
 * Cross-Arr matrix: the FIRES case runs radarr AND sonarr AND lidarr and asserts the captured `arrType`
 * equals the syncer's own instanceType each time (never a sibling).
 *
 * Idioms mirrored from tests/plugins/host.test.ts: readonly-cast + finally-restore of the
 * constructor-cached `config.pluginsEnabled`, `pluginRegistry.register` + `pluginHost.setExecutor`
 * capture, and `{ sanitizeOps: false, sanitizeResources: false }` on tests that drive real dispatch (the
 * host arms a 5s AbortSignal timer). The singleton `pluginHost` is exercised (not a fresh PluginHost)
 * because the producer call-site imports that singleton.
 */

import { assert, assertEquals } from '@std/assert';
import { config } from '$config';
import { QualityProfileSyncer } from '$sync/qualityProfiles/syncer.ts';
import type { PcdQualityProfile } from '$sync/qualityProfiles/transformer.ts';
import type { SyncArrType } from '$sync/mappings.ts';
import type { SyncResult } from '$sync/types.ts';
import { buildCapabilityInput } from '$server/plugins/hostContext.ts';
import {
  PluginHost,
  pluginHost,
  pluginRegistry,
  UnavailablePluginExecutor,
  type PluginExecutionRequest,
  type PluginExecutor,
} from '$server/plugins/index.ts';
import { PLUGIN_API_VERSION, type PluginJsonValue, type PluginManifest } from '$shared/plugins/index.ts';

// ---------------------------------------------------------------------------
// Config-flag control (constructor-cached; flipped via readonly-cast per host.test.ts).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// PCD fixtures + sync-batch seams (mirrors tests/sync/qualityProfilesSyncer.test.ts).
// ---------------------------------------------------------------------------

/** A minimal, secret-free PCD quality profile: id=1, empty qualities/customFormats. */
function createProfile(name: string): PcdQualityProfile {
  return {
    id: 1,
    name,
    upgradesAllowed: true,
    minimumCustomFormatScore: 0,
    upgradeUntilScore: 0,
    upgradeScoreIncrement: 1,
    qualities: [],
    language: null,
    customFormats: [],
  };
}

/** One PCD batch of profiles (the shape `fetchSyncBatches` yields), with empty CFs so no CF I/O runs. */
function createBatch(databaseId: number, suffix: string, profileNames: string[]) {
  return {
    sourceKind: 'pcd' as const,
    sourceLabel: `source-${databaseId}`,
    databaseId,
    suffix,
    profiles: profileNames.map((profileName) => ({
      pcdProfile: createProfile(profileName),
      referencedFormatNames: [] as string[],
    })),
    customFormats: new Map<string, never>(),
    pcdFormatIdMap: new Map<string, number>(),
  };
}

/** One recorded write against the mock Arr client — proves the producer still wrote. */
interface WriteRecord {
  readonly kind: 'create' | 'update';
  readonly payload: unknown;
}

/** A mock Arr client that records every quality-profile write and returns a deterministic remote id. */
function createMockClient(): { client: unknown; writes: WriteRecord[] } {
  const writes: WriteRecord[] = [];
  const client = {
    getCustomFormats: () => Promise.resolve([]),
    getQualityProfiles: () => Promise.resolve([]),
    updateQualityProfile: (_id: number, payload: unknown) => {
      writes.push({ kind: 'update', payload });
      return Promise.resolve({});
    },
    createQualityProfile: (payload: unknown) => {
      writes.push({ kind: 'create', payload });
      return Promise.resolve({ id: 42, name: 'ok', cutoff: 0, qualityProfile: {} });
    },
  };
  return { client, writes };
}

/**
 * Construct a real {@link QualityProfileSyncer} for `arrType`, wire the mocked batch/mapping seams, and
 * run its public `sync()`. Returns the {@link SyncResult} and the recorded writes so callers can assert
 * the producer both fired the observe point and wrote normally.
 */
async function runSyncerForArr(
  arrType: SyncArrType,
  profileNames: string[]
): Promise<{ result: SyncResult; writes: WriteRecord[] }> {
  const { client, writes } = createMockClient();
  const syncer = new QualityProfileSyncer(client as never, 100, 'Test', arrType);
  const syncerAny = syncer as unknown as {
    fetchSyncBatches: () => Promise<ReturnType<typeof createBatch>[]>;
    getQualityMappings: () => Promise<Map<string, string>>;
  };
  syncerAny.fetchSyncBatches = () => Promise.resolve([createBatch(1, '-x', profileNames)]);
  syncerAny.getQualityMappings = () => Promise.resolve(new Map());
  const result = await syncer.sync();
  return { result, writes };
}

// ---------------------------------------------------------------------------
// Executor + registry seams (mirrors tests/plugins/host.test.ts).
// ---------------------------------------------------------------------------

/** A fake executor that records every projected input reaching the seam. */
function createCapturingExecutor(): { executor: PluginExecutor; inputs: PluginJsonValue[] } {
  const inputs: PluginJsonValue[] = [];
  const executor: PluginExecutor = {
    execute(request: PluginExecutionRequest): Promise<PluginJsonValue> {
      inputs.push(request.input);
      return Promise.resolve(null);
    },
  };
  return { executor, inputs };
}

/** A fake executor that always rejects — used to prove a throwing plugin never breaks the producer. */
const throwingExecutor: PluginExecutor = {
  execute(_request: PluginExecutionRequest): Promise<PluginJsonValue> {
    return Promise.reject(new Error('plugin boom'));
  },
};

/** A well-formed manifest declaring the wired `config.profileCompiled.observe` point + its capability. */
const profileObserverManifest: PluginManifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'com.example.profile-observer',
  name: 'Profile Observer Plugin',
  version: '1.0.0',
  runtime: 'wasm',
  entry: 'plugin.wasm',
  extensionPoints: ['config.profileCompiled.observe'],
  capabilities: ['read:resolved-profile'],
};

/**
 * Register the observer manifest on the shared registry, install `executor` on the singleton host, run
 * `fn`, then restore the inert default executor and clear the registry — so tests never leak dispatch state.
 */
async function withObserverDispatch(executor: PluginExecutor, fn: () => Promise<void>): Promise<void> {
  pluginRegistry.clear();
  pluginRegistry.register('/tmp/profile-observer', profileObserverManifest);
  pluginHost.setExecutor(executor);
  try {
    await fn();
  } finally {
    pluginHost.setExecutor(new UnavailablePluginExecutor());
    pluginRegistry.clear();
  }
}

/** The producer output with plugins fully absent — the byte-identical reference for invariance checks. */
async function computeBaseline(arrType: SyncArrType, profileNames: string[]): Promise<SyncResult> {
  let baseline: SyncResult | undefined;
  await withPluginsEnabled(false, async () => {
    pluginRegistry.clear();
    pluginHost.setExecutor(new UnavailablePluginExecutor());
    baseline = (await runSyncerForArr(arrType, profileNames)).result;
  });
  assert(baseline !== undefined, 'baseline sync did not produce a result');
  return baseline;
}

/** Narrow a projected snapshot to a plain-object record for keyed assertions. */
function asRecord(value: PluginJsonValue): { readonly [key: string]: PluginJsonValue } {
  assert(typeof value === 'object' && value !== null && !Array.isArray(value), 'expected a plain-object snapshot');
  return value as { readonly [key: string]: PluginJsonValue };
}

// ---------------------------------------------------------------------------
// (i) FIRES + cross-Arr matrix.
// ---------------------------------------------------------------------------

Deno.test({
  name: 'config.profileCompiled.observe FIRES the finalized minimal snapshot with an Arr-explicit arrType (radarr/sonarr/lidarr)',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    for (const arrType of ['radarr', 'sonarr', 'lidarr'] as const) {
      const { executor, inputs } = createCapturingExecutor();
      await withPluginsEnabled(true, () =>
        withObserverDispatch(executor, async () => {
          const { result, writes } = await runSyncerForArr(arrType, ['Ultra-HD']);

          // The producer completed and wrote normally.
          assertEquals(result.success, true);
          assertEquals(result.itemsSynced, 1);
          assertEquals(writes.length, 1);
          assertEquals(writes[0].kind, 'create');

          // Exactly one dispatch carrying ONLY the finalized allow-listed keys.
          assertEquals(inputs.length, 1);
          const snapshot = asRecord(inputs[0]);
          assertEquals(Object.keys(snapshot).sort(), ['arrType', 'customFormats', 'id', 'name', 'qualities']);

          // Arr-explicit arrType is the syncer's own instanceType, never a sibling.
          assertEquals(snapshot.arrType, arrType);
          assertEquals(snapshot.id, 1);
          assertEquals(snapshot.name, 'Ultra-HD');
          assertEquals(snapshot.qualities, []);
          assertEquals(snapshot.customFormats, []);

          // The captured snapshot is exactly the canonical projection of {...pcdProfile, arrType}.
          assertEquals(
            snapshot,
            buildCapabilityInput('read:resolved-profile', { ...createProfile('Ultra-HD'), arrType })
          );
        })
      );
    }
  },
});

// ---------------------------------------------------------------------------
// (ii) DISABLED INVARIANCE.
// ---------------------------------------------------------------------------

Deno.test('config.profileCompiled.observe DISABLED: flag off + plugin registered never calls the executor and output is byte-identical', async () => {
  const baseline = await computeBaseline('radarr', ['Ultra-HD']);
  const { executor, inputs } = createCapturingExecutor();

  await withPluginsEnabled(false, () =>
    withObserverDispatch(executor, async () => {
      const { result, writes } = await runSyncerForArr('radarr', ['Ultra-HD']);
      assertEquals(inputs.length, 0);
      assertEquals(writes.length, 1);
      assertEquals(result, baseline);
    })
  );
});

// ---------------------------------------------------------------------------
// (iii) THROWING-PLUGIN INVARIANCE.
// ---------------------------------------------------------------------------

Deno.test({
  name: 'config.profileCompiled.observe THROWING PLUGIN: a rejecting executor never breaks the sync and the producer still writes',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const baseline = await computeBaseline('radarr', ['Ultra-HD']);

    await withPluginsEnabled(true, () =>
      withObserverDispatch(throwingExecutor, async () => {
        const { result, writes } = await runSyncerForArr('radarr', ['Ultra-HD']);
        assertEquals(result.success, true);
        assertEquals(writes.length, 1);
        assertEquals(writes[0].kind, 'create');
        assertEquals(result, baseline);
      })
    );
  },
});

// ---------------------------------------------------------------------------
// (iv) NO-PLUGIN.
// ---------------------------------------------------------------------------

Deno.test('config.profileCompiled.observe NO PLUGIN: an empty registry lets the producer return normally without the executor', async () => {
  const { executor, inputs } = createCapturingExecutor();

  await withPluginsEnabled(true, async () => {
    pluginRegistry.clear();
    pluginHost.setExecutor(executor);
    try {
      const { result, writes } = await runSyncerForArr('radarr', ['Ultra-HD']);
      assertEquals(result.success, true);
      assertEquals(writes.length, 1);
      // notifyObservers returns early with zero registered plugins — the executor is never reached.
      assertEquals(inputs.length, 0);
    } finally {
      pluginHost.setExecutor(new UnavailablePluginExecutor());
      pluginRegistry.clear();
    }
  });
});

// ---------------------------------------------------------------------------
// (v) CALL-SITE THROW ISOLATION.
// ---------------------------------------------------------------------------

Deno.test('config.profileCompiled.observe CALL-SITE THROW: a notifyObservers rejection is caught at the call-site so the syncer still writes and returns normally', async () => {
  const baseline = await computeBaseline('radarr', ['Ultra-HD']);

  // Replace the singleton's `notifyObservers` with a rejecting stub (an own property that shadows the
  // prototype method); `delete` restores the real method afterward.
  const hostAny = pluginHost as unknown as { notifyObservers?: PluginHost['notifyObservers'] };
  hostAny.notifyObservers = (() => Promise.reject(new Error('call-site boom'))) as PluginHost['notifyObservers'];

  try {
    await withPluginsEnabled(true, async () => {
      pluginRegistry.clear();
      const { result, writes } = await runSyncerForArr('radarr', ['Ultra-HD']);
      assertEquals(result.success, true);
      assertEquals(writes.length, 1);
      assertEquals(writes[0].kind, 'create');
      assertEquals(result, baseline);
    });
  } finally {
    delete hostAny.notifyObservers;
    pluginRegistry.clear();
  }
});
