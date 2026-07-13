/**
 * `sync.previewComputed.observe` call-site tests (issue #263).
 *
 * Proves the observe point wired into `_handleSyncPreviewCreateRequest` behaves exactly as the
 * finalized design demands. The call-site sits inside the create handler's outer try, immediately
 * after `dependencies.generatePreview(...)` resolves and before the eligibility/section-error logic:
 *
 *     if (isPluginsEnabled()) {
 *       try {
 *         await pluginHost.notifyObservers('sync.previewComputed.observe', () =>
 *           buildCapabilityInput('read:sync-preview', generated)
 *         );
 *       } catch (error) { await logger.warn(...); }
 *     }
 *
 * Because the outer try's catch (route line ~392) classifies ANY throw as a generation FAILURE -> 500,
 * the inner try/catch is load-bearing: a host-internal throw must NOT flip a good 200 preview to a
 * failed 500. These tests drive the real handler via the same injected `SyncPreviewCreateDependencies`
 * shape used by `syncPreviewRouteHardening.test.ts` (fake `generatePreview` returning a canned
 * `GeneratePreviewResult` + reviewContext, fake `getInstanceById`, fake `getReviewClient`) and mirror
 * the plugin idioms from `tests/plugins/host.test.ts` (`withPluginsFeature`, `pluginRegistry`
 * register/clear, `pluginHost.setExecutor` capture seam).
 *
 * Invariants covered (5):
 *  (i)   FIRES: flag on + plugin registered => the executor receives EXACTLY the finalized redacted
 *        `read:sync-preview` snapshot (`['arrType','instanceId','sections','summary']`), with the
 *        Arr-native `arrType === generated.arrType`. Parametrized across radarr / sonarr / lidarr.
 *  (ii)  DISABLED INVARIANCE: flag off + plugin registered => executor NEVER called; preview unchanged.
 *  (iii) THROWING-PLUGIN INVARIANCE: executor rejects => the host isolates it; preview still 200 `ready`.
 *  (iv)  NO-PLUGIN: registry empty => `notifyObservers` returns early (executor never called); 200 `ready`.
 *  (v)   CALL-SITE THROW ISOLATION: stub `pluginHost.notifyObservers` to reject => the new inner
 *        try/catch swallows it and the handler STILL returns the successful 200 `ready` preview (never
 *        a 500 FAILED).
 *
 * NOTE: assertions target the FINALIZED `read:sync-preview` allow-list
 * (`['arrType','instanceId','summary','sections']`) and the wired call-site delivered by issue #263;
 * they are the runtime contract this test file locks in.
 */

import { assert, assertEquals } from '@std/assert';
import {
  _handleSyncPreviewCreateRequest,
  type SyncPreviewCreateDependencies,
} from '../../routes/api/v1/sync/preview/+server.ts';
import type { ArrInstance } from '../../lib/server/db/queries/arrInstances.ts';
import { previewStore } from '../../lib/server/sync/preview/store.ts';
import { resetPreviewCreateRateLimitForTests } from '../../lib/server/sync/preview/limits.ts';
import type { GeneratePreviewResult } from '../../lib/server/sync/preview/orchestrator.ts';
import type { SyncPreviewArrType, SyncPreviewResult } from '../../lib/server/sync/preview/types.ts';
import type { BaseArrClient } from '../../lib/server/utils/arr/base.ts';
import {
  pluginHost,
  PluginHost,
  pluginRegistry,
  resetPluginsEnabledCacheForTests,
  setPluginsEnabledCacheForTests,
  UnavailablePluginExecutor,
  type PluginExecutionRequest,
  type PluginExecutor,
} from '$server/plugins/index.ts';
import { PLUGIN_API_VERSION, type PluginJsonValue, type PluginManifest } from '$shared/plugins/index.ts';

/** The finalized top-level keys `read:sync-preview` projects from a `GeneratePreviewResult`, sorted. */
const EXPECTED_SNAPSHOT_KEYS = ['arrType', 'instanceId', 'sections', 'summary'] as const;

const ISO_NOW = '2026-07-11T00:00:00.000Z';

/** The `notifyObservers` method type, used to stub the singleton host for the call-site-throw test. */
type NotifyObservers = PluginHost['notifyObservers'];

/** A manifest declaring the wired observe point AND its granted capability so `listForPoint` finds it. */
function observerManifest(id = 'com.example.preview-observer'): PluginManifest {
  return {
    apiVersion: PLUGIN_API_VERSION,
    id,
    name: 'Preview Observer',
    version: '1.0.0',
    runtime: 'wasm',
    entry: 'plugin.wasm',
    extensionPoints: ['sync.previewComputed.observe'],
    capabilities: ['read:sync-preview'],
  };
}

/** Mutable capture cell filled by the fake executor at the dispatch seam. */
interface CaptureCell {
  called: boolean;
  input: PluginJsonValue | undefined;
}

function newCaptureCell(): CaptureCell {
  return { called: false, input: undefined };
}

/** A fake executor that records the projected + scrubbed input the host hands across the seam. */
function captureExecutor(cell: CaptureCell): PluginExecutor {
  return {
    execute(request: PluginExecutionRequest): Promise<PluginJsonValue> {
      cell.called = true;
      cell.input = request.input;
      return Promise.resolve(null);
    },
  };
}

/** A fake executor that always rejects — the host must isolate it and never propagate to the caller. */
const throwingExecutor: PluginExecutor = {
  execute(): Promise<PluginJsonValue> {
    return Promise.reject(new Error('observer plugin execution blew up'));
  },
};

function createArrInstanceFixture(arrType: SyncPreviewArrType, instanceId: number): ArrInstance {
  return {
    id: instanceId,
    name: `${arrType} preview instance`,
    type: arrType,
    url: `http://${arrType}.local`,
    external_url: null,
    api_key_fingerprint: 'credential-v1',
    api_key: '',
    tags: null,
    enabled: 1,
    source: 'ui',
    created_at: ISO_NOW,
    updated_at: ISO_NOW,
  };
}

/**
 * A deterministic, secret-free `GeneratePreviewResult` with exactly one eligible section so the handler
 * takes the happy path and returns a 200 `ready` preview. Its native `arrType` is the Arr-explicit value
 * the observe snapshot must echo.
 */
function cannedPreview(arrType: SyncPreviewArrType, instanceId: number, nowMs: number): GeneratePreviewResult {
  return {
    instanceId,
    instanceName: `${arrType} preview instance`,
    arrType,
    status: 'ready',
    createdAtMs: nowMs,
    sections: ['qualityProfiles'],
    sectionOutcomes: [{ section: 'qualityProfiles', failure: null, skipped: false }],
    qualityProfiles: {
      section: 'qualityProfiles',
      customFormats: [{ entityType: 'customFormat', name: 'HDR10', action: 'create', remoteId: null, fields: [] }],
      qualityProfiles: [],
    },
    delayProfiles: null,
    mediaManagement: null,
    metadataProfiles: null,
    summary: { totalCreates: 1, totalUpdates: 0, totalDeletes: 0, totalUnchanged: 0 },
  };
}

function createDependencies(arrType: SyncPreviewArrType, instanceId: number): SyncPreviewCreateDependencies {
  const instance = createArrInstanceFixture(arrType, instanceId);
  const client = { close: () => undefined } as unknown as BaseArrClient;
  return {
    generatePreview: (input) =>
      Promise.resolve({
        preview: cannedPreview(arrType, instanceId, input.nowMs ?? Date.now()),
        reviewContext: {
          sectionConfigs: {},
          evidence: [
            {
              section: 'qualityProfiles',
              pcd: { desired: 'reviewed' },
              arr: { current: 'reviewed' },
              plan: { action: 'create' },
            },
          ],
          preparedExecutionContexts: {},
        },
      }),
    getInstanceById: () => instance,
    getReviewClient: (_type, inst) =>
      Promise.resolve({
        client,
        credentialIdentity: {
          fingerprint: inst.api_key_fingerprint!,
          keyVersion: 'legacy',
          revision: inst.updated_at,
        },
      }),
    now: () => Date.now(),
  };
}

function createPreviewCreateRequest(instanceId: number): Request {
  return new Request('http://localhost/api/v1/sync/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instanceId }),
  });
}

/** Drive the real create handler, tracking the created preview id for teardown. */
async function driveCreate(
  arrType: SyncPreviewArrType,
  instanceId: number,
  createdIds: string[]
): Promise<{ response: Response; payload: SyncPreviewResult }> {
  resetPreviewCreateRateLimitForTests();
  const response = await _handleSyncPreviewCreateRequest(
    createPreviewCreateRequest(instanceId),
    createDependencies(arrType, instanceId)
  );
  const payload = (await response.json()) as SyncPreviewResult;
  createdIds.push(payload.id);
  return { response, payload };
}

/** The stable, non-volatile view of a preview (drops the per-request id + timestamps). */
function stableView(payload: SyncPreviewResult): Record<string, unknown> {
  const clone = { ...payload } as Record<string, unknown>;
  delete clone.id;
  delete clone.createdAt;
  delete clone.expiresAt;
  return clone;
}

/** Assert the handler produced the canonical happy-path 200 `ready` preview for `arrType`. */
function assertReadyPreview(
  response: Response,
  payload: SyncPreviewResult,
  arrType: SyncPreviewArrType,
  label: string
): void {
  assertEquals(response.status, 200, `${label}: response status`);
  assertEquals(payload.status, 'ready', `${label}: preview status`);
  assertEquals(payload.failure, null, `${label}: no failure`);
  assertEquals(payload.arrType, arrType, `${label}: arrType`);
  assertEquals(payload.sections, ['qualityProfiles'], `${label}: sections`);
  assertEquals(
    payload.summary,
    { totalCreates: 1, totalUpdates: 0, totalDeletes: 0, totalUnchanged: 0 },
    `${label}: summary`
  );
  assert(payload.qualityProfiles !== null, `${label}: successful-section evidence preserved`);
}

/** Reset the shared plugin singletons to their inert defaults. */
function resetPluginSingletons(): void {
  pluginHost.setExecutor(new UnavailablePluginExecutor());
  pluginRegistry.clear();
}

const ARR_TYPES: readonly SyncPreviewArrType[] = ['radarr', 'sonarr', 'lidarr'];

// (i) FIRES + cross-Arr matrix -------------------------------------------------------------------
Deno.test({
  name: 'sync.previewComputed.observe hands the finalized redacted snapshot per Arr type (radarr/sonarr/lidarr)',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const createdIds: string[] = [];
    const cell = newCaptureCell();
    pluginRegistry.clear();
    setPluginsEnabledCacheForTests(true);
    pluginRegistry.register('/tmp/preview-observer', observerManifest());
    pluginHost.setExecutor(captureExecutor(cell));

    try {
      let instanceId = 263001;
      for (const arrType of ARR_TYPES) {
        cell.called = false;
        cell.input = undefined;

        const { response, payload } = await driveCreate(arrType, instanceId, createdIds);
        // The producer still returns its successful preview...
        assertReadyPreview(response, payload, arrType, `${arrType} fire`);

        // ...and the observer received EXACTLY the finalized, secret-free projection — nothing more.
        assert(cell.called, `${arrType}: executor must have been invoked`);
        const captured = cell.input;
        assert(
          typeof captured === 'object' && captured !== null && !Array.isArray(captured),
          `${arrType}: captured input must be a JSON object`
        );
        const record = captured as { readonly [key: string]: PluginJsonValue };

        assertEquals(Object.keys(record).sort(), [...EXPECTED_SNAPSHOT_KEYS], `${arrType}: snapshot keys`);
        // Arr-native identity: never a sibling app's type.
        assertEquals(record.arrType, arrType, `${arrType}: snapshot arrType echoes generated.arrType`);
        assertEquals(record.instanceId, instanceId, `${arrType}: snapshot instanceId`);
        assertEquals(record.sections, ['qualityProfiles'], `${arrType}: snapshot sections`);
        assertEquals(
          record.summary,
          { totalCreates: 1, totalUpdates: 0, totalDeletes: 0, totalUnchanged: 0 },
          `${arrType}: snapshot summary`
        );

        instanceId += 1;
      }
    } finally {
      resetPluginSingletons();
      resetPluginsEnabledCacheForTests();
      for (const id of createdIds) previewStore.delete(id);
      resetPreviewCreateRateLimitForTests();
    }
  },
});

// (ii) DISABLED INVARIANCE -----------------------------------------------------------------------
Deno.test({
  name: 'sync.previewComputed.observe never dispatches when plugins are disabled (byte-identical preview)',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const createdIds: string[] = [];
    const cell = newCaptureCell();
    pluginRegistry.clear();

    try {
      // Baseline with a real plugin present but the flag OFF: the call-site guard must skip dispatch.
      setPluginsEnabledCacheForTests(false);
      pluginRegistry.register('/tmp/preview-observer', observerManifest());
      pluginHost.setExecutor(captureExecutor(cell));

      const { response, payload } = await driveCreate('radarr', 263010, createdIds);
      assertReadyPreview(response, payload, 'radarr', 'disabled');
      assertEquals(cell.called, false, 'disabled: executor must never be invoked');
      assertEquals(cell.input, undefined, 'disabled: no input may cross the seam');

      // The produced preview is structurally identical to one generated with the plugin layer inert
      // (same instanceId so only the per-request id/timestamps differ, which stableView drops).
      resetPluginSingletons();
      const { payload: bare } = await driveCreate('radarr', 263010, createdIds);
      assertEquals(stableView(payload), stableView(bare), 'disabled: preview unchanged vs inert baseline');
    } finally {
      resetPluginSingletons();
      resetPluginsEnabledCacheForTests();
      for (const id of createdIds) previewStore.delete(id);
      resetPreviewCreateRateLimitForTests();
    }
  },
});

// (iii) THROWING-PLUGIN INVARIANCE ---------------------------------------------------------------
Deno.test({
  name: 'sync.previewComputed.observe absorbs a rejecting executor and still returns the successful preview',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const createdIds: string[] = [];
    pluginRegistry.clear();

    try {
      // Baseline with the plugin layer inert, for a structural-identity comparison (same instanceId).
      resetPluginSingletons();
      setPluginsEnabledCacheForTests(false);
      const { payload: baseline } = await driveCreate('radarr', 263020, createdIds);

      // Now flag ON with a registered plugin whose executor throws — the host must isolate it.
      setPluginsEnabledCacheForTests(true);
      pluginRegistry.register('/tmp/preview-observer', observerManifest());
      pluginHost.setExecutor(throwingExecutor);

      const { response, payload } = await driveCreate('radarr', 263020, createdIds);
      assertReadyPreview(response, payload, 'radarr', 'throwing');
      assertEquals(stableView(payload), stableView(baseline), 'throwing: preview identical to inert baseline');
    } finally {
      resetPluginSingletons();
      resetPluginsEnabledCacheForTests();
      for (const id of createdIds) previewStore.delete(id);
      resetPreviewCreateRateLimitForTests();
    }
  },
});

// (iv) NO-PLUGIN ---------------------------------------------------------------------------------
Deno.test({
  name: 'sync.previewComputed.observe is a no-op when the registry is empty (executor never called)',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const createdIds: string[] = [];
    const cell = newCaptureCell();
    pluginRegistry.clear();

    try {
      // Flag ON, but NO plugin registered: notifyObservers returns early before any executor call.
      setPluginsEnabledCacheForTests(true);
      pluginHost.setExecutor(captureExecutor(cell));

      const { response, payload } = await driveCreate('radarr', 263030, createdIds);
      assertReadyPreview(response, payload, 'radarr', 'no-plugin');
      assertEquals(cell.called, false, 'no-plugin: executor must never be invoked with an empty registry');
      assertEquals(cell.input, undefined, 'no-plugin: no input may cross the seam');
    } finally {
      resetPluginSingletons();
      resetPluginsEnabledCacheForTests();
      for (const id of createdIds) previewStore.delete(id);
      resetPreviewCreateRateLimitForTests();
    }
  },
});

// (v) CALL-SITE THROW ISOLATION ------------------------------------------------------------------
Deno.test({
  name: 'sync.previewComputed.observe inner try/catch keeps a host-internal throw from flipping 200 to 500',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const createdIds: string[] = [];
    pluginRegistry.clear();

    // Stub the singleton host so `notifyObservers` itself rejects (host-internal failure), exercising
    // the new inner try/catch at the call-site rather than the host's own per-plugin isolation.
    const hostAsRecord = pluginHost as unknown as { notifyObservers: NotifyObservers };
    const originalNotify = hostAsRecord.notifyObservers;
    const rejectingNotify: NotifyObservers = () => Promise.reject(new Error('host-internal observe failure'));

    try {
      // Baseline (inert plugin layer, original host) for a structural-identity comparison (same id).
      resetPluginSingletons();
      setPluginsEnabledCacheForTests(false);
      const { payload: baseline } = await driveCreate('radarr', 263040, createdIds);

      // Flag ON + rejecting host: the handler must swallow the throw and return the good preview.
      setPluginsEnabledCacheForTests(true);
      hostAsRecord.notifyObservers = rejectingNotify;

      const { response, payload } = await driveCreate('radarr', 263040, createdIds);
      // Must be the successful 200 `ready` preview — NOT a 500 FAILED from the outer catch.
      assertReadyPreview(response, payload, 'radarr', 'call-site-throw');
      assertEquals(payload.status === 'failed', false, 'call-site-throw: preview must not be marked failed');
      assertEquals(stableView(payload), stableView(baseline), 'call-site-throw: preview identical to baseline');
    } finally {
      hostAsRecord.notifyObservers = originalNotify;
      resetPluginSingletons();
      resetPluginsEnabledCacheForTests();
      for (const id of createdIds) previewStore.delete(id);
      resetPreviewCreateRateLimitForTests();
    }
  },
});
