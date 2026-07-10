import { assert, assertEquals } from '@std/assert';
import { jobQueueRegistry } from '../../lib/server/jobs/queueRegistry.ts';
import { trashGuideSourcesQueries } from '../../lib/server/db/queries/trashGuideSources.ts';
import { logger } from '../../lib/server/utils/logger/logger.ts';
import { trashGuideManager } from '../../lib/server/trashguide/index.ts';
import { buildTrashGuideSyncFailure } from '$jobs/trashguide/syncFailure.ts';
import type { JobHandlerResult, JobQueueRecord, TrashGuideSyncRunEvidence } from '../../lib/server/jobs/queueTypes.ts';

// Register TRaSH sync handler for this test run.
import '../../lib/server/jobs/handlers/trashGuideSync.ts';

// Resolve the handler once via the registry after the side-effect import above.
const handler = jobQueueRegistry.get('trashguide.sync');
if (!handler) {
  throw new Error('Expected trashguide.sync handler to be registered');
}

type Restore = () => void;

interface LoggerCall {
  message: string;
  source: string | undefined;
}

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

function patchLogger(method: 'warn' | 'error', sink: LoggerCall[], restores: Restore[]): void {
  patchTarget(
    logger,
    method,
    ((message: string, options?: { source?: string }) => {
      sink.push({ message, source: options?.source });
      return Promise.resolve();
    }) as typeof logger.warn,
    restores
  );
}

function restoreAll(restores: Restore[]): void {
  for (const restore of restores.reverse()) {
    restore();
  }
}

function makeSource(overrides: Record<string, unknown> = {}) {
  return {
    id: 901,
    name: 'TRaSH Handler Source',
    repository_url: 'https://example.com/handler-source.git',
    branch: 'main',
    local_path: '/tmp/trash-guide-source',
    arr_type: 'radarr',
    score_profile: 'default',
    sync_strategy: 60,
    auto_pull: true,
    enabled: true,
    last_synced_at: null,
    last_commit_hash: null,
    created_at: '2026-02-26T00:00:00.000Z',
    updated_at: '2026-02-26T00:00:00.000Z',
    ...overrides,
  };
}

function updateInfo(hasUpdates: boolean, commitsBehind: number) {
  return {
    hasUpdates,
    commitsBehind,
    commitsAhead: 0,
    latestRemoteCommit: 'remote-commit',
    currentLocalCommit: 'local-commit',
  };
}

interface JobOverrides {
  sourceId?: number;
  trigger?: 'manual' | 'scheduled';
  source?: 'manual' | 'schedule';
  attempts?: number;
}

function buildJob(overrides: JobOverrides = {}): JobQueueRecord {
  const now = '2026-02-26T10:00:00.000Z';
  const trigger = overrides.trigger ?? 'manual';
  return {
    id: 1200,
    jobType: 'trashguide.sync',
    status: 'queued',
    runAt: now,
    payload: {
      sourceId: overrides.sourceId ?? 901,
      trigger,
      requestedAt: now,
      runToken: 'tok-1',
      sourceName: 'Snap',
      sourceArrType: 'radarr',
    },
    source: overrides.source ?? (trigger === 'scheduled' ? 'schedule' : 'manual'),
    dedupeKey: null,
    cooldownUntil: null,
    attempts: overrides.attempts ?? 0,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function parseEvidence(result: JobHandlerResult): TrashGuideSyncRunEvidence {
  return JSON.parse(result.output ?? '') as TrashGuideSyncRunEvidence;
}

Deno.test('trashGuideSync handler maps sync() throw into scheduled transient retry', async () => {
  const restores: Restore[] = [];
  const warnCalls: LoggerCall[] = [];

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() => makeSource()) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  patchTarget(
    trashGuideManager,
    'checkForUpdates',
    (async () => updateInfo(true, 2)) as typeof trashGuideManager.checkForUpdates,
    restores
  );
  patchTarget(
    trashGuideManager,
    'sync',
    (() => {
      throw new Error('git network failure while pulling');
    }) as typeof trashGuideManager.sync,
    restores
  );
  patchLogger('warn', warnCalls, restores);
  patchLogger('error', [], restores);

  try {
    const result = await handler(buildJob({ trigger: 'scheduled', attempts: 1 }));
    const evidence = parseEvidence(result);

    assertEquals(result.status, 'failure');
    assertEquals(evidence.status, 'failure');
    assert(evidence.failure?.code === 'network' || evidence.failure?.code === 'sync_failed');
    assertEquals(result.error, buildTrashGuideSyncFailure(evidence.failure!.code).message);
    assertEquals(evidence.runToken, 'tok-1');
    assertEquals(typeof result.rescheduleAt, 'string');
    assert(warnCalls.length >= 1);
  } finally {
    restoreAll(restores);
  }
});

Deno.test('trashGuideSync handler cancels when the source was deleted', async () => {
  const restores: Restore[] = [];

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() => undefined) as typeof trashGuideSourcesQueries.getById,
    restores
  );

  try {
    const result = await handler(buildJob({ trigger: 'manual' }));
    const evidence = parseEvidence(result);

    assertEquals(result.status, 'cancelled');
    assertEquals(evidence.failure?.code, 'source_missing');
    assertEquals(evidence.source.name, 'Snap');
    assertEquals(evidence.source.arrType, 'radarr');
    assertEquals(evidence.retry.retryable, false);
  } finally {
    restoreAll(restores);
  }
});

Deno.test('trashGuideSync handler cancels when the source is disabled', async () => {
  const restores: Restore[] = [];

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() => makeSource({ enabled: false })) as typeof trashGuideSourcesQueries.getById,
    restores
  );

  try {
    const result = await handler(buildJob({ trigger: 'manual' }));
    const evidence = parseEvidence(result);

    assertEquals(result.status, 'cancelled');
    assertEquals(evidence.failure?.code, 'source_disabled');
    assertEquals(evidence.retry.retryable, false);
  } finally {
    restoreAll(restores);
  }
});

Deno.test('trashGuideSync handler reports parser failures with counts', async () => {
  const restores: Restore[] = [];

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() => makeSource()) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  patchTarget(
    trashGuideManager,
    'checkForUpdates',
    (async () => updateInfo(true, 2)) as typeof trashGuideManager.checkForUpdates,
    restores
  );
  patchTarget(
    trashGuideManager,
    'sync',
    (async () => ({
      success: true,
      parseStatus: 'failed',
      commitsBehind: 2,
      parsedFiles: 5,
      failedFiles: 2,
      activeOperations: 0,
      removedEntities: 0,
      renamedEntities: 0,
    })) as typeof trashGuideManager.sync,
    restores
  );

  try {
    const result = await handler(buildJob({ trigger: 'manual' }));
    const evidence = parseEvidence(result);

    assertEquals(result.status, 'failure');
    assertEquals(evidence.failure?.code, 'parser_failed');
    assertEquals(evidence.counts?.failedFiles, 2);
  } finally {
    restoreAll(restores);
  }
});

Deno.test('trashGuideSync handler schedules a retry for scheduled transient failures', async () => {
  const restores: Restore[] = [];

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() => makeSource({ last_synced_at: null })) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  patchTarget(
    trashGuideManager,
    'checkForUpdates',
    (() => {
      throw new Error('git network failure while pulling');
    }) as typeof trashGuideManager.checkForUpdates,
    restores
  );
  patchLogger('warn', [], restores);
  patchLogger('error', [], restores);

  try {
    const result = await handler(buildJob({ trigger: 'scheduled', source: 'schedule', attempts: 0 }));
    const evidence = parseEvidence(result);

    assertEquals(result.status, 'failure');
    assertEquals(evidence.failure?.code, 'network');
    assertEquals(typeof result.rescheduleAt, 'string');

    const rescheduleMs = Date.parse(result.rescheduleAt as string);
    assert(Number.isFinite(rescheduleMs));
    assert(rescheduleMs > Date.now());
    assert(rescheduleMs <= Date.now() + 16 * 60_000);
  } finally {
    restoreAll(restores);
  }
});

Deno.test('trashGuideSync handler reports a successful sync with full counts', async () => {
  const restores: Restore[] = [];

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() => makeSource()) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  patchTarget(
    trashGuideManager,
    'checkForUpdates',
    (async () => updateInfo(true, 2)) as typeof trashGuideManager.checkForUpdates,
    restores
  );
  patchTarget(
    trashGuideManager,
    'sync',
    (async () => ({
      success: true,
      parseStatus: 'success',
      commitsBehind: 2,
      parsedFiles: 5,
      failedFiles: 0,
      activeOperations: 3,
      removedEntities: 1,
      renamedEntities: 0,
    })) as typeof trashGuideManager.sync,
    restores
  );

  try {
    const result = await handler(buildJob({ trigger: 'manual' }));
    const evidence = parseEvidence(result);

    assertEquals(result.status, 'success');
    assertEquals(evidence.counts?.activeOperations, 3);
    assertEquals(evidence.failure, null);
  } finally {
    restoreAll(restores);
  }
});

Deno.test('trashGuideSync handler never leaks secrets from an unexpected crash', async () => {
  const restores: Restore[] = [];
  const errorCalls: LoggerCall[] = [];
  const secretMessage = 'ghp_secretTOKEN123 https://user:pass@host/repo.git';

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() => makeSource({ auto_pull: false })) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  patchTarget(
    trashGuideManager,
    'checkForUpdates',
    (async () => updateInfo(true, 2)) as typeof trashGuideManager.checkForUpdates,
    restores
  );
  patchTarget(
    trashGuideSourcesQueries,
    'updateSyncMetadata',
    (() => {
      throw new Error(secretMessage);
    }) as typeof trashGuideSourcesQueries.updateSyncMetadata,
    restores
  );
  patchLogger('error', errorCalls, restores);

  try {
    const result = await handler(buildJob({ trigger: 'manual', source: 'manual' }));
    const evidence = parseEvidence(result);

    assertEquals(result.status, 'failure');
    assertEquals(evidence.failure?.code, 'internal');
    assertEquals(result.error, buildTrashGuideSyncFailure('internal').message);

    const output = result.output ?? '';
    const error = result.error ?? '';
    assert(!output.includes('ghp_secretTOKEN123'));
    assert(!output.includes('user:pass'));
    assert(!error.includes('ghp_secretTOKEN123'));
    assert(!error.includes('user:pass'));

    assert(errorCalls.some((call) => call.source === 'TrashGuideSyncJob'));
  } finally {
    restoreAll(restores);
  }
});
