// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import { CONFIG_HEALTH_ENGINE_VERSION } from '$shared/health/index.ts';
import {
  CONFIG_HEALTH_RECOMPUTE_RATE_LIMIT_MAX_REQUESTS,
  registerConfigHealthRecomputeAttempt,
  resetConfigHealthRecomputeRateLimitForTests,
} from '$lib/server/health/recomputeLimits.ts';
import type {
  ConfigHealthSettingsResponse,
  ConfigHealthSummaryResponse,
} from '$lib/server/health/responses.ts';
import { GET as GET_SUMMARY } from '../../routes/api/v1/config-health/summary/+server.ts';
import { GET as GET_DETAIL } from '../../routes/api/v1/config-health/[instanceId]/+server.ts';
import { POST as POST_RECOMPUTE } from '../../routes/api/v1/config-health/[instanceId]/recompute/+server.ts';
import { GET as GET_SETTINGS, PUT as PUT_SETTINGS } from '../../routes/api/v1/config-health/settings/+server.ts';

type SummaryGetEvent = Parameters<typeof GET_SUMMARY>[0];
type DetailGetEvent = Parameters<typeof GET_DETAIL>[0];
type RecomputeEvent = Parameters<typeof POST_RECOMPUTE>[0];
type SettingsGetEvent = Parameters<typeof GET_SETTINGS>[0];
type SettingsPutEvent = Parameters<typeof PUT_SETTINGS>[0];

type ErrorResponse = { error: string };

/**
 * Mirrors syncHistory.test.ts: point the db singleton at a scratch SQLite file under a fresh temp
 * base path, run the full migration chain (so config_health + job queue tables exist in real
 * context), invoke the body, then tear down. The dispatcher is stopped in finally because the
 * settings PUT path reschedules the snapshot/cleanup jobs (which poke the dispatcher).
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/config-health-route-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);

      try {
        await db.initialize();
        await runMigrations();
        // The recompute limiter is a module-global keyed by instance id; reset it so an exhausted
        // window from one test cannot leak into another that reuses a low instance id.
        resetConfigHealthRecomputeRateLimitForTests();
        await fn();
      } finally {
        resetConfigHealthRecomputeRateLimitForTests();
        jobDispatcher.stop();
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

function summaryEvent(): SummaryGetEvent {
  return {} as unknown as SummaryGetEvent;
}

function detailEvent(instanceId: string): DetailGetEvent {
  return { params: { instanceId } } as unknown as DetailGetEvent;
}

function recomputeEvent(instanceId: string): RecomputeEvent {
  return { params: { instanceId } } as unknown as RecomputeEvent;
}

/** Seed an arr instance so the recompute route can pass the existence / sync-capable / enabled gates. */
function seedInstance(type: string, enabled = true): number {
  return arrInstancesQueries.create({
    name: `${type}-${crypto.randomUUID()}`,
    type,
    url: 'http://127.0.0.1:9',
    apiKey: 'test-api-key',
    enabled,
  });
}

function settingsGetEvent(): SettingsGetEvent {
  return {} as unknown as SettingsGetEvent;
}

function settingsPutEvent(body: unknown): SettingsPutEvent {
  const request = new Request('http://localhost/api/v1/config-health/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { request } as unknown as SettingsPutEvent;
}

// ============================================================================
// SUMMARY -- GET /config-health/summary
// ============================================================================

migratedTest('GET /config-health/summary: 200 with engine version, empty instances, and zeroed totals', async () => {
  const response = await GET_SUMMARY(summaryEvent());
  assertEquals(response.status, 200);

  const body = (await response.json()) as ConfigHealthSummaryResponse;
  assertEquals(body.engineVersion, CONFIG_HEALTH_ENGINE_VERSION);
  assertEquals(body.instances, []);
  assertEquals(body.totals.instances, 0);
  assertEquals(body.totals.healthy, 0);
  assertEquals(body.totals.averageScore, null);
  assertEquals(typeof body.settings.enabled, 'boolean');
  assert(typeof body.generatedAt === 'string' && body.generatedAt.length > 0);
});

// ============================================================================
// DETAIL -- GET /config-health/{instanceId}
// ============================================================================

migratedTest('GET /config-health/{instanceId}: non-numeric id returns 400', async () => {
  const response = await GET_DETAIL(detailEvent('abc'));
  assertEquals(response.status, 400);
  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});

migratedTest('GET /config-health/{instanceId}: zero id returns 400', async () => {
  const response = await GET_DETAIL(detailEvent('0'));
  assertEquals(response.status, 400);
});

migratedTest('GET /config-health/{instanceId}: unknown numeric id returns 404', async () => {
  const response = await GET_DETAIL(detailEvent('999999'));
  assertEquals(response.status, 404);
  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});

// ============================================================================
// RECOMPUTE -- POST /config-health/{instanceId}/recompute
// ============================================================================

migratedTest('POST /config-health/{instanceId}/recompute: non-numeric id returns 400', async () => {
  const response = await POST_RECOMPUTE(recomputeEvent('abc'));
  assertEquals(response.status, 400);
  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});

migratedTest('POST /config-health/{instanceId}/recompute: unknown numeric id returns 404', async () => {
  const response = await POST_RECOMPUTE(recomputeEvent('999999'));
  assertEquals(response.status, 404);
});

migratedTest('POST /config-health/{instanceId}/recompute: not sync-capable instance returns 404', async () => {
  const id = seedInstance('prowlarr');
  const response = await POST_RECOMPUTE(recomputeEvent(String(id)));
  assertEquals(response.status, 404);
});

migratedTest('POST /config-health/{instanceId}/recompute: disabled instance returns 400', async () => {
  const id = seedInstance('radarr', false);
  const response = await POST_RECOMPUTE(recomputeEvent(String(id)));
  assertEquals(response.status, 400);
  const body = (await response.json()) as ErrorResponse;
  assert(body.error.toLowerCase().includes('disabled'));
});

migratedTest('POST /config-health/{instanceId}/recompute: rate-limited request returns 429 with Retry-After', async () => {
  const id = seedInstance('radarr');
  // Exhaust the per-instance window directly so the route rejects at the limiter, before any scoring.
  const now = Date.now();
  for (let i = 0; i < CONFIG_HEALTH_RECOMPUTE_RATE_LIMIT_MAX_REQUESTS; i++) {
    registerConfigHealthRecomputeAttempt(id, now);
  }
  const response = await POST_RECOMPUTE(recomputeEvent(String(id)));
  assertEquals(response.status, 429);
  assertEquals(response.headers.get('Retry-After'), '60');
});

// ============================================================================
// SETTINGS -- GET + PUT /config-health/settings
// ============================================================================

migratedTest('GET /config-health/settings: 200 with criteria, catalog, and engine version', async () => {
  const response = await GET_SETTINGS(settingsGetEvent());
  assertEquals(response.status, 200);

  const body = (await response.json()) as ConfigHealthSettingsResponse;
  assertEquals(body.engineVersion, CONFIG_HEALTH_ENGINE_VERSION);
  assertEquals(body.criteria.length, 5);
  assertEquals(body.catalog.length, 5);
  assertEquals(typeof body.enabled, 'boolean');
  assertEquals(body.intervalMinutes, 360);
});

migratedTest('PUT /config-health/settings: engine version mismatch returns 409', async () => {
  const response = await PUT_SETTINGS(settingsPutEvent({ expectedEngineVersion: '999', intervalMinutes: 120 }));
  assertEquals(response.status, 409);
  const body = (await response.json()) as ErrorResponse;
  assert(body.error.includes('version'));
});

migratedTest('PUT /config-health/settings: valid version + intervalMinutes updates and returns 200', async () => {
  // The update reschedules the snapshot/cleanup jobs, which poke the dispatcher; stub the wake so
  // no real timer fires under test.
  const originalNotify = jobDispatcher.notifyJobEnqueued;
  jobDispatcher.notifyJobEnqueued = () => {};

  try {
    const response = await PUT_SETTINGS(
      settingsPutEvent({ expectedEngineVersion: CONFIG_HEALTH_ENGINE_VERSION, intervalMinutes: 120 })
    );
    assertEquals(response.status, 200);

    const body = (await response.json()) as ConfigHealthSettingsResponse;
    assertEquals(body.intervalMinutes, 120);
    assertEquals(body.engineVersion, CONFIG_HEALTH_ENGINE_VERSION);
  } finally {
    jobDispatcher.notifyJobEnqueued = originalNotify;
  }
});
