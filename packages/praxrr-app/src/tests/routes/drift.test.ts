// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { driftStatusQueries } from '$db/queries/driftStatus.ts';
import { checkAndPersistInstance } from '$sync/drift/persist.ts';
import type { DriftEntityChange } from '$sync/drift/types.ts';
import type { DriftDetailResponse, DriftInstanceSummary, DriftSettingsResponse } from '$sync/drift/responses.ts';
import {
  DRIFT_REFRESH_RATE_LIMIT_MAX_REQUESTS,
  registerDriftRefreshAttempt,
  resetDriftRefreshRateLimitForTests,
} from '$sync/drift/limits.ts';
import { resetPreviewCreateRateLimitForTests } from '$sync/preview/limits.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import { GET as GET_SUMMARY } from '../../routes/api/v1/drift/summary/+server.ts';
import { GET as GET_DETAIL, POST as POST_DETAIL } from '../../routes/api/v1/drift/[instanceId]/+server.ts';
import { PUT as PUT_SETTINGS } from '../../routes/api/v1/drift/settings/+server.ts';

type SummaryGetEvent = Parameters<typeof GET_SUMMARY>[0];
type DetailGetEvent = Parameters<typeof GET_DETAIL>[0];
type DetailPostEvent = Parameters<typeof POST_DETAIL>[0];
type SettingsPutEvent = Parameters<typeof PUT_SETTINGS>[0];

type ErrorResponse = { error: string };

interface SummaryResponse {
  generatedAt: string;
  settings: DriftSettingsResponse;
  totals: {
    instances: number;
    inSync: number;
    drifted: number;
    unreachable: number;
    unauthorized: number;
    error: number;
    neverChecked: number;
  };
  instances: DriftInstanceSummary[];
}

// ============================================================================
// DB BOOTSTRAP -- mirrors tests/db/arrInstanceVersion.test.ts: point the db
// singleton at a scratch SQLite file under a fresh temp base path, run the full
// migration chain (so 20260709 drift tables exist in their real context), invoke
// the body, then tear the connection down. The module-global drift + preview rate
// windows are reset up front so IDs reused across fresh DBs never inherit a prior
// test's exhausted window.
// ============================================================================

function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/drift-route-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);

      resetDriftRefreshRateLimitForTests();
      resetPreviewCreateRateLimitForTests();

      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        jobDispatcher.stop();
        db.close();
        config.setBasePath(originalBasePath);
        resetDriftRefreshRateLimitForTests();
        resetPreviewCreateRateLimitForTests();
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

function createInstance(
  overrides: Partial<{ name: string; type: string; url: string; enabled: boolean }> = {}
): number {
  return arrInstancesQueries.create({
    name: overrides.name ?? `Radarr ${crypto.randomUUID()}`,
    type: overrides.type ?? 'radarr',
    url: overrides.url ?? 'http://127.0.0.1:9',
    apiKey: 'test-api-key',
    enabled: overrides.enabled,
  });
}

function driftChange(overrides: Partial<DriftEntityChange> = {}): DriftEntityChange {
  return {
    section: 'qualityProfiles',
    entityType: 'customFormat',
    name: 'Change',
    action: 'update',
    category: 'drift',
    remoteId: null,
    fields: [],
    ...overrides,
  };
}

function summaryEvent(): SummaryGetEvent {
  return {} as unknown as SummaryGetEvent;
}

function detailGetEvent(instanceId: string): DetailGetEvent {
  return { params: { instanceId } } as unknown as DetailGetEvent;
}

function detailPostEvent(instanceId: string): DetailPostEvent {
  return { params: { instanceId } } as unknown as DetailPostEvent;
}

function settingsPutEvent(payload: unknown): SettingsPutEvent {
  const request = new Request('http://localhost/api/v1/drift/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { request } as unknown as SettingsPutEvent;
}

// ============================================================================
// SUMMARY ENDPOINT (design §10)
// ============================================================================

migratedTest(
  'GET /drift/summary: 200 with totals covering a never-checked and a degraded (unreachable) instance',
  async () => {
    const neverCheckedId = createInstance({ name: 'Radarr Never Checked' });
    const unreachableId = createInstance({ name: 'Radarr Unreachable' });

    // Seed a stored degraded row for one instance; the other stays row-less (never-checked).
    await driftStatusQueries.upsert({
      arrInstanceId: unreachableId,
      arrType: 'radarr',
      status: 'unreachable',
      reason: 'timeout',
      driftedCount: 0,
      missingCount: 0,
      unmanagedCount: 0,
      driftSignature: null,
      detectedVersion: null,
      changes: [],
      checkedAt: new Date().toISOString(),
      contentCheckedAt: null,
      durationMs: 12,
    });

    const response = await GET_SUMMARY(summaryEvent());
    assertEquals(response.status, 200);

    const body = (await response.json()) as SummaryResponse;
    assertEquals(body.totals.instances, 2);
    assertEquals(body.totals.neverChecked, 1);
    assertEquals(body.totals.unreachable, 1);
    assert(body.settings !== undefined && typeof body.settings.enabled === 'boolean');

    const neverChecked = body.instances.find((instance) => instance.instanceId === neverCheckedId);
    assert(neverChecked);
    assertEquals(neverChecked.status, 'never-checked');
    assertEquals(neverChecked.counts, { drifted: 0, missing: 0, unmanaged: 0 });
    assertEquals(neverChecked.checkedAt, null);

    const unreachable = body.instances.find((instance) => instance.instanceId === unreachableId);
    assert(unreachable);
    assertEquals(unreachable.status, 'unreachable');
    assertEquals(unreachable.reason, 'timeout');
  }
);

// ============================================================================
// DETAIL ENDPOINT — GET (design §10)
// ============================================================================

migratedTest('GET /drift/{instanceId}: unknown instance returns 404', async () => {
  const response = await GET_DETAIL(detailGetEvent('999999'));
  assertEquals(response.status, 404);

  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});

migratedTest('GET /drift/{instanceId}: unsupported instance type returns 400', async () => {
  const id = createInstance({ name: 'Chaptarr Detail', type: 'chaptarr' });

  const response = await GET_DETAIL(detailGetEvent(String(id)));
  assertEquals(response.status, 400);

  const body = (await response.json()) as ErrorResponse;
  assert(body.error.includes('chaptarr'));
});

migratedTest('GET /drift/{instanceId}: 200 never-checked for a valid but unchecked instance', async () => {
  const id = createInstance({ name: 'Radarr Unchecked Detail' });

  const response = await GET_DETAIL(detailGetEvent(String(id)));
  assertEquals(response.status, 200);

  const body = (await response.json()) as DriftDetailResponse;
  assertEquals(body.instanceId, id);
  assertEquals(body.arrType, 'radarr');
  assertEquals(body.status, 'never-checked');
  assertEquals(body.counts, { drifted: 0, missing: 0, unmanaged: 0 });
  assertEquals(body.drift, []);
  assertEquals(body.missing, []);
  assertEquals(body.unmanaged, []);
});

migratedTest('GET /drift/{instanceId}: 200 groups stored changes into drift / missing / unmanaged', async () => {
  const id = createInstance({ name: 'Radarr Grouped Detail' });

  await driftStatusQueries.upsert({
    arrInstanceId: id,
    arrType: 'radarr',
    status: 'drifted',
    reason: null,
    driftedCount: 1,
    missingCount: 1,
    unmanagedCount: 1,
    driftSignature: 'sig',
    detectedVersion: '5.14.0.9383',
    changes: [
      driftChange({ name: 'Changed CF', action: 'update', category: 'drift', remoteId: 1 }),
      driftChange({ entityType: 'qualityProfile', name: 'Missing QP', action: 'create', category: 'missing' }),
      driftChange({ name: 'Unmanaged CF', action: 'delete', category: 'unmanaged', remoteId: 2 }),
    ],
    checkedAt: new Date().toISOString(),
    contentCheckedAt: new Date().toISOString(),
    durationMs: 42,
  });

  const response = await GET_DETAIL(detailGetEvent(String(id)));
  assertEquals(response.status, 200);

  const body = (await response.json()) as DriftDetailResponse;
  assertEquals(body.status, 'drifted');
  assertEquals(body.counts, { drifted: 1, missing: 1, unmanaged: 1 });
  assertEquals(body.drift.length, 1);
  assertEquals(body.drift[0].name, 'Changed CF');
  assertEquals(body.missing.length, 1);
  assertEquals(body.missing[0].name, 'Missing QP');
  assertEquals(body.unmanaged.length, 1);
  assertEquals(body.unmanaged[0].name, 'Unmanaged CF');
});

// ============================================================================
// DETAIL ENDPOINT — POST refresh (design §10)
// ============================================================================

migratedTest('POST /drift/{instanceId}: unknown instance returns 404', async () => {
  const response = await POST_DETAIL(detailPostEvent('999999'));
  assertEquals(response.status, 404);
});

migratedTest('POST /drift/{instanceId}: unsupported instance type returns 400', async () => {
  const id = createInstance({ name: 'Chaptarr Refresh', type: 'chaptarr' });

  const response = await POST_DETAIL(detailPostEvent(String(id)));
  assertEquals(response.status, 400);

  const body = (await response.json()) as ErrorResponse;
  assert(body.error.includes('chaptarr'));
});

migratedTest('POST /drift/{instanceId}: disabled instance returns 400', async () => {
  const id = createInstance({ name: 'Radarr Disabled Refresh', enabled: false });

  const response = await POST_DETAIL(detailPostEvent(String(id)));
  assertEquals(response.status, 400);

  const body = (await response.json()) as ErrorResponse;
  assert(body.error.toLowerCase().includes('disabled'));
});

migratedTest('POST /drift/{instanceId}: 429 with Retry-After once the per-instance window is exhausted', async () => {
  const id = createInstance({ name: 'Radarr Rate Limited Refresh' });

  const nowMs = Date.now();
  for (let attempt = 0; attempt < DRIFT_REFRESH_RATE_LIMIT_MAX_REQUESTS; attempt++) {
    assertEquals(registerDriftRefreshAttempt(id, nowMs), true);
  }

  const response = await POST_DETAIL(detailPostEvent(String(id)));
  assertEquals(response.status, 429);
  assert(response.headers.get('Retry-After') !== null);
  assertEquals(response.headers.get('Retry-After'), '60');

  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});

migratedTest('POST /drift/{instanceId}: 200 running a live check against an unreachable instance', async () => {
  // No credential row is persisted, so the heartbeat client build fails fast and the
  // live check resolves to `unreachable` without any network round-trip; the URL also
  // points at a dead port as a belt-and-suspenders guard.
  const id = createInstance({ name: 'Radarr Live Refresh', url: 'http://127.0.0.1:9' });

  const response = await POST_DETAIL(detailPostEvent(String(id)));
  assertEquals(response.status, 200);

  const body = (await response.json()) as DriftDetailResponse;
  assertEquals(body.instanceId, id);
  assertEquals(body.arrType, 'radarr');
  assertEquals(body.status, 'unreachable');

  // The check persisted a row, so a follow-up GET reflects the same degraded status.
  const detail = await GET_DETAIL(detailGetEvent(String(id)));
  assertEquals(detail.status, 200);
  const detailBody = (await detail.json()) as DriftDetailResponse;
  assertEquals(detailBody.status, 'unreachable');
});

migratedTest('POST /drift/{instanceId}: 409 when a check for that instance is already in progress', async () => {
  const id = createInstance({ name: 'Radarr Concurrent Refresh' });
  const instance = arrInstancesQueries.getById(id);
  assertExists(instance);

  // Occupy the module-level in-flight slot for this id by starting a concurrent
  // checkAndPersistInstance whose heartbeat blocks on a gate (mirrors the gated-dep
  // pattern in persist.test.ts). The slot is added synchronously before the first
  // await, so the POST route below observes the id as busy and short-circuits to 409
  // without touching the network.
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const inFlightCall = checkAndPersistInstance(instance, {
    heartbeat: async () => {
      await gate;
      return { ok: false };
    },
  });

  try {
    const response = await POST_DETAIL(detailPostEvent(String(id)));
    assertEquals(response.status, 409);

    const body = (await response.json()) as ErrorResponse;
    assert(body.error.toLowerCase().includes('already in progress'));
  } finally {
    // Release the gate so the background check finishes, clears the in-flight slot,
    // and completes its write before the DB is torn down.
    release();
    const outcome = await inFlightCall;
    assertEquals(outcome.kind, 'ok');
  }
});

// ============================================================================
// SETTINGS ENDPOINT — PUT (design §10)
// ============================================================================

migratedTest('PUT /drift/settings: intervalMinutes below the minimum returns 400', async () => {
  const response = await PUT_SETTINGS(settingsPutEvent({ intervalMinutes: 3 }));
  assertEquals(response.status, 400);

  const body = (await response.json()) as ErrorResponse;
  assert(body.error.includes('intervalMinutes'));
});

migratedTest('PUT /drift/settings: non-boolean enabled returns 400', async () => {
  const response = await PUT_SETTINGS(settingsPutEvent({ enabled: 'yes' }));
  assertEquals(response.status, 400);

  const body = (await response.json()) as ErrorResponse;
  assert(body.error.includes('enabled'));
});

migratedTest('PUT /drift/settings: 200 valid update returns the updated settings', async () => {
  // scheduleDriftCheck() upserts a `drift.check` job and pokes the dispatcher; stub the
  // wake so the (delay=0) timer never fires an actual job run under test.
  const originalNotify = jobDispatcher.notifyJobEnqueued;
  jobDispatcher.notifyJobEnqueued = () => {};

  try {
    const response = await PUT_SETTINGS(settingsPutEvent({ enabled: true, intervalMinutes: 30 }));
    assertEquals(response.status, 200);

    const body = (await response.json()) as DriftSettingsResponse;
    assertEquals(body.enabled, true);
    assertEquals(body.intervalMinutes, 30);
    // enabled=true schedules the recurring job, so nextRunAt projects from the queue.
    assert(typeof body.nextRunAt === 'string' && body.nextRunAt.length > 0);
  } finally {
    jobDispatcher.notifyJobEnqueued = originalNotify;
  }
});
