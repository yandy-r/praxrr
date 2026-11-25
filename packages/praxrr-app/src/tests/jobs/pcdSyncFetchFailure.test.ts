/**
 * YAN-1996: a pcd.sync run whose remote fetch fails must fail visibly (never "No updates
 * available"). A credential rejection maps to the `credential` code with a token hint, and the
 * durable evidence never contains the token or the git output.
 */
import { assert, assertEquals, assertExists, assertFalse } from '@std/assert';
import { type DatabaseInstance, databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';
import { buildSafeJobEvidence, classifyJobFailure } from '$jobs/evidence.ts';
import type { JobHandler, JobQueueRecord, JobSource } from '$jobs/queueTypes.ts';
import { logger } from '$logger/logger.ts';
import { pcdManager } from '$pcd/index.ts';
import { GitFetchError } from '$utils/git/errors.ts';

import { PCD_TOKEN_RECOVERY } from '$jobs/handlers/pcdSync.ts';

const TOKEN = 'ghp_PcdSyncFetchFailureToken0987654321';

type Restore = () => void;

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

function createSyncJob(source: JobSource): JobQueueRecord {
  const now = '2026-11-25T00:00:00.000Z';
  return {
    id: 4100,
    jobType: 'pcd.sync',
    status: 'running',
    runAt: now,
    payload: { databaseId: 601 } as JobQueueRecord['payload'],
    source,
    dedupeKey: null,
    cooldownUntil: null,
    attempts: 1,
    startedAt: now,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function createInstance(): DatabaseInstance {
  return {
    id: 601,
    uuid: 'db-uuid-601',
    name: 'Praxrr-DB',
    repository_url: 'https://github.com/o/r.git',
    local_path: '/tmp/praxrr-db-601',
    sync_strategy: 60,
    auto_pull: 1,
    enabled: 1,
    personal_access_token: null,
    is_private: 1,
    local_ops_enabled: 1,
    git_user_name: null,
    git_user_email: null,
    conflict_strategy: 'ask',
    last_synced_at: null,
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
  };
}

function stubCollaborators(restores: Restore[]): { syncedAtUpdates: number[] } {
  const syncedAtUpdates: number[] = [];
  patchTarget(
    databaseInstancesQueries,
    'getById',
    ((_id: number) => createInstance()) as typeof databaseInstancesQueries.getById,
    restores
  );
  patchTarget(
    databaseInstancesQueries,
    'updateSyncedAt',
    ((id: number) => {
      syncedAtUpdates.push(id);
      return true;
    }) as typeof databaseInstancesQueries.updateSyncedAt,
    restores
  );
  patchTarget(logger, 'error', (() => Promise.resolve()) as typeof logger.error, restores);
  return { syncedAtUpdates };
}

function authFailure(): GitFetchError {
  return new GitFetchError('auth', `fatal: Authentication failed for 'https://github.com/o/r.git/' ${TOKEN}`);
}

Deno.test('scheduled pcd.sync fails with a credential code and token hint when the fetch is rejected', async () => {
  const restores: Restore[] = [];
  const { syncedAtUpdates } = stubCollaborators(restores);
  patchTarget(
    pcdManager,
    'checkForUpdates',
    (() => Promise.reject(authFailure())) as typeof pcdManager.checkForUpdates,
    restores
  );
  try {
    const job = createSyncJob('schedule');
    const result = await getHandler()(job);

    assertEquals(result.status, 'failure');
    assert(result.status === 'failure');
    assertEquals(result.failureCode, 'credential');
    assertEquals(result.recovery, PCD_TOKEN_RECOVERY);
    // A failed fetch must not be recorded as a successful "up to date" check.
    assertEquals(syncedAtUpdates, []);

    const evidence = buildSafeJobEvidence(job, result);
    assertEquals(evidence.failure?.code, 'credential');
    assertEquals(evidence.recovery, PCD_TOKEN_RECOVERY);
    assertFalse(JSON.stringify(evidence).includes(TOKEN));
    assertFalse(JSON.stringify(evidence).includes('Authentication failed'));
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('scheduled pcd.sync keeps gitNetwork for a network fetch failure', async () => {
  const restores: Restore[] = [];
  stubCollaborators(restores);
  patchTarget(
    pcdManager,
    'checkForUpdates',
    (() =>
      Promise.reject(
        new GitFetchError('network', 'Could not resolve host: github.com')
      )) as typeof pcdManager.checkForUpdates,
    restores
  );
  try {
    const result = await getHandler()(createSyncJob('schedule'));

    assert(result.status === 'failure');
    assertEquals(result.failureCode, 'gitNetwork');
    assertEquals(result.recovery, undefined);
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('manual pcd.sync maps a rejected fetch reported by sync() to the credential code', async () => {
  const restores: Restore[] = [];
  stubCollaborators(restores);
  patchTarget(
    pcdManager,
    'sync',
    (() =>
      Promise.resolve({
        success: false,
        commitsBehind: 0,
        error: authFailure().message,
        fetchFailureKind: 'auth' as const,
      })) as typeof pcdManager.sync,
    restores
  );
  try {
    const result = await getHandler()(createSyncJob('manual'));

    assert(result.status === 'failure');
    assertEquals(result.failureCode, 'credential');
    assertEquals(result.recovery, PCD_TOKEN_RECOVERY);
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('classifyJobFailure maps GitFetchError by kind', () => {
  assertEquals(classifyJobFailure(new GitFetchError('auth', '')), 'credential');
  assertEquals(classifyJobFailure(new GitFetchError('network', '')), 'gitNetwork');
  assertEquals(classifyJobFailure(new GitFetchError('unknown', '')), 'gitNetwork');
});

Deno.test('GitFetchError message is pre-authored and never echoes git output', () => {
  const error = authFailure();
  assertFalse(error.message.includes(TOKEN));
  assertFalse(error.message.includes('Authentication failed for'));
});
