import { assertEquals } from '@std/assert';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import { jobQueueQueries, type CreateJobQueueInput } from '$db/queries/jobQueue.ts';
import { jobRunHistoryQueries } from '$db/queries/jobRunHistory.ts';
import type { JobQueueRecord } from '$jobs/queueTypes.ts';
import { enqueueManualTrashGuideSourceSync } from '$jobs/helpers/trashGuideSyncQueue.ts';

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

function createQueuedJob(
  sourceId: number,
  status: JobQueueRecord['status'],
  runAt: string,
  attempts: number = 0
): JobQueueRecord {
  return {
    id: sourceId + 100,
    jobType: 'trashguide.sync',
    status,
    runAt,
    payload: { sourceId, trigger: 'manual', requestedAt: runAt },
    source: 'manual',
    dedupeKey: `trashguide.sync:${sourceId}`,
    cooldownUntil: null,
    attempts,
    startedAt: status === 'running' ? runAt : null,
    finishedAt: null,
    createdAt: runAt,
    updatedAt: runAt,
  };
}

Deno.test('enqueueManualTrashGuideSourceSync queues new job and notifies dispatcher', () => {
  const restores: Restore[] = [];
  const sourceId = 21;
  const runAt = '2026-02-25T11:00:00.000Z';
  const notified: string[] = [];

  patchTarget(jobQueueQueries, 'getByDedupeKey', (() => undefined) as typeof jobQueueQueries.getByDedupeKey, restores);
  patchTarget(
    jobQueueQueries,
    'upsertScheduled',
    ((_input: CreateJobQueueInput<'trashguide.sync'>) =>
      createQueuedJob(sourceId, 'queued', runAt)) as typeof jobQueueQueries.upsertScheduled,
    restores
  );
  patchTarget(
    jobDispatcher,
    'notifyJobEnqueued',
    ((_runAt: string) => {
      notified.push(_runAt);
    }) as typeof jobDispatcher.notifyJobEnqueued,
    restores
  );

  const result = enqueueManualTrashGuideSourceSync(sourceId);
  if (result.status !== 'queued') {
    throw new Error('Expected queued result');
  }

  assertEquals(result.job.status, 'queued');
  assertEquals(result.job.id, sourceId + 100);
  assertEquals(notified, [runAt]);

  for (const restore of restores.reverse()) {
    restore();
  }
});

Deno.test(
  'enqueueManualTrashGuideSourceSync returns already_running before upsert when existing job is running',
  () => {
    const restores: Restore[] = [];
    const sourceId = 31;
    const runAt = '2026-02-25T12:00:00.000Z';

    const runningJob = createQueuedJob(sourceId, 'running', runAt, 3);
    patchTarget(
      jobQueueQueries,
      'getByDedupeKey',
      (() => runningJob) as typeof jobQueueQueries.getByDedupeKey,
      restores
    );
    patchTarget(
      jobRunHistoryQueries,
      'getByQueueId',
      (() => [
        {
          id: 401,
          queueId: runningJob.id,
          status: 'success',
          startedAt: runAt,
          finishedAt: '2026-02-25T12:00:01.000Z',
          durationMs: 1000,
          error: null,
          output: null,
          evidence: null,
          jobType: 'trashguide.sync',
          createdAt: runAt,
        },
      ]) as typeof jobRunHistoryQueries.getByQueueId,
      restores
    );
    patchTarget(
      jobQueueQueries,
      'upsertScheduled',
      (() => {
        throw new Error('expected no upsert when dedupe key is already running');
      }) as typeof jobQueueQueries.upsertScheduled,
      restores
    );
    patchTarget(
      jobQueueQueries,
      'getById',
      ((id: number) => (id === runningJob.id ? runningJob : undefined)) as typeof jobQueueQueries.getById,
      restores
    );

    const result = enqueueManualTrashGuideSourceSync(sourceId);
    if (result.status !== 'already_running') {
      throw new Error('Expected already_running result');
    }

    assertEquals(result.run.current.status, 'running');
    assertEquals(result.run.current.runAt, runAt);
    assertEquals(result.run.current.attempts, 3);
    assertEquals(result.run.latestRun?.id, 401);

    for (const restore of restores.reverse()) {
      restore();
    }
  }
);

Deno.test(
  'enqueueManualTrashGuideSourceSync returns already_running after upsert race when queued record flips to running',
  () => {
    const restores: Restore[] = [];
    const sourceId = 41;
    const runAt = '2026-02-25T13:00:00.000Z';

    const queuedJob = createQueuedJob(sourceId, 'queued', runAt, 1);
    const runningJob = createQueuedJob(sourceId, 'running', runAt, 2);
    patchTarget(
      jobQueueQueries,
      'getByDedupeKey',
      (() => queuedJob) as typeof jobQueueQueries.getByDedupeKey,
      restores
    );
    patchTarget(
      jobQueueQueries,
      'upsertScheduled',
      (() => runningJob) as typeof jobQueueQueries.upsertScheduled,
      restores
    );
    patchTarget(
      jobQueueQueries,
      'getById',
      ((id: number) => (id === runningJob.id ? runningJob : undefined)) as typeof jobQueueQueries.getById,
      restores
    );
    patchTarget(
      jobRunHistoryQueries,
      'getByQueueId',
      (() => [
        {
          id: 501,
          queueId: runningJob.id,
          status: 'failure',
          startedAt: '2026-02-25T12:59:00.000Z',
          finishedAt: '2026-02-25T12:59:10.000Z',
          durationMs: 10000,
          error: 'collision',
          output: null,
          evidence: null,
          jobType: 'trashguide.sync',
          createdAt: runAt,
        },
      ]) as typeof jobRunHistoryQueries.getByQueueId,
      restores
    );
    patchTarget(
      jobDispatcher,
      'notifyJobEnqueued',
      (() => {
        throw new Error('did not expect dispatcher notification when upsert resolves to running');
      }) as typeof jobDispatcher.notifyJobEnqueued,
      restores
    );

    const result = enqueueManualTrashGuideSourceSync(sourceId);
    if (result.status !== 'already_running') {
      throw new Error('Expected already_running result');
    }

    assertEquals(result.run.current.status, 'running');
    assertEquals(result.run.latestRun?.status, 'failure');
    assertEquals(result.run.latestRun?.error, 'collision');

    for (const restore of restores.reverse()) {
      restore();
    }
  }
);

Deno.test(
  'enqueueManualTrashGuideSourceSync returns run metadata with null latestRun when run history is absent',
  () => {
    const restores: Restore[] = [];
    const sourceId = 51;
    const runAt = '2026-02-25T14:00:00.000Z';
    const queuedJob = createQueuedJob(sourceId, 'queued', runAt, 0);
    const runningJob = createQueuedJob(sourceId, 'running', runAt, 1);

    patchTarget(
      jobQueueQueries,
      'getByDedupeKey',
      (() => queuedJob) as typeof jobQueueQueries.getByDedupeKey,
      restores
    );
    patchTarget(
      jobQueueQueries,
      'upsertScheduled',
      (() => runningJob) as typeof jobQueueQueries.upsertScheduled,
      restores
    );
    patchTarget(
      jobQueueQueries,
      'getById',
      ((id: number) => (id === runningJob.id ? runningJob : undefined)) as typeof jobQueueQueries.getById,
      restores
    );
    patchTarget(jobRunHistoryQueries, 'getByQueueId', (() => []) as typeof jobRunHistoryQueries.getByQueueId, restores);

    const result = enqueueManualTrashGuideSourceSync(sourceId);
    if (result.status !== 'already_running') {
      throw new Error('Expected already_running result');
    }

    assertEquals(result.run.latestRun, null);

    for (const restore of restores.reverse()) {
      restore();
    }
  }
);
