import { assert, assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { jobRunHistoryQueries } from '$db/queries/jobRunHistory.ts';
import { logger } from '$logger/logger.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';
import { enqueueJob, upsertScheduledJob } from '$jobs/queueService.ts';
import type { JobHandler, JobType } from '$jobs/queueTypes.ts';
import { eventBus } from '$lib/server/events/bus.ts';
import type { LiveEvent, LiveEventOf } from '$shared/events/types.ts';
import { driftSettingsQueries } from '$db/queries/driftSettings.ts';
import { cleanupJobsForDatabase } from '$jobs/cleanup.ts';
import { cancelQueuedRenameJobs } from '$jobs/renameHelpers.ts';
import { scheduleDriftCheck } from '$jobs/schedule.ts';
import { currentUserOpActionId, withUserOpAction } from '$pcd/ops/actionContext.ts';

// Register production handlers (side-effect only) so the override/restore below is meaningful.
import '$jobs/handlers/index.ts';

// ============================================================================
// DB BOOTSTRAP -- mirrors tests/routes/syncHistory.test.ts. The dispatcher is stopped in finally so
// no wake timer (e.g. the +1h scheduled job in T-D5) leaks across tests.
// ============================================================================

function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/dispatcher-events-${crypto.randomUUID()}`;
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
 * Collects every bus event until `predicate(events)` holds. Rejects on timeout (a failure guard,
 * not a wait); always unsubscribes. Subscribe BEFORE triggering the work so no publish is missed.
 */
function collect(predicate: (events: LiveEvent[]) => boolean, timeoutMs = 2000): Promise<LiveEvent[]> {
  const events: LiveEvent[] = [];
  const { promise, resolve, reject } = Promise.withResolvers<LiveEvent[]>();
  const unsubscribe = eventBus.subscribe((envelope) => {
    events.push(envelope.event);
    if (predicate(events)) resolve(events);
  });
  const timer = setTimeout(() => {
    reject(new Error(`collect timed out after ${timeoutMs}ms; saw ${JSON.stringify(events.map((e) => e.type))}`));
  }, timeoutMs);
  return promise.finally(() => {
    clearTimeout(timer);
    unsubscribe();
  });
}

const isFinished = (event: LiveEvent): event is LiveEventOf<'job.finished'> => event.type === 'job.finished';

function finishedFor(jobType: string): (events: LiveEvent[]) => boolean {
  return (events) => events.some((event) => isFinished(event) && event.jobType === jobType);
}

/** Swap the `logs.cleanup` handler for the duration of `fn`, always restoring the original. */
async function withStub(stub: JobHandler, fn: () => Promise<void>): Promise<void> {
  const original = jobQueueRegistry.get('logs.cleanup');
  jobQueueRegistry.register('logs.cleanup', stub);
  try {
    await fn();
  } finally {
    if (original) jobQueueRegistry.register('logs.cleanup', original);
  }
}

function eventsForJob(events: LiveEvent[], jobId: number): LiveEvent[] {
  return events.filter((event) => 'jobId' in event && event.jobId === jobId);
}

function singleFinished(events: LiveEvent[], jobId: number): LiveEventOf<'job.finished'> {
  const finished = eventsForJob(events, jobId).filter(isFinished);
  assertEquals(finished.length, 1);
  return finished[0];
}

migratedTest('T-D1 dispatcher publishes queued -> running -> finished in order', async () => {
  await withStub(
    () => Promise.resolve({ status: 'success', output: 'ok' }),
    async () => {
      const pending = collect(finishedFor('logs.cleanup'));
      const job = enqueueJob({ jobType: 'logs.cleanup', runAt: new Date().toISOString(), source: 'manual' });
      const events = await pending;

      const forJob = eventsForJob(events, job.id);
      assertEquals(
        forJob.map((event) => event.type),
        ['job.queued', 'job.running', 'job.finished']
      );

      const finished = singleFinished(events, job.id);
      assertEquals(finished.status, 'success');
      assertEquals(finished.runStatus, 'success');
      assertEquals(finished.rescheduled, false);
      assertEquals(finished.nextRunAt, null);
      assert(finished.runId > 0, 'runId must reference a persisted run history row');
      assertEquals(finished.source, 'manual');
      assert(finished.displayName.length > 0, 'displayName must be non-empty');
      assertEquals(finished.arrType, null);
    }
  );
});

migratedTest('T-D2 thrown handler errors never leak raw error text into events', async () => {
  await withStub(
    () => Promise.reject(new Error('HTTP 500: Internal | {"apiKey":"SECRET-123","url":"http://arr.local:7878"}')),
    async () => {
      const pending = collect(finishedFor('logs.cleanup'));
      const job = enqueueJob({ jobType: 'logs.cleanup', runAt: new Date().toISOString(), source: 'manual' });
      const events = await pending;

      const finished = singleFinished(events, job.id);
      assertEquals(finished.status, 'failed');
      assertEquals(finished.runStatus, 'failure');
      assertEquals(typeof finished.failureCode, 'string');

      const serialized = JSON.stringify(events);
      for (const forbidden of ['SECRET-123', 'arr.local', 'HTTP 500', '"error"']) {
        assert(!serialized.includes(forbidden), `event stream leaked ${forbidden}: ${serialized}`);
      }
    }
  );
});

migratedTest('T-D3 missing handler publishes a handlerNotFound failure', async () => {
  const pending = collect(finishedFor('legacy.removed'));
  const now = new Date().toISOString();
  const jobId = jobQueueQueries.create({
    jobType: 'legacy.removed' as unknown as JobType,
    runAt: now,
    source: 'manual',
  });
  jobDispatcher.notifyJobEnqueued(now);
  const events = await pending;

  const forJob = eventsForJob(events, jobId);
  assertEquals(
    forJob.map((event) => event.type),
    ['job.running', 'job.finished']
  );

  const finished = singleFinished(events, jobId);
  assertEquals(finished.failureCode, 'handlerNotFound');
  assertEquals(finished.status, 'failed');
  assertEquals(finished.runStatus, 'failure');
  assertEquals(finished.durationMs, 0);
  assert(finished.runId > 0, 'runId must reference a persisted run history row');
});

migratedTest('T-D4 rescheduled runs publish a non-terminal job.finished', async () => {
  const rescheduleAt = new Date(Date.now() + 3_600_000).toISOString();
  await withStub(
    () => Promise.resolve({ status: 'success', rescheduleAt }),
    async () => {
      const pending = collect(finishedFor('logs.cleanup'));
      const job = enqueueJob({ jobType: 'logs.cleanup', runAt: new Date().toISOString(), source: 'manual' });
      const events = await pending;

      const finished = singleFinished(events, job.id);
      assertEquals(finished.rescheduled, true);
      assertEquals(finished.handedBack, false);
      assertEquals(finished.nextRunAt, rescheduleAt);

      const row = jobQueueQueries.getById(job.id);
      assertExists(row);
      assertEquals(row.status, 'queued');
    }
  );
});

migratedTest('dispatcher applies rescheduleSource/reschedulePayload only when the handler provides them', async () => {
  const rescheduleAt = new Date(Date.now() + 3_600_000).toISOString();

  // Neither provided (e.g. canary continuation): the manual row keeps its source and payload.
  await withStub(
    () => Promise.resolve({ status: 'success', rescheduleAt }),
    async () => {
      const pending = collect(finishedFor('logs.cleanup'));
      const job = enqueueJob({
        jobType: 'logs.cleanup',
        runAt: new Date().toISOString(),
        source: 'manual',
        payload: { marker: 'original' } as never,
      });
      await pending;

      const row = jobQueueQueries.getById(job.id);
      assertExists(row);
      assertEquals(row.source, 'manual');
      assertEquals(row.payload, { marker: 'original' });
      // Same-source continuation: not a hand-back, no manual completion toast semantics.
      assertEquals(singleFinished(await pending, job.id).handedBack, false);
    }
  );

  // Both provided (manual run handing the slot back to the schedule): the row is rewritten.
  await withStub(
    () =>
      Promise.resolve({
        status: 'success',
        rescheduleAt,
        rescheduleSource: 'schedule',
        reschedulePayload: { marker: 'next' },
      }),
    async () => {
      const pending = collect(finishedFor('logs.cleanup'));
      const job = enqueueJob({
        jobType: 'logs.cleanup',
        runAt: new Date().toISOString(),
        source: 'manual',
        payload: { marker: 'original' } as never,
      });
      await pending;

      const row = jobQueueQueries.getById(job.id);
      assertExists(row);
      assertEquals(row.source, 'schedule');
      assertEquals(row.payload, { marker: 'next' });
      // Manual -> schedule hand-back is terminal for the user's click and must toast.
      assertEquals(singleFinished(await pending, job.id).handedBack, true);
    }
  );
});

migratedTest('T-D5 future scheduled upserts publish no job.queued', () => {
  // publishJobQueued runs synchronously inside upsertScheduledJob, so the assertion needs no wait.
  const seen: LiveEvent[] = [];
  const unsubscribe = eventBus.subscribe((envelope) => {
    seen.push(envelope.event);
  });
  try {
    upsertScheduledJob({
      jobType: 'logs.cleanup',
      runAt: new Date(Date.now() + 3_600_000).toISOString(),
      source: 'schedule',
      dedupeKey: 'logs.cleanup',
    });
  } finally {
    unsubscribe();
  }

  assertEquals(
    seen.filter((event) => event.type === 'job.queued'),
    []
  );
});

/** Records every bus event published while `fn` runs (publishing is synchronous, so no wait is needed). */
function capture(fn: () => void): LiveEvent[] {
  const seen: LiveEvent[] = [];
  const unsubscribe = eventBus.subscribe((envelope) => {
    seen.push(envelope.event);
  });
  try {
    fn();
  } finally {
    unsubscribe();
  }
  return seen;
}

function assertCancelled(event: LiveEvent | undefined, jobId: number): void {
  assertExists(event);
  assert(isFinished(event));
  assertEquals(event.jobId, jobId);
  assertEquals(event.status, 'cancelled');
  assertEquals(event.runStatus, 'cancelled');
  assertEquals(event.rescheduled, false);
  assertEquals(event.nextRunAt, null);
  assertEquals(event.runId, 0);
}

migratedTest('T-D6 due scheduler upserts publish job.queued; disabling publishes job.finished cancelled', () => {
  const queued = capture(() => scheduleDriftCheck()).filter((event) => event.type === 'job.queued');
  assertEquals(queued.length, 1);
  const job = jobQueueQueries.getByDedupeKey('drift.check');
  assertExists(job);
  assertEquals(queued[0].type === 'job.queued' && queued[0].jobId, job.id);

  driftSettingsQueries.update({ enabled: false });
  const cancelled = capture(() => scheduleDriftCheck());
  assertEquals(cancelled.length, 1);
  assertCancelled(cancelled[0], job.id);
  assertEquals(jobQueueQueries.getById(job.id)?.status, 'cancelled');

  // Already-cancelled rows are not re-announced.
  assertEquals(
    capture(() => scheduleDriftCheck()),
    []
  );
});

migratedTest('T-D7 rename cancel and database cleanup publish job.finished cancelled per queued row', () => {
  const runAt = new Date(Date.now() + 3_600_000).toISOString();
  const slotted = enqueueJob({ jobType: 'arr.rename', runAt, payload: { instanceId: 5 }, dedupeKey: 'arr.rename:5' });
  const loose = enqueueJob({ jobType: 'arr.rename', runAt, payload: { instanceId: 5 } });
  const other = enqueueJob({ jobType: 'arr.rename', runAt, payload: { instanceId: 6 } });

  const renameEvents = capture(() => cancelQueuedRenameJobs(5));
  assertEquals(renameEvents.length, 2);
  assertCancelled(renameEvents[0], slotted.id);
  assertCancelled(renameEvents[1], loose.id);
  assertEquals(jobQueueQueries.getById(other.id)?.status, 'queued');

  const pcd = enqueueJob({ jobType: 'pcd.sync', runAt, payload: { databaseId: 9 } });
  const cleanupEvents = capture(() => assertEquals(cleanupJobsForDatabase(9), 1));
  assertEquals(cleanupEvents.length, 1);
  assertCancelled(cleanupEvents[0], pcd.id);
  assertEquals(jobQueueQueries.getById(pcd.id), undefined);
});

migratedTest('T-D8 listActive excludes future-dated queued rows from every source', () => {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();
  const ids = {
    futureManual: jobQueueQueries.create({
      jobType: 'arr.rename',
      runAt: future,
      source: 'manual',
      payload: { instanceId: 3 },
    }),
    futureSystem: jobQueueQueries.create({
      jobType: 'arr.rename',
      runAt: future,
      source: 'system',
      payload: { instanceId: 3 },
    }),
    futureSchedule: jobQueueQueries.create({
      jobType: 'arr.rename',
      runAt: future,
      source: 'schedule',
      payload: { instanceId: 3 },
    }),
    dueManual: jobQueueQueries.create({
      jobType: 'arr.rename',
      runAt: past,
      source: 'manual',
      payload: { instanceId: 3 },
    }),
    running: jobQueueQueries.create({
      jobType: 'arr.rename',
      runAt: future,
      source: 'manual',
      payload: { instanceId: 3 },
    }),
  };
  jobQueueQueries.setStatus(ids.running, 'running');

  const expected = [ids.running, ids.dueManual];
  assertEquals(
    jobQueueQueries.listActive(50).map((job) => job.id),
    expected
  );
  assertEquals(
    jobQueueQueries
      .listActiveByJobTypesAndInstanceId(['arr.rename'], 3)
      .map((job) => job.id)
      .sort((a, b) => a - b),
    [...expected].sort((a, b) => a - b)
  );
});

migratedTest("dispatcher jobs never run under the enqueuing request's user-op action", async () => {
  let requestActionId: string | undefined;
  let jobActionId: string | undefined;
  await withStub(
    () => {
      jobActionId = currentUserOpActionId();
      return Promise.resolve({ status: 'success', output: 'ok' });
    },
    async () => {
      const pending = collect(finishedFor('logs.cleanup'));
      await withUserOpAction(() => {
        requestActionId = currentUserOpActionId();
        enqueueJob({ jobType: 'logs.cleanup', runAt: new Date().toISOString(), source: 'manual' });
        return Promise.resolve();
      });
      await pending;
    }
  );
  assert(requestActionId !== undefined);
  assert(jobActionId !== undefined, 'job handler must run in its own action');
  assert(jobActionId !== requestActionId, 'job must not reuse the request action id');
});

// Exercise the drain directly so a rejected promise fails the test rather than escaping a timer.
const drainDispatcher = () => jobDispatcher['runDueJobs']();

for (const failurePoint of ['history', 'finish'] as const) {
  migratedTest(`dispatcher contains a ${failurePoint} write failure and runs the next job`, async () => {
    const originalCreate = jobRunHistoryQueries.create;
    const originalFinish = jobQueueQueries.markFinished;
    const originalError = logger.error;
    let failOnce = true;
    const fail = () => {
      if (failOnce) {
        failOnce = false;
        throw new Error('injected persistence failure');
      }
    };
    if (failurePoint === 'history') {
      jobRunHistoryQueries.create = (...args) => {
        fail();
        return originalCreate(...args);
      };
    } else {
      jobQueueQueries.markFinished = (...args) => {
        fail();
        return originalFinish(...args);
      };
    }
    // Recovery must not depend on the error logger working either.
    logger.error = () => Promise.reject(new Error('injected logger failure'));
    try {
      const runAt = new Date(Date.now() - 1000).toISOString();
      const first = jobQueueQueries.create({ jobType: 'logs.cleanup', runAt, source: 'manual' });
      const second = jobQueueQueries.create({ jobType: 'logs.cleanup', runAt, source: 'manual' });
      const executed: number[] = [];
      await withStub(
        (job) => {
          executed.push(job.id);
          return Promise.resolve({ status: 'success' });
        },
        () => drainDispatcher()
      );
      assertEquals(executed, [first, second]);
      // A history-write failure no longer ends the run; only the terminal write does.
      assertEquals(jobQueueQueries.getById(first)?.status, failurePoint === 'history' ? 'success' : 'failed');
      assertEquals(jobQueueQueries.getById(second)?.status, 'success');
    } finally {
      jobRunHistoryQueries.create = originalCreate;
      jobQueueQueries.markFinished = originalFinish;
      logger.error = originalError;
    }
  });
}

migratedTest('dispatcher keeps a handler reschedule when the history write fails', async () => {
  const rescheduleAt = new Date(Date.now() + 3_600_000).toISOString();
  const originalCreate = jobRunHistoryQueries.create;
  const originalDebug = logger.debug;
  const originalError = logger.error;
  // Every post-handler logger call fails, too: neither may abort the bookkeeping.
  logger.debug = () => Promise.reject(new Error('injected debug logger failure'));
  logger.error = () => Promise.reject(new Error('injected error logger failure'));
  jobRunHistoryQueries.create = () => {
    throw new Error('injected history failure');
  };
  try {
    const jobId = jobQueueQueries.create({
      jobType: 'logs.cleanup',
      runAt: new Date(Date.now() - 1000).toISOString(),
      source: 'schedule',
    });
    const pending = collect(finishedFor('logs.cleanup'));
    await withStub(
      () => Promise.resolve({ status: 'success', rescheduleAt }),
      () => drainDispatcher()
    );
    const events = await pending;

    // The handler's next slot must survive a failed history insert.
    const row = jobQueueQueries.getById(jobId);
    assertExists(row);
    assertEquals(row.status, 'queued');
    assertEquals(row.runAt, rescheduleAt);
    assertEquals(row.source, 'schedule');

    const finished = singleFinished(events, jobId);
    assertEquals(finished.status, 'queued');
    assertEquals(finished.runStatus, 'success');
    assertEquals(finished.rescheduled, true);
    assertEquals(finished.nextRunAt, rescheduleAt);
  } finally {
    jobRunHistoryQueries.create = originalCreate;
    logger.debug = originalDebug;
    logger.error = originalError;
  }
});

migratedTest('dispatcher contains a claim failure and can drain on its next wake', async () => {
  const originalClaim = jobQueueQueries.claimNextDue;
  jobQueueQueries.claimNextDue = () => {
    throw new Error('injected claim failure');
  };
  try {
    const job = jobQueueQueries.create({
      jobType: 'logs.cleanup',
      runAt: new Date(Date.now() - 1000).toISOString(),
      source: 'manual',
    });
    await drainDispatcher();
    assertEquals(jobQueueQueries.getById(job)?.status, 'queued');
    jobQueueQueries.claimNextDue = originalClaim;
    await withStub(
      () => Promise.resolve({ status: 'success' }),
      () => drainDispatcher()
    );
    assertEquals(jobQueueQueries.getById(job)?.status, 'success');
  } finally {
    jobQueueQueries.claimNextDue = originalClaim;
  }
});

migratedTest('dispatcher retries after its next-wake database lookup fails', async () => {
  const originalNext = jobQueueQueries.getNextQueued;
  const originalTimeout = globalThis.setTimeout;
  const delays: number[] = [];
  jobQueueQueries.getNextQueued = () => {
    throw new Error('injected next-wake failure');
  };
  globalThis.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
    delays.push(delay ?? 0);
    return originalTimeout(handler, delay, ...args);
  }) as typeof setTimeout;
  try {
    await drainDispatcher();
    assertEquals(delays.length, 1);
    assert(delays[0] > 0 && delays[0] <= 60_000, 'must arm a bounded retry timer');
  } finally {
    jobDispatcher.stop();
    jobQueueQueries.getNextQueued = originalNext;
    globalThis.setTimeout = originalTimeout;
  }
});
