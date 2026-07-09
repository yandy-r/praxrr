// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { canaryRolloutQueries } from '$db/queries/canaryRollouts.ts';
import { canarySettingsQueries } from '$db/queries/canarySettings.ts';
import { newStateToken } from '$sync/canary/token.ts';
import type { CanaryArrType, CanaryRolloutDetail, CanarySettings, CanaryStartResult } from '$sync/canary/types.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import { GET as GET_LIST, POST as POST_START } from '../../routes/api/v1/canary/rollouts/+server.ts';
import { GET as GET_DETAIL } from '../../routes/api/v1/canary/rollouts/[id]/+server.ts';
import { POST as POST_PROCEED } from '../../routes/api/v1/canary/rollouts/[id]/proceed/+server.ts';
import { POST as POST_ABORT } from '../../routes/api/v1/canary/rollouts/[id]/abort/+server.ts';
import { GET as GET_SETTINGS, PATCH as PATCH_SETTINGS } from '../../routes/api/v1/canary/settings/+server.ts';

type StartPostEvent = Parameters<typeof POST_START>[0];
type ListGetEvent = Parameters<typeof GET_LIST>[0];
type DetailGetEvent = Parameters<typeof GET_DETAIL>[0];
type ProceedPostEvent = Parameters<typeof POST_PROCEED>[0];
type AbortPostEvent = Parameters<typeof POST_ABORT>[0];
type SettingsGetEvent = Parameters<typeof GET_SETTINGS>[0];
type SettingsPatchEvent = Parameters<typeof PATCH_SETTINGS>[0];

type ErrorResponse = { error: string };

/** Paginated envelope returned by GET /canary/rollouts (mirrors the route's local shape). */
interface CanaryRolloutListResponse {
  items: { id: number; arrType: CanaryArrType; status: string }[];
  page: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
  hasNext: boolean;
}

// ============================================================================
// DB BOOTSTRAP -- mirrors tests/routes/syncHistory.test.ts: point the db singleton
// at a scratch SQLite file under a fresh temp base path, run the full migration
// chain (so migration 20260714 creates the canary tables + settings singleton in
// their real context, and 20260710 provides the sync_history tables the canary
// classification read touches), invoke the body, then tear the connection down.
// The dispatcher is stopped in finally so the proceed path (which enqueues the
// rollout job and pokes the dispatcher) never leaks a timer across tests.
// ============================================================================

function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/canary-route-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);

      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        jobDispatcher.stop();
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

/**
 * Insert an enabled arr_instances row (unique name to dodge case-insensitive
 * uniqueness) so canary selection and FK targets resolve. Type is explicit per Arr
 * — a Radarr cohort never pulls a Sonarr instance (no sibling fallback).
 */
function createInstance(type: CanaryArrType): number {
  return arrInstancesQueries.create({
    name: `${type} ${crypto.randomUUID()}`,
    type,
    url: 'http://127.0.0.1:9',
    apiKey: 'test-api-key',
  });
}

/**
 * Seed a rollout parked at the verification gate (`awaiting_confirmation`) holding
 * `token` as its live `state_token`. Two enabled instances of one `arr_type` model
 * the canary + a single remaining target. Returns the rollout id.
 */
function seedAwaitingRollout(token: string): number {
  const arrType: CanaryArrType = 'radarr';
  const canaryId = createInstance(arrType);
  const remainingId = createInstance(arrType);

  const id = canaryRolloutQueries.insert({
    arrType,
    canaryInstanceId: canaryId,
    canaryInstanceName: 'canary',
    sections: null,
    maxBatchSize: 1,
    partialPolicy: 'gate',
    remainingTargets: [{ instanceId: remainingId, instanceName: 'remaining' }],
    trigger: 'manual',
    startedAt: new Date().toISOString(),
    stateToken: newStateToken(),
  });

  canaryRolloutQueries.recordCanaryOutcome(id, {
    status: 'awaiting_confirmation',
    canaryStatus: 'success',
    canaryOutput: 'ok',
    canaryError: null,
    canarySyncHistoryId: null,
    nextToken: token,
    finishedAt: null,
  });

  return id;
}

/** Seed a rollout still in `canary_running` (never gated) to exercise wrong-state guards. */
function seedRunningRollout(): number {
  return canaryRolloutQueries.insert({
    arrType: 'radarr',
    canaryInstanceId: createInstance('radarr'),
    canaryInstanceName: 'canary',
    sections: null,
    maxBatchSize: 1,
    partialPolicy: 'gate',
    remainingTargets: [{ instanceId: createInstance('radarr'), instanceName: 'remaining' }],
    trigger: 'manual',
    startedAt: new Date().toISOString(),
    stateToken: newStateToken(),
  });
}

function startEvent(body: unknown): StartPostEvent {
  const request = new Request('http://localhost/api/v1/canary/rollouts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { request } as unknown as StartPostEvent;
}

function listEvent(query = ''): ListGetEvent {
  const url = new URL(`http://localhost/api/v1/canary/rollouts${query ? `?${query}` : ''}`);
  return { url } as unknown as ListGetEvent;
}

function detailEvent(id: string): DetailGetEvent {
  return { params: { id } } as unknown as DetailGetEvent;
}

function proceedEvent(id: string, body: unknown): ProceedPostEvent {
  const request = new Request(`http://localhost/api/v1/canary/rollouts/${id}/proceed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { params: { id }, request } as unknown as ProceedPostEvent;
}

function abortEvent(id: string, body: unknown): AbortPostEvent {
  const request = new Request(`http://localhost/api/v1/canary/rollouts/${id}/abort`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { params: { id }, request } as unknown as AbortPostEvent;
}

function settingsGetEvent(): SettingsGetEvent {
  return {} as unknown as SettingsGetEvent;
}

function settingsPatchEvent(rawBody: string): SettingsPatchEvent {
  const request = new Request('http://localhost/api/v1/canary/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: rawBody,
  });
  return { request } as unknown as SettingsPatchEvent;
}

// ============================================================================
// START ENDPOINT -- POST /canary/rollouts (both CanaryStartResult union arms)
// ============================================================================

migratedTest('POST /canary/rollouts: single eligible target auto-skips (skipped:true arm)', async () => {
  // Exactly one enabled radarr instance => remaining cohort is empty => the coordinator
  // skips the staged flow and returns the plain sync result. The inline canary sync runs
  // against a dead port / unreadable credentials and resolves without a network round-trip.
  createInstance('radarr');

  const response = await POST_START(startEvent({ arrType: 'radarr' }));
  assertEquals(response.status, 200);

  const body = (await response.json()) as CanaryStartResult;
  assert(body.skipped === true, 'a single-eligible-target rollout must auto-skip');
  assertEquals(typeof body.result.status, 'string');

  // No rollout row is persisted on the auto-skip path.
  const total = db.queryFirst<{ total: number }>('SELECT COUNT(*) AS total FROM canary_rollouts')?.total ?? -1;
  assertEquals(total, 0);
});

migratedTest('POST /canary/rollouts: multiple targets halt at the gate (skipped:false arm)', async () => {
  // Two enabled radarr instances => a non-empty remaining cohort => the coordinator persists
  // a rollout and returns the gate arm ({ rollout, remainingPreview }). A Sonarr instance is
  // present to prove the cohort stays scoped to the requested arr_type (no sibling pull-in).
  createInstance('radarr');
  createInstance('radarr');
  createInstance('sonarr');

  const response = await POST_START(startEvent({ arrType: 'radarr' }));
  assertEquals(response.status, 200);

  const body = (await response.json()) as CanaryStartResult;
  assert(body.skipped === false, 'a multi-target rollout must return the gate arm');
  assertEquals(body.rollout.arrType, 'radarr');
  assert(body.rollout.id > 0);
  assertEquals(typeof body.rollout.status, 'string');
  assert(Array.isArray(body.remainingPreview));

  // The persisted rollout is scoped to radarr only.
  const detail = canaryRolloutQueries.getById(body.rollout.id);
  assertExists(detail);
  assertEquals(detail.arrType, 'radarr');
});

migratedTest('POST /canary/rollouts: invalid arrType returns 400 with { error }', async () => {
  const response = await POST_START(startEvent({ arrType: 'chaptarr' }));
  assertEquals(response.status, 400);
  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});

migratedTest('POST /canary/rollouts: no eligible canary returns 422 with { error }', async () => {
  // No enabled radarr instances exist => the canary is unresolvable => coordinator throws
  // CanaryUnresolvedError which the route maps to 422.
  const response = await POST_START(startEvent({ arrType: 'radarr' }));
  assertEquals(response.status, 422);
  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});

migratedTest('POST /canary/rollouts: explicit canaryInstanceId that does not exist returns 404', async () => {
  // An explicit canary referencing a non-existent instance is a missing resource (404),
  // distinct from an unresolvable-by-heuristic canary (422) — matching the documented contract.
  const response = await POST_START(startEvent({ arrType: 'radarr', canaryInstanceId: 999999 }));
  assertEquals(response.status, 404);
  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});

// ============================================================================
// LIST ENDPOINT -- GET /canary/rollouts
// ============================================================================

migratedTest('GET /canary/rollouts: paginates recent rollouts newest-first', async () => {
  seedAwaitingRollout(newStateToken());
  seedRunningRollout();

  const response = await GET_LIST(listEvent('page=1&pageSize=10'));
  assertEquals(response.status, 200);

  const body = (await response.json()) as CanaryRolloutListResponse;
  assertEquals(body.totalRecords, 2);
  assertEquals(body.items.length, 2);
  assertEquals(body.page, 1);
  assertEquals(body.pageSize, 10);
  assert(body.items.every((item) => item.arrType === 'radarr'));
});

migratedTest('GET /canary/rollouts: non-numeric page returns 400 with { error }', async () => {
  const response = await GET_LIST(listEvent('page=abc'));
  assertEquals(response.status, 400);
  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});

// ============================================================================
// DETAIL ENDPOINT -- GET /canary/rollouts/{id}
// ============================================================================

migratedTest('GET /canary/rollouts/{id}: 200 returns detail including the live stateToken', async () => {
  const token = newStateToken();
  const id = seedAwaitingRollout(token);

  const response = await GET_DETAIL(detailEvent(String(id)));
  assertEquals(response.status, 200);

  const body = (await response.json()) as CanaryRolloutDetail;
  assertEquals(body.id, id);
  assertEquals(body.arrType, 'radarr');
  assertEquals(body.status, 'awaiting_confirmation');
  assertEquals(body.stateToken, token);
  assertEquals(body.remainingTargets.length, 1);
});

migratedTest('GET /canary/rollouts/{id}: unknown id returns 404 with { error }', async () => {
  const response = await GET_DETAIL(detailEvent('999999'));
  assertEquals(response.status, 404);
  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});

migratedTest('GET /canary/rollouts/{id}: non-numeric id returns 400 with { error }', async () => {
  const response = await GET_DETAIL(detailEvent('abc'));
  assertEquals(response.status, 400);
  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});

// ============================================================================
// PROCEED ENDPOINT -- POST /canary/rollouts/{id}/proceed
// ============================================================================

migratedTest('POST /canary/rollouts/{id}/proceed: correct token enqueues the rollout job', async () => {
  // proceedRollout enqueues the resumable rollout job and pokes the dispatcher; stub the
  // wake so the runAt=now timer never fires an actual run under test.
  const originalNotify = jobDispatcher.notifyJobEnqueued;
  jobDispatcher.notifyJobEnqueued = () => {};

  try {
    const token = newStateToken();
    const id = seedAwaitingRollout(token);

    const response = await POST_PROCEED(proceedEvent(String(id), { stateToken: token }));
    assertEquals(response.status, 200);

    const body = (await response.json()) as CanaryRolloutDetail;
    assertEquals(body.id, id);
    assertEquals(body.status, 'rolling_out');

    // A single rollout job was enqueued for exactly this rollout id.
    const enqueued =
      db.queryFirst<{ total: number }>("SELECT COUNT(*) AS total FROM job_queue WHERE job_type = 'sync.canary.rollout'")
        ?.total ?? 0;
    assertEquals(enqueued, 1);
  } finally {
    jobDispatcher.notifyJobEnqueued = originalNotify;
  }
});

migratedTest('POST /canary/rollouts/{id}/proceed: wrong-state rollout returns 409', async () => {
  const id = seedRunningRollout();

  const response = await POST_PROCEED(proceedEvent(String(id), { stateToken: newStateToken() }));
  assertEquals(response.status, 409);
  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);

  // The wrong-state rejection did not enqueue anything.
  const enqueued =
    db.queryFirst<{ total: number }>("SELECT COUNT(*) AS total FROM job_queue WHERE job_type = 'sync.canary.rollout'")
      ?.total ?? 0;
  assertEquals(enqueued, 0);
});

migratedTest('POST /canary/rollouts/{id}/proceed: stale token returns 422', async () => {
  const id = seedAwaitingRollout(newStateToken());

  const response = await POST_PROCEED(proceedEvent(String(id), { stateToken: 'stale-token' }));
  assertEquals(response.status, 422);
  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});

migratedTest('POST /canary/rollouts/{id}/proceed: missing stateToken returns 400', async () => {
  const id = seedAwaitingRollout(newStateToken());

  const response = await POST_PROCEED(proceedEvent(String(id), {}));
  assertEquals(response.status, 400);
  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});

// ============================================================================
// ABORT ENDPOINT -- POST /canary/rollouts/{id}/abort
// ============================================================================

migratedTest('POST /canary/rollouts/{id}/abort: correct token aborts the gate', async () => {
  const token = newStateToken();
  const id = seedAwaitingRollout(token);

  const response = await POST_ABORT(abortEvent(String(id), { stateToken: token }));
  assertEquals(response.status, 200);

  const body = (await response.json()) as CanaryRolloutDetail;
  assertEquals(body.id, id);
  assertEquals(body.status, 'aborted');
  assertExists(body.finishedAt);
});

migratedTest('POST /canary/rollouts/{id}/abort: stale token returns 422', async () => {
  const id = seedAwaitingRollout(newStateToken());

  const response = await POST_ABORT(abortEvent(String(id), { stateToken: 'stale-token' }));
  assertEquals(response.status, 422);
  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});

migratedTest('POST /canary/rollouts/{id}/abort: wrong-state rollout returns 409', async () => {
  const id = seedRunningRollout();

  const response = await POST_ABORT(abortEvent(String(id), { stateToken: newStateToken() }));
  assertEquals(response.status, 409);
  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});

// ============================================================================
// SETTINGS ENDPOINT -- GET + PATCH /canary/settings
// ============================================================================

migratedTest('GET /canary/settings: 200 returns the seeded singleton shape', async () => {
  const response = await GET_SETTINGS(settingsGetEvent());
  assertEquals(response.status, 200);

  const body = (await response.json()) as CanarySettings;
  assertEquals(typeof body.enabled, 'boolean');
  assertEquals(typeof body.autoSelect, 'boolean');
  assertEquals(body.defaultMaxBatchSize, 1);
  assertEquals(body.defaultPartialPolicy, 'gate');
});

migratedTest('PATCH /canary/settings: valid body updates and returns the fresh settings', async () => {
  const response = await PATCH_SETTINGS(
    settingsPatchEvent(
      JSON.stringify({ enabled: true, autoSelect: false, defaultMaxBatchSize: 3, defaultPartialPolicy: 'abort' })
    )
  );
  assertEquals(response.status, 200);

  const body = (await response.json()) as CanarySettings;
  assertEquals(body.enabled, true);
  assertEquals(body.autoSelect, false);
  assertEquals(body.defaultMaxBatchSize, 3);
  assertEquals(body.defaultPartialPolicy, 'abort');

  // The write persisted to the singleton.
  assertEquals(canarySettingsQueries.get().defaultMaxBatchSize, 3);
});

migratedTest('PATCH /canary/settings: defaultMaxBatchSize=0 returns 400 (not clamped)', async () => {
  const response = await PATCH_SETTINGS(settingsPatchEvent(JSON.stringify({ defaultMaxBatchSize: 0 })));
  assertEquals(response.status, 400);
  const body = (await response.json()) as ErrorResponse;
  assert(body.error.includes('defaultMaxBatchSize'));

  // The rejected patch left the singleton untouched.
  assertEquals(canarySettingsQueries.get().defaultMaxBatchSize, 1);
});

migratedTest('PATCH /canary/settings: non-integer defaultMaxBatchSize returns 400', async () => {
  const response = await PATCH_SETTINGS(settingsPatchEvent(JSON.stringify({ defaultMaxBatchSize: 1.5 })));
  assertEquals(response.status, 400);
  const body = (await response.json()) as ErrorResponse;
  assert(body.error.includes('defaultMaxBatchSize'));
});

migratedTest('PATCH /canary/settings: invalid JSON body returns 400', async () => {
  const response = await PATCH_SETTINGS(settingsPatchEvent('{ not json'));
  assertEquals(response.status, 400);
  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});
