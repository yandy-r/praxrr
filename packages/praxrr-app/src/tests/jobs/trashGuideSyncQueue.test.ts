import { assert, assertEquals } from '@std/assert';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import { jobQueueQueries, type CreateJobQueueInput } from '$db/queries/jobQueue.ts';
import { jobRunHistoryQueries } from '$db/queries/jobRunHistory.ts';
import { trashGuideSourcesQueries, type TrashGuideSource } from '$db/queries/trashGuideSources.ts';
import type { JobQueueRecord, TrashGuideSyncJobPayload, TrashGuideSyncRunEvidence } from '$jobs/queueTypes.ts';
import { enqueueManualTrashGuideSourceSync, getTrashGuideSyncStatus } from '$jobs/helpers/trashGuideSyncQueue.ts';

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
  payloadExtras: Partial<TrashGuideSyncJobPayload> = {},
  attempts: number = 0
): JobQueueRecord {
  return {
    id: sourceId + 100,
    jobType: 'trashguide.sync',
    status,
    runAt,
    payload: { sourceId, trigger: 'manual', requestedAt: runAt, ...payloadExtras },
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

/** Durable identity snapshot the new code reads via `trashGuideSourcesQueries.getById`. */
function createSource(id: number): TrashGuideSource {
  return {
    id,
    name: `Src ${id}`,
    repository_url: `https://example.test/trash-${id}.git`,
    branch: 'master',
    local_path: `/tmp/trash-${id}`,
    arr_type: 'radarr',
    score_profile: 'default',
    sync_strategy: 60,
    auto_pull: true,
    enabled: true,
    last_synced_at: null,
    last_commit_hash: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

Deno.test('enqueueManualTrashGuideSourceSync mints a fresh run token, snapshots identity, and notifies', () => {
  const restores: Restore[] = [];
  const sourceId = 21;
  const notified: string[] = [];
  const captured: CreateJobQueueInput<'trashguide.sync'>[] = [];
  let slot: JobQueueRecord | undefined;

  patchTarget(jobQueueQueries, 'getByDedupeKey', (() => slot) as typeof jobQueueQueries.getByDedupeKey, restores);
  patchTarget(
    jobQueueQueries,
    'upsertScheduled',
    ((input: CreateJobQueueInput<'trashguide.sync'>) => {
      captured.push(input);
      slot = createQueuedJob(sourceId, 'queued', input.runAt, input.payload ?? {});
      return slot;
    }) as typeof jobQueueQueries.upsertScheduled,
    restores
  );
  patchTarget(jobRunHistoryQueries, 'getByQueueId', (() => []) as typeof jobRunHistoryQueries.getByQueueId, restores);
  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    ((id: number) => createSource(id)) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  patchTarget(
    jobDispatcher,
    'notifyJobEnqueued',
    ((runAt: string) => {
      notified.push(runAt);
    }) as typeof jobDispatcher.notifyJobEnqueued,
    restores
  );

  const result = enqueueManualTrashGuideSourceSync(sourceId);

  assertEquals(result.status, 'queued');
  assert(typeof result.runToken === 'string' && result.runToken.length > 0);
  assertEquals(captured.length, 1);
  assertEquals(captured[0]?.payload?.runToken, result.runToken);
  assertEquals(captured[0]?.payload?.sourceName, 'Src 21');
  assertEquals(captured[0]?.payload?.sourceArrType, 'radarr');
  assertEquals(notified.length, 1);

  for (const restore of restores.reverse()) {
    restore();
  }
});

Deno.test('enqueueManualTrashGuideSourceSync coalesces re-clicks onto the queued slot run token', () => {
  const restores: Restore[] = [];
  const sourceId = 22;
  const runAt = '2026-02-25T17:00:00.000Z';
  const captured: CreateJobQueueInput<'trashguide.sync'>[] = [];
  let slot: JobQueueRecord | undefined = createQueuedJob(sourceId, 'queued', runAt, { runToken: 'tok-A' });

  patchTarget(jobQueueQueries, 'getByDedupeKey', (() => slot) as typeof jobQueueQueries.getByDedupeKey, restores);
  patchTarget(
    jobQueueQueries,
    'upsertScheduled',
    ((input: CreateJobQueueInput<'trashguide.sync'>) => {
      captured.push(input);
      slot = createQueuedJob(sourceId, 'queued', input.runAt, input.payload ?? {});
      return slot;
    }) as typeof jobQueueQueries.upsertScheduled,
    restores
  );
  patchTarget(jobRunHistoryQueries, 'getByQueueId', (() => []) as typeof jobRunHistoryQueries.getByQueueId, restores);
  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    ((id: number) => createSource(id)) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  patchTarget(jobDispatcher, 'notifyJobEnqueued', (() => {}) as typeof jobDispatcher.notifyJobEnqueued, restores);

  const result = enqueueManualTrashGuideSourceSync(sourceId);

  assertEquals(result.status, 'queued');
  assertEquals(result.runToken, 'tok-A');
  assertEquals(captured.length, 1);
  assertEquals(captured[0]?.payload?.runToken, 'tok-A');

  for (const restore of restores.reverse()) {
    restore();
  }
});

Deno.test('enqueueManualTrashGuideSourceSync dedupes onto a running slot without upserting or notifying', () => {
  const restores: Restore[] = [];
  const sourceId = 23;
  const runAt = '2026-02-25T18:00:00.000Z';
  const runningSlot = createQueuedJob(sourceId, 'running', runAt, { runToken: 'tok-R' }, 2);

  patchTarget(
    jobQueueQueries,
    'getByDedupeKey',
    (() => runningSlot) as typeof jobQueueQueries.getByDedupeKey,
    restores
  );
  patchTarget(
    jobQueueQueries,
    'upsertScheduled',
    (() => {
      throw new Error('did not expect upsertScheduled when the slot is already running');
    }) as typeof jobQueueQueries.upsertScheduled,
    restores
  );
  patchTarget(jobRunHistoryQueries, 'getByQueueId', (() => []) as typeof jobRunHistoryQueries.getByQueueId, restores);
  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    ((id: number) => createSource(id)) as typeof trashGuideSourcesQueries.getById,
    restores
  );
  patchTarget(
    jobDispatcher,
    'notifyJobEnqueued',
    (() => {
      throw new Error('did not expect a dispatcher notification when the slot is already running');
    }) as typeof jobDispatcher.notifyJobEnqueued,
    restores
  );

  const result = enqueueManualTrashGuideSourceSync(sourceId);

  assertEquals(result.status, 'already_running');
  assertEquals(result.runToken, 'tok-R');
  assertEquals(result.view.current?.status, 'running');

  for (const restore of restores.reverse()) {
    restore();
  }
});

Deno.test('getTrashGuideSyncStatus parses structured run evidence and resolves live identity', () => {
  const restores: Restore[] = [];
  const sourceId = 840;
  const runAt = '2026-02-25T15:00:00.000Z';
  const slot = createQueuedJob(sourceId, 'queued', runAt, {
    runToken: 'tok-A',
    sourceName: 'Snapshot 840',
    sourceArrType: 'radarr',
  });
  const evidence: TrashGuideSyncRunEvidence = {
    schemaVersion: 1,
    runToken: 'tok-A',
    source: { id: sourceId, name: 'Src', arrType: 'radarr' },
    trigger: 'manual',
    requestedAt: runAt,
    status: 'success',
    counts: {
      commitsBehind: 2,
      parsedFiles: 5,
      failedFiles: 0,
      activeOperations: 3,
      removedEntities: 1,
      renamedEntities: 0,
    },
    failure: null,
    retry: { rescheduleAt: null, retryable: false },
  };

  patchTarget(jobQueueQueries, 'getByDedupeKey', (() => slot) as typeof jobQueueQueries.getByDedupeKey, restores);
  patchTarget(
    jobRunHistoryQueries,
    'getByQueueId',
    (() => [
      {
        id: 941,
        queueId: 940,
        jobType: 'trashguide.sync',
        status: 'success',
        startedAt: runAt,
        finishedAt: '2026-02-25T15:00:01.000Z',
        durationMs: 1000,
        error: null,
        output: JSON.stringify(evidence),
        createdAt: runAt,
      },
    ]) as typeof jobRunHistoryQueries.getByQueueId,
    restores
  );
  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    ((id: number) => createSource(id)) as typeof trashGuideSourcesQueries.getById,
    restores
  );

  const view = getTrashGuideSyncStatus(sourceId);

  assertEquals(view.queueId, 940);
  assertEquals(view.sourceName, 'Src 840');
  assertEquals(view.latestRun?.evidence?.runToken, 'tok-A');
  assertEquals(view.latestRun?.evidence?.counts?.parsedFiles, 5);

  for (const restore of restores.reverse()) {
    restore();
  }
});

Deno.test('getTrashGuideSyncStatus falls back to the durable payload snapshot for a deleted source', () => {
  const restores: Restore[] = [];
  const sourceId = 55;
  const runAt = '2026-02-25T16:00:00.000Z';
  const slot = createQueuedJob(sourceId, 'queued', runAt, {
    sourceName: 'Snapshot',
    sourceArrType: 'radarr',
  });

  patchTarget(jobQueueQueries, 'getByDedupeKey', (() => slot) as typeof jobQueueQueries.getByDedupeKey, restores);
  patchTarget(jobRunHistoryQueries, 'getByQueueId', (() => []) as typeof jobRunHistoryQueries.getByQueueId, restores);
  patchTarget(
    trashGuideSourcesQueries,
    'getById',
    (() => undefined) as typeof trashGuideSourcesQueries.getById,
    restores
  );

  const view = getTrashGuideSyncStatus(sourceId);

  assertEquals(view.sourceName, 'Snapshot');
  assertEquals(view.arrType, 'radarr');

  for (const restore of restores.reverse()) {
    restore();
  }
});
