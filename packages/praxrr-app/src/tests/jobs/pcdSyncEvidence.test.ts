import { assert, assertEquals, assertExists, assertStringIncludes } from '@std/assert';
import { type DatabaseInstance, databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';
import type { JobHandler, JobQueueRecord, JobSource } from '$jobs/queueTypes.ts';
import { logger } from '$logger/logger.ts';
import { pcdManager } from '$pcd/index.ts';
import type { SyncResult } from '$pcd/core/types.ts';
import type { UpdateInfo } from '$utils/git/index.ts';

// Side-effect import registers the 'pcd.sync' handler in the queue registry.
import '$jobs/handlers/pcdSync.ts';

// ============================================================================
// Safe durable evidence for pcd.sync (issue #237, AC #5).
//
// The handler is mock-only: its collaborators (databaseInstancesQueries and the
// pcdManager) are objects whose methods we swap in place, so no DB or real Git is
// touched. Each branch asserts the discriminated JobHandlerResult — a `failure`
// carries a typed `failureCode` and NEVER a raw error string, so git-token /
// api-key text can never leak into the durable run record.
// ============================================================================

type Restore = () => void;

/** Swap one method on an object, remembering how to restore it. Mirrors trashGuideSyncJob.test.ts. */
function patchTarget<T extends object, K extends keyof T>(
  target: T,
  key: K,
  replacement: T[K],
  restores: Restore[]
): void {
  const original = target[key];
  target[key] = replacement;
  restores.push(() => {
    target[key] = original;
  });
}

function getHandler(): JobHandler {
  const handler = jobQueueRegistry.get('pcd.sync');
  assertExists(handler, 'pcd.sync handler should be registered');
  return handler;
}

/** Build a `pcd.sync` job record. Defaults to a manual trigger; flip `source` for the auto path. */
function createSyncJob(
  overrides: { id?: number; payload?: Record<string, unknown>; source?: JobSource } = {}
): JobQueueRecord {
  const now = '2026-07-10T00:00:00.000Z';
  return {
    id: overrides.id ?? 2100,
    jobType: 'pcd.sync',
    status: 'running',
    runAt: now,
    payload: (overrides.payload ?? {}) as JobQueueRecord['payload'],
    source: overrides.source ?? 'manual',
    dedupeKey: null,
    cooldownUntil: null,
    attempts: 1,
    startedAt: now,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Minimal DatabaseInstance shaped exactly as `databaseInstancesQueries.getById` returns. */
function createInstance(overrides: Partial<DatabaseInstance> = {}): DatabaseInstance {
  return {
    id: 501,
    uuid: 'db-uuid-501',
    name: 'Praxrr-DB',
    repository_url: 'https://github.com/o/r.git',
    local_path: '/tmp/praxrr-db-501',
    sync_strategy: 60,
    auto_pull: 1,
    enabled: 1,
    personal_access_token: null,
    is_private: 0,
    local_ops_enabled: 1,
    git_user_name: null,
    git_user_email: null,
    conflict_strategy: 'ask',
    last_synced_at: null,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function createUpdateInfo(overrides: Partial<UpdateInfo> = {}): UpdateInfo {
  return {
    hasUpdates: false,
    commitsBehind: 0,
    commitsAhead: 0,
    latestRemoteCommit: 'remote-commit',
    currentLocalCommit: 'local-commit',
    ...overrides,
  };
}

function createSyncResult(overrides: Partial<SyncResult> = {}): SyncResult {
  return { success: true, commitsBehind: 0, ...overrides };
}

/** Point `getById` at a fixture (or `undefined`) for the duration of a test. */
function stubGetById(instance: DatabaseInstance | undefined, restores: Restore[]): void {
  patchTarget(
    databaseInstancesQueries,
    'getById',
    ((_id: number) => instance) as typeof databaseInstancesQueries.getById,
    restores
  );
}

/** Silence the sanitized logger so failure branches don't depend on log storage. */
function stubLogger(restores: Restore[]): void {
  patchTarget(logger, 'error', (() => Promise.resolve()) as typeof logger.error, restores);
}

// ============================================================================
// Registration
// ============================================================================

Deno.test('pcd.sync handler is registered in the queue registry', () => {
  assertExists(jobQueueRegistry.get('pcd.sync'), 'pcd.sync handler should be registered');
});

// ============================================================================
// invalidPayload — a non-finite databaseId fails before any collaborator runs
// ============================================================================

Deno.test('pcd.sync fails with invalidPayload when databaseId is missing', async () => {
  const restores: Restore[] = [];
  try {
    const result = await getHandler()(createSyncJob({ payload: {}, source: 'manual' }));

    assertEquals(result.status, 'failure');
    assert(result.status === 'failure');
    assertEquals(result.failureCode, 'invalidPayload');
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

// ============================================================================
// cancelled — disabled instance / auto-sync off (decision, not output)
// ============================================================================

Deno.test('pcd.sync cancels with a "disabled" decision when the instance is disabled', async () => {
  const restores: Restore[] = [];
  stubGetById(createInstance({ enabled: 0 }), restores);
  try {
    const result = await getHandler()(createSyncJob({ payload: { databaseId: 501 }, source: 'manual' }));

    assertEquals(result.status, 'cancelled');
    assertExists(result.decision);
    assertStringIncludes(result.decision, 'disabled');
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('pcd.sync cancels with an "Auto-sync disabled" decision on the scheduled path', async () => {
  const restores: Restore[] = [];
  // Enabled, but sync_strategy <= 0 means auto-sync is off; only a manual run may override.
  stubGetById(createInstance({ enabled: 1, sync_strategy: 0 }), restores);
  try {
    const result = await getHandler()(createSyncJob({ payload: { databaseId: 501 }, source: 'schedule' }));

    assertEquals(result.status, 'cancelled');
    assertExists(result.decision);
    assertStringIncludes(result.decision, 'Auto-sync disabled');
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

// ============================================================================
// skipped — scheduled run, no updates available (decision)
// ============================================================================

Deno.test('pcd.sync skips with "No updates available" when checkForUpdates reports none', async () => {
  const restores: Restore[] = [];
  // last_synced_at null so the due gate is bypassed and checkForUpdates is reached.
  stubGetById(createInstance({ enabled: 1, sync_strategy: 60, last_synced_at: null }), restores);
  patchTarget(
    pcdManager,
    'checkForUpdates',
    (() => Promise.resolve(createUpdateInfo({ hasUpdates: false }))) as typeof pcdManager.checkForUpdates,
    restores
  );
  patchTarget(
    databaseInstancesQueries,
    'updateSyncedAt',
    ((_id: number) => true) as typeof databaseInstancesQueries.updateSyncedAt,
    restores
  );
  try {
    const result = await getHandler()(createSyncJob({ payload: { databaseId: 501 }, source: 'schedule' }));

    assertEquals(result.status, 'skipped');
    assertExists(result.decision);
    assertStringIncludes(result.decision, 'No updates available');
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

// ============================================================================
// success — manual pull reports the count on `output`
// ============================================================================

Deno.test('pcd.sync succeeds and summarizes "Pulled N update(s)" on a manual pull', async () => {
  const restores: Restore[] = [];
  stubGetById(createInstance({ enabled: 1 }), restores);
  patchTarget(
    pcdManager,
    'sync',
    (() => Promise.resolve(createSyncResult({ success: true, commitsBehind: 3 }))) as typeof pcdManager.sync,
    restores
  );
  try {
    const result = await getHandler()(createSyncJob({ payload: { databaseId: 501 }, source: 'manual' }));

    assertEquals(result.status, 'success');
    assertExists(result.output);
    assertStringIncludes(result.output, 'Pulled 3');
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

// ============================================================================
// failure — gitNetwork; the git-token URL must NOT leak into the result
// ============================================================================

Deno.test('pcd.sync fails with gitNetwork and never leaks the git-token URL from a failed sync', async () => {
  const restores: Restore[] = [];
  const secretUrl = 'https://x-access-token:ghp_SECRET0123456789@github.com/o/r.git git pull failed';
  stubGetById(createInstance({ enabled: 1 }), restores);
  stubLogger(restores);
  patchTarget(
    pcdManager,
    'sync',
    (() => Promise.resolve(createSyncResult({ success: false, error: secretUrl }))) as typeof pcdManager.sync,
    restores
  );
  try {
    const result = await getHandler()(createSyncJob({ payload: { databaseId: 501 }, source: 'manual' }));

    assertEquals(result.status, 'failure');
    assert(result.status === 'failure');
    assertEquals(result.failureCode, 'gitNetwork');

    const serialized = JSON.stringify(result);
    assert(!serialized.includes('ghp_SECRET0123456789'), 'git token must not leak into the result');
    assert(!serialized.includes('x-access-token'), 'git-token URL must not leak into the result');
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('pcd.sync fails with gitNetwork and never leaks a thrown secret token', async () => {
  const restores: Restore[] = [];
  const secretToken = 'sk-ABCDEFGHIJKLMNOPQRSTUVWX';
  stubGetById(createInstance({ enabled: 1 }), restores);
  stubLogger(restores);
  patchTarget(pcdManager, 'sync', (() => Promise.reject(new Error(secretToken))) as typeof pcdManager.sync, restores);
  try {
    const result = await getHandler()(createSyncJob({ payload: { databaseId: 501 }, source: 'manual' }));

    assertEquals(result.status, 'failure');
    assert(result.status === 'failure');
    assertEquals(result.failureCode, 'gitNetwork');
    assert(!JSON.stringify(result).includes(secretToken), 'thrown token must not leak into the result');
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});
