import { assertAlmostEquals, assertEquals, assertExists, assertFalse } from '@std/assert';
import { type CreateJobQueueInput, jobQueueQueries } from '$db/queries/jobQueue.ts';
import { jobRunHistoryQueries } from '$db/queries/jobRunHistory.ts';
import { type TrashGuideSource, trashGuideSourcesQueries } from '$db/queries/trashGuideSources.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import { scheduleTrashGuideSyncJobs } from '$jobs/schedule.ts';
import { scheduleTrashGuideSyncSources } from '$jobs/helpers/trashGuideSchedule.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';
import { calculateNextRunFromMinutes } from '$jobs/scheduleUtils.ts';
import type { JobQueueRecord, JobSource, TrashGuideSyncRunEvidence } from '$jobs/queueTypes.ts';
import { buildTrashGuideSyncFailure } from '$jobs/trashguide/syncFailure.ts';
import { logger } from '$logger/logger.ts';
import { trashGuideManager, type TrashGuideSyncResult } from '$trashguide/index.ts';
import type { UpdateInfo } from '$utils/git/index.ts';

// Register the TRaSH sync handler as an import side effect so jobQueueRegistry.get('trashguide.sync') resolves it.
import '$jobs/handlers/trashGuideSync.ts';

type Restore = () => void;
type TrashGuideSyncJobInput = CreateJobQueueInput<'trashguide.sync'>;

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

function createSourceFixture(
  id: number,
  options: {
    arrType: 'radarr' | 'sonarr';
    enabled?: boolean;
    syncStrategy?: number;
    lastSyncedAt?: string | null;
    autoPull?: boolean;
  }
): TrashGuideSource {
  return {
    id,
    name: `trash-source-${id}`,
    repository_url: `https://example.com/source-${id}.git`,
    branch: 'master',
    local_path: `/tmp/trash-source-${id}`,
    arr_type: options.arrType,
    score_profile: 'default',
    sync_strategy: options.syncStrategy ?? 60,
    auto_pull: options.autoPull ?? true,
    enabled: options.enabled ?? true,
    last_synced_at: options.lastSyncedAt ?? null,
    last_commit_hash: null,
    created_at: '2026-02-25T00:00:00.000Z',
    updated_at: '2026-02-25T00:00:00.000Z',
  };
}

function createScheduledRecord(input: TrashGuideSyncJobInput): JobQueueRecord {
  const now = new Date().toISOString();

  return {
    id: 1,
    jobType: input.jobType,
    status: 'queued',
    runAt: input.runAt,
    payload: (input.payload ?? {}) as JobQueueRecord['payload'],
    source: input.source ?? 'schedule',
    dedupeKey: input.dedupeKey ?? null,
    cooldownUntil: input.cooldownUntil ?? null,
    attempts: 0,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function getSyncHandler() {
  const handler = jobQueueRegistry.get('trashguide.sync');
  if (!handler) {
    throw new Error('Expected trashguide.sync handler to be registered');
  }
  return handler;
}

function createHandlerJob(overrides: {
  id?: number;
  payload: Record<string, unknown>;
  source?: JobSource;
  attempts?: number;
}): JobQueueRecord {
  const timestamp = '2026-03-01T00:00:00.000Z';

  return {
    id: overrides.id ?? 1000,
    jobType: 'trashguide.sync',
    status: 'queued',
    runAt: timestamp,
    payload: overrides.payload as JobQueueRecord['payload'],
    source: overrides.source ?? 'manual',
    dedupeKey: null,
    cooldownUntil: null,
    attempts: overrides.attempts ?? 0,
    startedAt: null,
    finishedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
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

function createSyncResult(overrides: Partial<TrashGuideSyncResult> = {}): TrashGuideSyncResult {
  return {
    success: true,
    commitsBehind: 0,
    parseStatus: 'success',
    parsedFiles: 1,
    failedFiles: 0,
    activeOperations: 0,
    removedEntities: 0,
    renamedEntities: 0,
    ...overrides,
  };
}

// Parses the always-present JSON evidence from a handler result (issue #238: output is JSON.stringify(evidence)).
function parseEvidence(output: string | undefined): TrashGuideSyncRunEvidence {
  assertExists(output, 'expected handler evidence output');
  return JSON.parse(output) as TrashGuideSyncRunEvidence;
}

// Patches trashGuideManager.checkForUpdates with a call counter; the handler must not reach it.
function patchCheckForUpdatesNotCalled(restores: Restore[]): { calls: () => number } {
  let calls = 0;
  patchTarget(
    trashGuideManager,
    'checkForUpdates',
    ((): Promise<UpdateInfo> => {
      calls += 1;
      return Promise.resolve(createUpdateInfo());
    }) as typeof trashGuideManager.checkForUpdates,
    restores
  );
  return { calls: () => calls };
}

Deno.test('scheduleTrashGuideSyncJobs snapshots source identity and reuses stable dedupe keys across runs', () => {
  const restores: Restore[] = [];

  const dedupeKeysFirstRun: string[] = [];
  const dedupeKeysSecondRun: string[] = [];
  const notifiedRunAts: string[] = [];
  let runNumber = 1;

  const sources = [createSourceFixture(41, { arrType: 'radarr' }), createSourceFixture(42, { arrType: 'sonarr' })];

  patchTarget(trashGuideSourcesQueries, 'getAll', () => sources, restores);
  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    ((id: number) => sources.find((source) => source.id === id)) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  patchTarget(jobQueueQueries, 'getByDedupeKey', (() => undefined) as typeof jobQueueQueries.getByDedupeKey, restores);

  patchTarget(
    jobQueueQueries,
    'upsertScheduled',
    ((input: TrashGuideSyncJobInput) => {
      const dedupeKey = input.dedupeKey ?? '';
      const target = runNumber === 1 ? dedupeKeysFirstRun : dedupeKeysSecondRun;
      target.push(dedupeKey);

      assertEquals(input.jobType, 'trashguide.sync');
      assertEquals(input.source, 'schedule');
      assertExists(input.payload);
      const matching = sources.find((source) => source.id === input.payload?.sourceId);
      assertExists(matching);
      assertEquals(input.payload.trigger, 'scheduled');
      assertEquals(typeof input.payload.requestedAt, 'string');
      assertEquals(typeof input.payload.runToken, 'string');
      assertEquals(input.payload.sourceName, matching.name);
      assertEquals(input.payload.sourceArrType, matching.arr_type);

      return createScheduledRecord(input);
    }) as typeof jobQueueQueries.upsertScheduled,
    restores
  );

  patchTarget(
    jobQueueQueries,
    'unscheduleByDedupeKey',
    (() => {
      throw new Error('did not expect unscheduleByDedupeKey for enabled scheduled sources');
    }) as typeof jobQueueQueries.unscheduleByDedupeKey,
    restores
  );

  patchTarget(
    jobDispatcher,
    'notifyJobEnqueued',
    ((runAt: string) => {
      notifiedRunAts.push(runAt);
    }) as typeof jobDispatcher.notifyJobEnqueued,
    restores
  );

  try {
    scheduleTrashGuideSyncJobs();
    runNumber = 2;
    scheduleTrashGuideSyncJobs();

    assertEquals(dedupeKeysFirstRun.sort(), ['trashguide.sync:41', 'trashguide.sync:42']);
    assertEquals(dedupeKeysSecondRun.sort(), ['trashguide.sync:41', 'trashguide.sync:42']);
    assertEquals(notifiedRunAts.length, 4);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('scheduleTrashGuideSyncJobs unschedules disabled and non-scheduled sources', () => {
  const restores: Restore[] = [];

  const unscheduledKeys: string[] = [];
  let enqueueCalls = 0;
  let notifyCalls = 0;

  patchTarget(
    trashGuideSourcesQueries,
    'getAll',
    () => [
      createSourceFixture(71, {
        arrType: 'radarr',
        enabled: false,
        syncStrategy: 60,
      }),
      createSourceFixture(72, {
        arrType: 'sonarr',
        enabled: true,
        syncStrategy: 0,
      }),
    ],
    restores
  );

  patchTarget(
    jobQueueQueries,
    'upsertScheduled',
    ((input: TrashGuideSyncJobInput) => {
      enqueueCalls += 1;
      return createScheduledRecord(input);
    }) as typeof jobQueueQueries.upsertScheduled,
    restores
  );

  patchTarget(
    jobQueueQueries,
    'unscheduleByDedupeKey',
    ((dedupeKey: string) => {
      unscheduledKeys.push(dedupeKey);
    }) as typeof jobQueueQueries.unscheduleByDedupeKey,
    restores
  );

  patchTarget(
    jobDispatcher,
    'notifyJobEnqueued',
    (() => {
      notifyCalls += 1;
    }) as typeof jobDispatcher.notifyJobEnqueued,
    restores
  );

  try {
    scheduleTrashGuideSyncJobs();

    assertEquals(enqueueCalls, 0);
    assertEquals(notifyCalls, 0);
    assertEquals(unscheduledKeys.sort(), ['trashguide.sync:71', 'trashguide.sync:72']);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('scheduleTrashGuideSyncSources preserves a pending queued runToken when the schedule ticks', () => {
  const restores: Restore[] = [];
  const source = createSourceFixture(120, { arrType: 'radarr', syncStrategy: 60, lastSyncedAt: null });
  const capturedPayloads: TrashGuideSyncJobInput['payload'][] = [];

  // A pending manual run already sits in the queue slot carrying its correlation token.
  const queuedSlot = createScheduledRecord({
    jobType: 'trashguide.sync',
    runAt: new Date().toISOString(),
    payload: { sourceId: 120, trigger: 'manual', runToken: 'tok-M' },
    source: 'manual',
    dedupeKey: 'trashguide.sync:120',
  });

  patchTarget(trashGuideSourcesQueries, 'getAll', () => [source], restores);
  patchTarget(trashGuideSourcesQueries, 'getById', (() => source) as typeof trashGuideSourcesQueries.getById, restores);
  patchTarget(jobQueueQueries, 'getByDedupeKey', (() => queuedSlot) as typeof jobQueueQueries.getByDedupeKey, restores);
  patchTarget(jobRunHistoryQueries, 'getByQueueId', (() => []) as typeof jobRunHistoryQueries.getByQueueId, restores);
  patchTarget(
    jobQueueQueries,
    'upsertScheduled',
    ((input: TrashGuideSyncJobInput) => {
      capturedPayloads.push(input.payload);
      return createScheduledRecord(input);
    }) as typeof jobQueueQueries.upsertScheduled,
    restores
  );

  try {
    scheduleTrashGuideSyncSources();

    assertEquals(capturedPayloads.length, 1);
    assertEquals(capturedPayloads[0]?.runToken, 'tok-M');
    assertEquals(capturedPayloads[0]?.trigger, 'scheduled');
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('scheduleTrashGuideSyncSources enqueues an immediate catch-up run for an overdue source', () => {
  const restores: Restore[] = [];
  const source = createSourceFixture(121, {
    arrType: 'sonarr',
    syncStrategy: 60,
    lastSyncedAt: '2020-01-01T00:00:00.000Z',
  });
  const capturedRunAts: string[] = [];

  patchTarget(trashGuideSourcesQueries, 'getAll', () => [source], restores);
  patchTarget(trashGuideSourcesQueries, 'getById', (() => source) as typeof trashGuideSourcesQueries.getById, restores);
  patchTarget(jobQueueQueries, 'getByDedupeKey', (() => undefined) as typeof jobQueueQueries.getByDedupeKey, restores);
  patchTarget(
    jobQueueQueries,
    'upsertScheduled',
    ((input: TrashGuideSyncJobInput) => {
      capturedRunAts.push(input.runAt);
      return createScheduledRecord(input);
    }) as typeof jobQueueQueries.upsertScheduled,
    restores
  );

  try {
    const before = Date.now();
    const runAts = scheduleTrashGuideSyncSources();

    assertEquals(capturedRunAts.length, 1);
    const catchUpDeltaMs = Date.parse(capturedRunAts[0]) - before;
    assertAlmostEquals(catchUpDeltaMs, 0, 2_000);
    assertEquals(runAts, capturedRunAts);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

// Patches logger.warn/logger.error with call counters so retry-classification signals can be asserted
// without touching the real logger sinks (which would otherwise perform file/console writes).
function patchLoggerCounters(restores: Restore[]): { warnCalls: () => number; errorCalls: () => number } {
  let warnCalls = 0;
  let errorCalls = 0;
  patchTarget(
    logger,
    'warn',
    (() => {
      warnCalls += 1;
      return Promise.resolve();
    }) as typeof logger.warn,
    restores
  );
  patchTarget(
    logger,
    'error',
    (() => {
      errorCalls += 1;
      return Promise.resolve();
    }) as typeof logger.error,
    restores
  );
  return { warnCalls: () => warnCalls, errorCalls: () => errorCalls };
}

// Patches trashGuideSourcesQueries.updateSyncMetadata (a real DB write) with a capturing no-op.
function patchUpdateSyncMetadata(restores: Restore[]): {
  calls: () => number;
  lastSourceId: () => number;
  lastInput: () => { lastSyncedAt?: string | null; lastCommitHash?: string | null } | null;
} {
  let calls = 0;
  let lastSourceId = -1;
  let lastInput: { lastSyncedAt?: string | null; lastCommitHash?: string | null } | null = null;
  patchTarget(
    trashGuideSourcesQueries,
    'updateSyncMetadata',
    ((id: number, input: { lastSyncedAt?: string | null; lastCommitHash?: string | null }) => {
      calls += 1;
      lastSourceId = id;
      lastInput = input;
      return true;
    }) as typeof trashGuideSourcesQueries.updateSyncMetadata,
    restores
  );
  return { calls: () => calls, lastSourceId: () => lastSourceId, lastInput: () => lastInput };
}

Deno.test('trashGuideSync handler coerces numeric-string sourceId through parsePayload', async () => {
  const restores: Restore[] = [];
  let requestedId = -1;

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    ((id: number) => {
      requestedId = id;
      return undefined;
    }) as typeof trashGuideSourcesQueries.getById,
    restores
  );

  try {
    const handler = getSyncHandler();
    const result = await handler(
      createHandlerJob({
        payload: {
          sourceId: '55',
          trigger: 'manual',
          runToken: 'tok-55',
          sourceName: 'deleted-source-55',
          sourceArrType: 'radarr',
        },
        source: 'manual',
      })
    );

    const evidence = parseEvidence(result.output);
    assertEquals(requestedId, 55);
    assertEquals(result.status, 'cancelled');
    assertEquals(evidence.status, 'cancelled');
    assertExists(evidence.failure);
    assertEquals(evidence.failure.code, 'source_missing');
    assertEquals(evidence.counts, null);
    assertEquals(evidence.failure?.message, buildTrashGuideSyncFailure('source_missing').message);
    // AC5: a since-deleted source stays identifiable from the durable payload snapshot.
    assertEquals(evidence.runToken, 'tok-55');
    assertEquals(evidence.source.name, 'deleted-source-55');
    assertEquals(evidence.source.arrType, 'radarr');
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trashGuideSync handler resolves undefined trigger to scheduled for schedule-source jobs', async () => {
  const restores: Restore[] = [];
  const recentSync = new Date().toISOString();

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() =>
      createSourceFixture(60, {
        arrType: 'radarr',
        syncStrategy: 60,
        lastSyncedAt: recentSync,
      })) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  const check = patchCheckForUpdatesNotCalled(restores);

  try {
    const handler = getSyncHandler();
    const result = await handler(
      createHandlerJob({ payload: { sourceId: 60, runToken: 'tok-60' }, source: 'schedule' })
    );

    const evidence = parseEvidence(result.output);
    assertEquals(result.status, 'skipped');
    assertEquals(evidence.status, 'skipped');
    assertEquals(evidence.trigger, 'scheduled');
    assertEquals(evidence.failure, null);
    assertEquals(typeof result.rescheduleAt, 'string');
    assertEquals(check.calls(), 0);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trashGuideSync handler resolves undefined trigger to manual for manual-source jobs', async () => {
  const restores: Restore[] = [];
  let syncCalls = 0;

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() =>
      createSourceFixture(61, { arrType: 'radarr', lastSyncedAt: null })) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  patchTarget(
    trashGuideManager,
    'checkForUpdates',
    (() => Promise.resolve(createUpdateInfo({ hasUpdates: false }))) as typeof trashGuideManager.checkForUpdates,
    restores
  );
  patchTarget(
    trashGuideManager,
    'sync',
    (() => {
      syncCalls += 1;
      return Promise.resolve(createSyncResult());
    }) as typeof trashGuideManager.sync,
    restores
  );
  patchUpdateSyncMetadata(restores);

  try {
    const handler = getSyncHandler();
    const result = await handler(createHandlerJob({ payload: { sourceId: 61, runToken: 'tok-61' }, source: 'manual' }));

    const evidence = parseEvidence(result.output);
    assertEquals(syncCalls, 1);
    assertEquals(result.status, 'success');
    assertEquals(evidence.status, 'success');
    assertEquals(evidence.trigger, 'manual');
    assertEquals(evidence.failure, null);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trashGuideSync handler honors explicit manual trigger over schedule source default', async () => {
  const restores: Restore[] = [];
  let syncCalls = 0;

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() =>
      createSourceFixture(62, { arrType: 'sonarr', lastSyncedAt: null })) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  patchTarget(
    trashGuideManager,
    'checkForUpdates',
    (() => Promise.resolve(createUpdateInfo({ hasUpdates: false }))) as typeof trashGuideManager.checkForUpdates,
    restores
  );
  patchTarget(
    trashGuideManager,
    'sync',
    (() => {
      syncCalls += 1;
      return Promise.resolve(createSyncResult());
    }) as typeof trashGuideManager.sync,
    restores
  );
  patchUpdateSyncMetadata(restores);

  try {
    const handler = getSyncHandler();
    const result = await handler(
      createHandlerJob({ payload: { sourceId: 62, trigger: 'manual', runToken: 'tok-62' }, source: 'schedule' })
    );

    const evidence = parseEvidence(result.output);
    assertEquals(syncCalls, 1);
    assertEquals(result.status, 'success');
    assertEquals(evidence.status, 'success');
    assertEquals(evidence.trigger, 'manual');
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trashGuideSync handler rejects payload missing sourceId', async () => {
  const restores: Restore[] = [];
  let getByIdCalls = 0;

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() => {
      getByIdCalls += 1;
      return undefined;
    }) as typeof trashGuideSourcesQueries.getById,
    restores
  );

  try {
    const handler = getSyncHandler();
    const result = await handler(createHandlerJob({ payload: { runToken: 'tok-missing' }, source: 'manual' }));

    const evidence = parseEvidence(result.output);
    assertEquals(result.status, 'failure');
    assertEquals(evidence.status, 'failure');
    assertExists(evidence.failure);
    assertEquals(evidence.failure.code, 'internal');
    assertEquals(evidence.counts, null);
    assertEquals(evidence.failure?.message, buildTrashGuideSyncFailure('internal').message);
    assertEquals(getByIdCalls, 0);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trashGuideSync handler rejects payload with non-numeric sourceId', async () => {
  const restores: Restore[] = [];
  let getByIdCalls = 0;

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() => {
      getByIdCalls += 1;
      return undefined;
    }) as typeof trashGuideSourcesQueries.getById,
    restores
  );

  try {
    const handler = getSyncHandler();
    const result = await handler(
      createHandlerJob({ payload: { sourceId: 'abc', trigger: 'manual', runToken: 'tok-abc' }, source: 'manual' })
    );

    const evidence = parseEvidence(result.output);
    assertEquals(result.status, 'failure');
    assertEquals(evidence.status, 'failure');
    assertExists(evidence.failure);
    assertEquals(evidence.failure.code, 'internal');
    assertEquals(evidence.failure?.message, buildTrashGuideSyncFailure('internal').message);
    assertEquals(getByIdCalls, 0);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trashGuideSync handler rejects payload with invalid trigger literal', async () => {
  const restores: Restore[] = [];
  let getByIdCalls = 0;

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() => {
      getByIdCalls += 1;
      return undefined;
    }) as typeof trashGuideSourcesQueries.getById,
    restores
  );

  try {
    const handler = getSyncHandler();
    const result = await handler(
      createHandlerJob({ payload: { sourceId: 5, trigger: 'auto', runToken: 'tok-auto' }, source: 'manual' })
    );

    const evidence = parseEvidence(result.output);
    assertEquals(result.status, 'failure');
    assertEquals(evidence.status, 'failure');
    assertExists(evidence.failure);
    assertEquals(evidence.failure.code, 'internal');
    assertEquals(evidence.failure?.message, buildTrashGuideSyncFailure('internal').message);
    assertEquals(getByIdCalls, 0);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trashGuideSync handler rejects payload with non-string requestedAt', async () => {
  const restores: Restore[] = [];
  let getByIdCalls = 0;

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() => {
      getByIdCalls += 1;
      return undefined;
    }) as typeof trashGuideSourcesQueries.getById,
    restores
  );

  try {
    const handler = getSyncHandler();
    const result = await handler(
      createHandlerJob({
        payload: { sourceId: 5, trigger: 'manual', requestedAt: 12345, runToken: 'tok-badreq' },
        source: 'manual',
      })
    );

    const evidence = parseEvidence(result.output);
    assertEquals(result.status, 'failure');
    assertEquals(evidence.status, 'failure');
    assertExists(evidence.failure);
    assertEquals(evidence.failure.code, 'internal');
    assertEquals(evidence.failure?.message, buildTrashGuideSyncFailure('internal').message);
    assertEquals(getByIdCalls, 0);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trashGuideSync handler schedules a retry for transient git/network failures', async () => {
  const restores: Restore[] = [];
  let currentMessage = '';
  let warnCalls = 0;
  let errorCalls = 0;

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() =>
      createSourceFixture(80, {
        arrType: 'radarr',
        syncStrategy: 60,
        lastSyncedAt: null,
      })) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  patchTarget(
    trashGuideManager,
    'checkForUpdates',
    (() => {
      throw new Error(currentMessage);
    }) as typeof trashGuideManager.checkForUpdates,
    restores
  );
  patchTarget(
    logger,
    'warn',
    (() => {
      warnCalls += 1;
      return Promise.resolve();
    }) as typeof logger.warn,
    restores
  );
  patchTarget(
    logger,
    'error',
    (() => {
      errorCalls += 1;
      return Promise.resolve();
    }) as typeof logger.error,
    restores
  );

  const messages = [
    'git network failure detected',
    'git pull failed',
    'could not resolve host github.com',
    'failed to connect to remote',
    'network is unreachable',
    'operation timed out',
    'TLS handshake failed',
    'getaddrinfo EAI_AGAIN',
    'TIMED OUT',
  ];

  const networkFailure = buildTrashGuideSyncFailure('network');

  try {
    const handler = getSyncHandler();
    for (const message of messages) {
      currentMessage = message;
      warnCalls = 0;
      errorCalls = 0;
      const result = await handler(
        createHandlerJob({
          payload: { sourceId: 80, trigger: 'scheduled', runToken: 'tok-80' },
          source: 'schedule',
          attempts: 0,
        })
      );

      const evidence = parseEvidence(result.output);
      assertEquals(result.status, 'failure', `status for "${message}"`);
      assertEquals(evidence.failure?.code, 'network', `failure code for "${message}"`);
      // Typed safe copy is transported; the raw git/network message is never leaked into evidence or error.
      assertEquals(evidence.failure?.message, networkFailure.message, `safe error copy for "${message}"`);
      assertFalse(result.output?.includes(message) ?? false, `output leak for "${message}"`);
      assertFalse(evidence.failure?.message?.includes(message) ?? false, `error leak for "${message}"`);
      assertEquals(typeof result.rescheduleAt, 'string', `rescheduleAt type for "${message}"`);
      assertEquals(warnCalls, 1, `warn count for "${message}"`);
      assertEquals(errorCalls, 1, `error count for "${message}"`);
    }
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trashGuideSync handler does not retry non-transient failures', async () => {
  const restores: Restore[] = [];
  const message = 'schema validation error: unknown field';

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() =>
      createSourceFixture(81, {
        arrType: 'radarr',
        syncStrategy: 60,
        lastSyncedAt: null,
      })) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  patchTarget(
    trashGuideManager,
    'checkForUpdates',
    (() => {
      throw new Error(message);
    }) as typeof trashGuideManager.checkForUpdates,
    restores
  );
  const counters = patchLoggerCounters(restores);

  try {
    const handler = getSyncHandler();
    const before = Date.now();
    const result = await handler(
      createHandlerJob({
        payload: { sourceId: 81, trigger: 'scheduled', runToken: 'tok-81' },
        source: 'schedule',
        attempts: 0,
      })
    );

    const evidence = parseEvidence(result.output);
    assertEquals(result.status, 'failure');
    assertEquals(evidence.failure?.code, 'sync_failed');
    assertEquals(evidence.failure?.message, buildTrashGuideSyncFailure('sync_failed').message);
    assertFalse(result.output?.includes(message) ?? false);
    assertFalse(evidence.failure?.message?.includes(message) ?? false);
    assertEquals(counters.warnCalls(), 0);
    assertEquals(typeof result.rescheduleAt, 'string');
    const deltaMinutes = (Date.parse(result.rescheduleAt as string) - before) / 60_000;
    assertAlmostEquals(deltaMinutes, 60, 1);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trashGuideSync handler does not retry transient failures on manual triggers', async () => {
  const restores: Restore[] = [];
  const message = 'git network failure';

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() =>
      createSourceFixture(82, {
        arrType: 'radarr',
        syncStrategy: 60,
        lastSyncedAt: null,
      })) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  patchTarget(
    trashGuideManager,
    'checkForUpdates',
    (() => {
      throw new Error(message);
    }) as typeof trashGuideManager.checkForUpdates,
    restores
  );
  const counters = patchLoggerCounters(restores);

  try {
    const handler = getSyncHandler();
    const result = await handler(
      createHandlerJob({
        payload: { sourceId: 82, trigger: 'manual', runToken: 'tok-82' },
        source: 'manual',
        attempts: 0,
      })
    );

    const evidence = parseEvidence(result.output);
    assertEquals(result.status, 'failure');
    assertEquals(evidence.failure?.code, 'network');
    assertEquals(evidence.failure?.message, buildTrashGuideSyncFailure('network').message);
    assertFalse(result.output?.includes(message) ?? false);
    assertFalse(evidence.failure?.message?.includes(message) ?? false);
    assertEquals(counters.warnCalls(), 0);
    assertEquals(result.rescheduleAt, null);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trashGuideSync handler stops retrying transient failures at the attempt ceiling', async () => {
  const restores: Restore[] = [];

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() =>
      createSourceFixture(83, {
        arrType: 'radarr',
        syncStrategy: 60,
        lastSyncedAt: null,
      })) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  patchTarget(
    trashGuideManager,
    'checkForUpdates',
    (() => {
      throw new Error('git network failure');
    }) as typeof trashGuideManager.checkForUpdates,
    restores
  );
  const counters = patchLoggerCounters(restores);

  try {
    const handler = getSyncHandler();
    const before = Date.now();
    const result = await handler(
      createHandlerJob({
        payload: { sourceId: 83, trigger: 'scheduled', runToken: 'tok-83' },
        source: 'schedule',
        attempts: 3,
      })
    );

    const evidence = parseEvidence(result.output);
    assertEquals(result.status, 'failure');
    assertEquals(evidence.failure?.code, 'network');
    assertEquals(counters.warnCalls(), 0);
    assertEquals(typeof result.rescheduleAt, 'string');
    const deltaMinutes = (Date.parse(result.rescheduleAt as string) - before) / 60_000;
    assertAlmostEquals(deltaMinutes, 60, 1);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trashGuideSync handler retries with exponential backoff just below the attempt ceiling', async () => {
  const restores: Restore[] = [];

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() =>
      createSourceFixture(84, {
        arrType: 'radarr',
        syncStrategy: 60,
        lastSyncedAt: null,
      })) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  patchTarget(
    trashGuideManager,
    'checkForUpdates',
    (() => {
      throw new Error('git network failure');
    }) as typeof trashGuideManager.checkForUpdates,
    restores
  );
  const counters = patchLoggerCounters(restores);

  try {
    const handler = getSyncHandler();
    const before = Date.now();
    const result = await handler(
      createHandlerJob({
        payload: { sourceId: 84, trigger: 'scheduled', runToken: 'tok-84' },
        source: 'schedule',
        attempts: 2,
      })
    );

    const evidence = parseEvidence(result.output);
    assertEquals(result.status, 'failure');
    assertEquals(evidence.failure?.code, 'network');
    assertEquals(counters.warnCalls(), 1);
    assertEquals(typeof result.rescheduleAt, 'string');
    const deltaMinutes = (Date.parse(result.rescheduleAt as string) - before) / 60_000;
    assertAlmostEquals(deltaMinutes, 2, 0.5);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trashGuideSync handler treats sync parseStatus failed as a terminal failure', async () => {
  const restores: Restore[] = [];

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() =>
      createSourceFixture(85, {
        arrType: 'radarr',
        syncStrategy: 60,
        lastSyncedAt: null,
      })) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  patchTarget(
    trashGuideManager,
    'checkForUpdates',
    (() =>
      Promise.resolve(
        createUpdateInfo({ hasUpdates: true, commitsBehind: 1 })
      )) as typeof trashGuideManager.checkForUpdates,
    restores
  );
  patchTarget(
    trashGuideManager,
    'sync',
    (() =>
      Promise.resolve(
        createSyncResult({ parseStatus: 'failed', commitsBehind: 1, parsedFiles: 0, failedFiles: 3 })
      )) as typeof trashGuideManager.sync,
    restores
  );
  const counters = patchLoggerCounters(restores);

  try {
    const handler = getSyncHandler();
    const before = Date.now();
    const result = await handler(
      createHandlerJob({
        payload: { sourceId: 85, trigger: 'scheduled', runToken: 'tok-85' },
        source: 'schedule',
        attempts: 0,
      })
    );

    const evidence = parseEvidence(result.output);
    assertEquals(result.status, 'failure');
    assertEquals(evidence.failure?.code, 'parser_failed');
    assertEquals(evidence.failure?.message, buildTrashGuideSyncFailure('parser_failed').message);
    // parser_failed carries the counts observed during the failed parse.
    assertExists(evidence.counts);
    assertEquals(evidence.counts.commitsBehind, 1);
    assertEquals(evidence.counts.failedFiles, 3);
    assertEquals(counters.warnCalls(), 0);
    assertEquals(typeof result.rescheduleAt, 'string');
    const deltaMinutes = (Date.parse(result.rescheduleAt as string) - before) / 60_000;
    assertAlmostEquals(deltaMinutes, 60, 1);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trashGuideSync handler treats sync success:false schema errors as terminal', async () => {
  const restores: Restore[] = [];
  const message = 'schema validation failed: bad operator';

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() =>
      createSourceFixture(86, {
        arrType: 'radarr',
        syncStrategy: 60,
        lastSyncedAt: null,
      })) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  patchTarget(
    trashGuideManager,
    'checkForUpdates',
    (() =>
      Promise.resolve(
        createUpdateInfo({ hasUpdates: true, commitsBehind: 1 })
      )) as typeof trashGuideManager.checkForUpdates,
    restores
  );
  patchTarget(
    trashGuideManager,
    'sync',
    (() =>
      Promise.resolve(
        createSyncResult({ success: false, error: message, parseStatus: 'failed', commitsBehind: 1, parsedFiles: 0 })
      )) as typeof trashGuideManager.sync,
    restores
  );
  const counters = patchLoggerCounters(restores);

  try {
    const handler = getSyncHandler();
    const before = Date.now();
    const result = await handler(
      createHandlerJob({
        payload: { sourceId: 86, trigger: 'scheduled', runToken: 'tok-86' },
        source: 'schedule',
        attempts: 0,
      })
    );

    const evidence = parseEvidence(result.output);
    assertEquals(result.status, 'failure');
    // success:false short-circuits before parseStatus, classifying the raw message (non-transient here).
    assertEquals(evidence.failure?.code, 'sync_failed');
    assertEquals(evidence.failure?.message, buildTrashGuideSyncFailure('sync_failed').message);
    assertFalse(result.output?.includes(message) ?? false);
    assertFalse(evidence.failure?.message?.includes(message) ?? false);
    assertEquals(counters.warnCalls(), 0);
    assertEquals(counters.errorCalls(), 1);
    assertEquals(typeof result.rescheduleAt, 'string');
    const deltaMinutes = (Date.parse(result.rescheduleAt as string) - before) / 60_000;
    assertAlmostEquals(deltaMinutes, 60, 1);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trashGuideSync handler cancels a disabled source before checking updates', async () => {
  const restores: Restore[] = [];

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() => createSourceFixture(87, { arrType: 'radarr', enabled: false })) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  const check = patchCheckForUpdatesNotCalled(restores);

  try {
    const handler = getSyncHandler();
    const result = await handler(
      createHandlerJob({ payload: { sourceId: 87, trigger: 'manual', runToken: 'tok-87' }, source: 'manual' })
    );

    const evidence = parseEvidence(result.output);
    assertEquals(result.status, 'cancelled');
    assertEquals(evidence.status, 'cancelled');
    assertExists(evidence.failure);
    assertEquals(evidence.failure.code, 'source_disabled');
    assertEquals(evidence.counts, null);
    assertEquals(evidence.failure?.message, buildTrashGuideSyncFailure('source_disabled').message);
    assertEquals(check.calls(), 0);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trashGuideSync handler cancels a scheduled job when the schedule is disabled', async () => {
  const restores: Restore[] = [];

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() => createSourceFixture(88, { arrType: 'sonarr', syncStrategy: 0 })) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  const check = patchCheckForUpdatesNotCalled(restores);

  try {
    const handler = getSyncHandler();
    const result = await handler(
      createHandlerJob({ payload: { sourceId: 88, trigger: 'scheduled', runToken: 'tok-88' }, source: 'schedule' })
    );

    const evidence = parseEvidence(result.output);
    assertEquals(result.status, 'cancelled');
    assertEquals(evidence.status, 'cancelled');
    // A disabled schedule is benign, not an operator-facing failure.
    assertEquals(evidence.failure, null);
    assertEquals(evidence.counts, null);
    assertEquals(evidence.failure?.message, undefined);
    assertEquals(check.calls(), 0);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trashGuideSync handler skips and reschedules a scheduled job that is not yet due', async () => {
  const restores: Restore[] = [];
  const lastSyncedAt = new Date().toISOString();

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() =>
      createSourceFixture(89, {
        arrType: 'radarr',
        syncStrategy: 60,
        lastSyncedAt,
      })) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  const check = patchCheckForUpdatesNotCalled(restores);

  try {
    const handler = getSyncHandler();
    const result = await handler(
      createHandlerJob({ payload: { sourceId: 89, trigger: 'scheduled', runToken: 'tok-89' }, source: 'schedule' })
    );

    const evidence = parseEvidence(result.output);
    assertEquals(result.status, 'skipped');
    assertEquals(evidence.status, 'skipped');
    assertEquals(evidence.failure, null);
    assertEquals(evidence.counts, null);
    assertEquals(result.rescheduleAt, calculateNextRunFromMinutes(lastSyncedAt, 60));
    assertEquals(check.calls(), 0);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trashGuideSync handler proceeds past the not-due guard when overdue', async () => {
  const restores: Restore[] = [];
  let checkCalls = 0;

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() =>
      createSourceFixture(90, {
        arrType: 'radarr',
        syncStrategy: 60,
        lastSyncedAt: '2020-01-01T00:00:00.000Z',
      })) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  patchTarget(
    trashGuideManager,
    'checkForUpdates',
    (() => {
      checkCalls += 1;
      return Promise.resolve(createUpdateInfo({ hasUpdates: false }));
    }) as typeof trashGuideManager.checkForUpdates,
    restores
  );
  const meta = patchUpdateSyncMetadata(restores);

  try {
    const handler = getSyncHandler();
    const result = await handler(
      createHandlerJob({ payload: { sourceId: 90, trigger: 'scheduled', runToken: 'tok-90' }, source: 'schedule' })
    );

    const evidence = parseEvidence(result.output);
    assertEquals(checkCalls, 1);
    assertEquals(result.status, 'skipped');
    assertEquals(evidence.status, 'skipped');
    assertEquals(evidence.failure, null);
    assertExists(evidence.counts);
    assertEquals(evidence.counts.commitsBehind, 0);
    assertEquals(meta.calls(), 1);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trashGuideSync handler skips sync when auto_pull is disabled on a scheduled trigger', async () => {
  const restores: Restore[] = [];
  let syncCalls = 0;

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() =>
      createSourceFixture(91, {
        arrType: 'radarr',
        syncStrategy: 60,
        lastSyncedAt: null,
        autoPull: false,
      })) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  patchTarget(
    trashGuideManager,
    'checkForUpdates',
    (() =>
      Promise.resolve(
        createUpdateInfo({ hasUpdates: true, commitsBehind: 2 })
      )) as typeof trashGuideManager.checkForUpdates,
    restores
  );
  patchTarget(
    trashGuideManager,
    'sync',
    (() => {
      syncCalls += 1;
      return Promise.resolve(createSyncResult());
    }) as typeof trashGuideManager.sync,
    restores
  );
  const meta = patchUpdateSyncMetadata(restores);

  try {
    const handler = getSyncHandler();
    const result = await handler(
      createHandlerJob({ payload: { sourceId: 91, trigger: 'scheduled', runToken: 'tok-91' }, source: 'schedule' })
    );

    const evidence = parseEvidence(result.output);
    assertEquals(result.status, 'success');
    assertEquals(evidence.status, 'success');
    assertEquals(evidence.failure, null);
    assertExists(evidence.counts);
    // auto_pull disabled: report the commits-behind observed by the update check, no applied work.
    assertEquals(evidence.counts.commitsBehind, 2);
    assertEquals(evidence.counts.parsedFiles, 0);
    assertEquals(syncCalls, 0);
    assertEquals(meta.calls(), 1);
    assertEquals(meta.lastSourceId(), 91);
    assertEquals(typeof meta.lastInput()?.lastSyncedAt, 'string');
    assertEquals(typeof result.rescheduleAt, 'string');
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trashGuideSync handler skips sync when auto_pull is disabled on a manual trigger', async () => {
  const restores: Restore[] = [];
  let syncCalls = 0;

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() =>
      createSourceFixture(92, {
        arrType: 'sonarr',
        syncStrategy: 60,
        lastSyncedAt: null,
        autoPull: false,
      })) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  patchTarget(
    trashGuideManager,
    'checkForUpdates',
    (() =>
      Promise.resolve(
        createUpdateInfo({ hasUpdates: true, commitsBehind: 4 })
      )) as typeof trashGuideManager.checkForUpdates,
    restores
  );
  patchTarget(
    trashGuideManager,
    'sync',
    (() => {
      syncCalls += 1;
      return Promise.resolve(createSyncResult());
    }) as typeof trashGuideManager.sync,
    restores
  );
  const meta = patchUpdateSyncMetadata(restores);

  try {
    const handler = getSyncHandler();
    const result = await handler(
      createHandlerJob({ payload: { sourceId: 92, trigger: 'manual', runToken: 'tok-92' }, source: 'manual' })
    );

    const evidence = parseEvidence(result.output);
    assertEquals(result.status, 'success');
    assertEquals(evidence.status, 'success');
    assertExists(evidence.counts);
    assertEquals(evidence.counts.commitsBehind, 4);
    assertEquals(syncCalls, 0);
    assertEquals(meta.calls(), 1);
    assertEquals(result.rescheduleAt, null);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trashGuideSync handler runs sync when auto_pull is enabled', async () => {
  const restores: Restore[] = [];
  let syncCalls = 0;

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() =>
      createSourceFixture(93, { arrType: 'radarr', lastSyncedAt: null })) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  patchTarget(
    trashGuideManager,
    'checkForUpdates',
    (() =>
      Promise.resolve(
        createUpdateInfo({ hasUpdates: true, commitsBehind: 2 })
      )) as typeof trashGuideManager.checkForUpdates,
    restores
  );
  patchTarget(
    trashGuideManager,
    'sync',
    (() => {
      syncCalls += 1;
      return Promise.resolve(
        createSyncResult({
          commitsBehind: 2,
          parsedFiles: 5,
          failedFiles: 0,
          activeOperations: 3,
          removedEntities: 1,
          renamedEntities: 0,
        })
      );
    }) as typeof trashGuideManager.sync,
    restores
  );
  patchUpdateSyncMetadata(restores);

  try {
    const handler = getSyncHandler();
    const result = await handler(
      createHandlerJob({ payload: { sourceId: 93, trigger: 'manual', runToken: 'tok-93' }, source: 'manual' })
    );

    const evidence = parseEvidence(result.output);
    assertEquals(syncCalls, 1);
    assertEquals(result.status, 'success');
    assertEquals(evidence.status, 'success');
    assertEquals(evidence.runToken, 'tok-93');
    assertEquals(evidence.failure, null);
    assertExists(evidence.counts);
    assertEquals(evidence.counts, {
      commitsBehind: 2,
      parsedFiles: 5,
      failedFiles: 0,
      activeOperations: 3,
      removedEntities: 1,
      renamedEntities: 0,
    });
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trashGuideSync handler skips before the auto_pull gate when there are no updates', async () => {
  const restores: Restore[] = [];
  let syncCalls = 0;

  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() =>
      createSourceFixture(94, {
        arrType: 'radarr',
        syncStrategy: 60,
        lastSyncedAt: null,
      })) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  patchTarget(
    trashGuideManager,
    'checkForUpdates',
    (() => Promise.resolve(createUpdateInfo({ hasUpdates: false }))) as typeof trashGuideManager.checkForUpdates,
    restores
  );
  patchTarget(
    trashGuideManager,
    'sync',
    (() => {
      syncCalls += 1;
      return Promise.resolve(createSyncResult());
    }) as typeof trashGuideManager.sync,
    restores
  );
  const meta = patchUpdateSyncMetadata(restores);

  try {
    const handler = getSyncHandler();
    const result = await handler(
      createHandlerJob({ payload: { sourceId: 94, trigger: 'scheduled', runToken: 'tok-94' }, source: 'schedule' })
    );

    const evidence = parseEvidence(result.output);
    assertEquals(result.status, 'skipped');
    assertEquals(evidence.status, 'skipped');
    assertEquals(evidence.failure, null);
    assertExists(evidence.counts);
    assertEquals(evidence.counts.commitsBehind, 0);
    assertEquals(evidence.counts.parsedFiles, 0);
    assertEquals(syncCalls, 0);
    assertEquals(meta.calls(), 1);
    assertEquals(typeof meta.lastInput()?.lastSyncedAt, 'string');
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});
