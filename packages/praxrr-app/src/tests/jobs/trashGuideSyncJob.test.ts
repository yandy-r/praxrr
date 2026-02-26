import { assertEquals, assertExists } from '@std/assert';
import { type CreateJobQueueInput, jobQueueQueries } from '$db/queries/jobQueue.ts';
import { type TrashGuideSource, trashGuideSourcesQueries } from '$db/queries/trashGuideSources.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import { scheduleTrashGuideSyncJobs } from '$jobs/schedule.ts';
import type { JobQueueRecord } from '$jobs/queueTypes.ts';

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
    enabled?: 0 | 1;
    syncStrategy?: number;
    lastSyncedAt?: string | null;
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
    auto_pull: 1,
    enabled: options.enabled ?? 1,
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
        enabled: 0,
        syncStrategy: 60,
      }),
      createSourceFixture(72, {
        arrType: 'sonarr',
        enabled: 1,
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
