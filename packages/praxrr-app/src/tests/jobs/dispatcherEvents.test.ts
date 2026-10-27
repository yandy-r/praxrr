import { assert, assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { jobQueueQueries } from '$db/queries/jobQueue.ts';
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
      assertEquals(finished.status, 'queued');
      assertEquals(finished.nextRunAt, rescheduleAt);

      const row = jobQueueQueries.getById(job.id);
      assertExists(row);
      assertEquals(row.status, 'queued');
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
