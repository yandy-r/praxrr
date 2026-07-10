import { assert, assertAlmostEquals, assertEquals, assertExists, assertStringIncludes } from '@std/assert';
import { type CreateJobQueueInput, jobQueueQueries } from '$db/queries/jobQueue.ts';
import { type TrashGuideSource, trashGuideSourcesQueries } from '$db/queries/trashGuideSources.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import { scheduleTrashGuideSyncJobs } from '$jobs/schedule.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';
import { calculateNextRunFromMinutes } from '$jobs/scheduleUtils.ts';
import type { JobQueueRecord, JobSource } from '$jobs/queueTypes.ts';
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

Deno.test('scheduleTrashGuideSyncJobs reuses stable dedupe keys across repeated schedule runs', () => {
  const restores: Restore[] = [];

  const dedupeKeysFirstRun: string[] = [];
  const dedupeKeysSecondRun: string[] = [];
  const notifiedRunAts: string[] = [];
  let runNumber = 1;

  patchTarget(
    trashGuideSourcesQueries,
    'getAll',
    () => [createSourceFixture(41, { arrType: 'radarr' }), createSourceFixture(42, { arrType: 'sonarr' })],
    restores
  );

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
      assertEquals(input.payload.sourceId === 41 || input.payload.sourceId === 42, true);
      assertEquals(input.payload.trigger, 'scheduled');
      assertEquals(typeof input.payload.requestedAt, 'string');

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
      createHandlerJob({ payload: { sourceId: '55', trigger: 'manual' }, source: 'manual' })
    );

    assertEquals(requestedId, 55);
    assertEquals(result.status, 'cancelled');
    assertEquals(result.decision, 'TRaSH source not found');
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
    const result = await handler(createHandlerJob({ payload: { sourceId: 60 }, source: 'schedule' }));

    assertEquals(result.status, 'skipped');
    assertEquals(result.decision, 'TRaSH sync not due');
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
    const result = await handler(createHandlerJob({ payload: { sourceId: 61 }, source: 'manual' }));

    assertEquals(syncCalls, 1);
    assertEquals(result.status, 'success');
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
      createHandlerJob({ payload: { sourceId: 62, trigger: 'manual' }, source: 'schedule' })
    );

    assertEquals(syncCalls, 1);
    assertEquals(result.status, 'success');
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
    const result = await handler(createHandlerJob({ payload: {}, source: 'manual' }));

    assertEquals(result.status, 'failure');
    assert(result.status === 'failure');
    assertEquals(result.failureCode, 'invalidPayload');
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
      createHandlerJob({ payload: { sourceId: 'abc', trigger: 'manual' }, source: 'manual' })
    );

    assertEquals(result.status, 'failure');
    assert(result.status === 'failure');
    assertEquals(result.failureCode, 'invalidPayload');
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
    const result = await handler(createHandlerJob({ payload: { sourceId: 5, trigger: 'auto' }, source: 'manual' }));

    assertEquals(result.status, 'failure');
    assert(result.status === 'failure');
    assertEquals(result.failureCode, 'invalidPayload');
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
      createHandlerJob({ payload: { sourceId: 5, trigger: 'manual', requestedAt: 12345 }, source: 'manual' })
    );

    assertEquals(result.status, 'failure');
    assert(result.status === 'failure');
    assertEquals(result.failureCode, 'invalidPayload');
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

  try {
    const handler = getSyncHandler();
    for (const message of messages) {
      currentMessage = message;
      warnCalls = 0;
      errorCalls = 0;
      const result = await handler(
        createHandlerJob({ payload: { sourceId: 80, trigger: 'scheduled' }, source: 'schedule', attempts: 0 })
      );

      assertEquals(result.status, 'failure', `status for "${message}"`);
      assert(result.status === 'failure');
      assertEquals(result.failureCode, 'gitNetwork', `failure code for "${message}"`);
      assert(!JSON.stringify(result).includes(message), `no message leak for "${message}"`);
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
      createHandlerJob({ payload: { sourceId: 81, trigger: 'scheduled' }, source: 'schedule', attempts: 0 })
    );

    assertEquals(result.status, 'failure');
    assert(result.status === 'failure');
    assertEquals(result.failureCode, 'gitNetwork');
    assert(!JSON.stringify(result).includes(message));
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
      throw new Error('git network failure');
    }) as typeof trashGuideManager.checkForUpdates,
    restores
  );
  const counters = patchLoggerCounters(restores);

  try {
    const handler = getSyncHandler();
    const result = await handler(
      createHandlerJob({ payload: { sourceId: 82, trigger: 'manual' }, source: 'manual', attempts: 0 })
    );

    assertEquals(result.status, 'failure');
    assert(result.status === 'failure');
    assertEquals(result.failureCode, 'gitNetwork');
    assert(!JSON.stringify(result).includes('git network failure'));
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
      createHandlerJob({ payload: { sourceId: 83, trigger: 'scheduled' }, source: 'schedule', attempts: 3 })
    );

    assertEquals(result.status, 'failure');
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
      createHandlerJob({ payload: { sourceId: 84, trigger: 'scheduled' }, source: 'schedule', attempts: 2 })
    );

    assertEquals(result.status, 'failure');
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
      createHandlerJob({ payload: { sourceId: 85, trigger: 'scheduled' }, source: 'schedule', attempts: 0 })
    );

    assertEquals(result.status, 'failure');
    assert(result.status === 'failure');
    assertEquals(result.failureCode, 'validation');
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
      createHandlerJob({ payload: { sourceId: 86, trigger: 'scheduled' }, source: 'schedule', attempts: 0 })
    );

    assertEquals(result.status, 'failure');
    assert(result.status === 'failure');
    assertEquals(result.failureCode, 'gitNetwork');
    assert(!JSON.stringify(result).includes(message));
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
    const result = await handler(createHandlerJob({ payload: { sourceId: 87, trigger: 'manual' }, source: 'manual' }));

    assertEquals(result.status, 'cancelled');
    assertEquals(result.decision, 'TRaSH source disabled');
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
      createHandlerJob({ payload: { sourceId: 88, trigger: 'scheduled' }, source: 'schedule' })
    );

    assertEquals(result.status, 'cancelled');
    assertEquals(result.decision, 'TRaSH source schedule is disabled');
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
      createHandlerJob({ payload: { sourceId: 89, trigger: 'scheduled' }, source: 'schedule' })
    );

    assertEquals(result.status, 'skipped');
    assertEquals(result.decision, 'TRaSH sync not due');
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
      createHandlerJob({ payload: { sourceId: 90, trigger: 'scheduled' }, source: 'schedule' })
    );

    assertEquals(checkCalls, 1);
    assertEquals(result.status, 'skipped');
    assertEquals(result.decision, 'No TRaSH guide updates available');
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
      createHandlerJob({ payload: { sourceId: 91, trigger: 'scheduled' }, source: 'schedule' })
    );

    assertEquals(result.status, 'success');
    assertStringIncludes(result.output ?? '', 'auto-pull disabled');
    assertStringIncludes(result.output ?? '', '(2 commit(s)');
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
    const result = await handler(createHandlerJob({ payload: { sourceId: 92, trigger: 'manual' }, source: 'manual' }));

    assertEquals(result.status, 'success');
    assertStringIncludes(result.output ?? '', 'auto-pull disabled');
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
    const result = await handler(createHandlerJob({ payload: { sourceId: 93, trigger: 'manual' }, source: 'manual' }));

    assertEquals(syncCalls, 1);
    assertEquals(result.status, 'success');
    assertEquals(
      result.output,
      'Synced TRaSH source (2 commit(s) behind), parsed=5, failed=0, ops=3, removed=1, renamed=0, status=success'
    );
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
      createHandlerJob({ payload: { sourceId: 94, trigger: 'scheduled' }, source: 'schedule' })
    );

    assertEquals(result.status, 'skipped');
    assertEquals(result.decision, 'No TRaSH guide updates available');
    assertEquals(syncCalls, 0);
    assertEquals(meta.calls(), 1);
    assertEquals(typeof meta.lastInput()?.lastSyncedAt, 'string');
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});
