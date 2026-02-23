import { assertEquals } from '@std/assert';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { jobQueueQueries, type CreateJobQueueInput } from '$db/queries/jobQueue.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import { JobQueueRecord } from '$jobs/queueTypes.ts';
import {
  isStartupPullInstanceActive,
  markInstanceStartupPullActive,
  markInstanceStartupPullComplete,
  triggerSyncs,
} from '$sync/processor.ts';

type Restore = () => void;

type SyncStatus = {
  trigger: 'on_pull' | 'manual';
  cron: string | null;
  nextRunAt: string | null;
  syncStatus: string;
};

type SyncConfigStatus = {
  qualityProfiles: SyncStatus;
  delayProfiles: SyncStatus;
  mediaManagement: SyncStatus;
  metadataProfiles: SyncStatus;
};

type TriggerLog = {
  instanceId: number;
  dedupeKey: string;
};

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

function createProfileConfig(overrides: Partial<SyncStatus> = {}): SyncStatus {
  return {
    trigger: 'manual',
    cron: null,
    nextRunAt: null,
    syncStatus: 'pending',
    ...overrides,
  };
}

function createScheduledRecord(input: CreateJobQueueInput): JobQueueRecord {
  return {
    id: 1,
    jobType: input.jobType,
    status: 'queued',
    runAt: input.runAt,
    payload: input.payload ?? {},
    source: input.source ?? 'system',
    dedupeKey: input.dedupeKey ?? null,
    cooldownUntil: input.cooldownUntil ?? null,
    attempts: 0,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function buildAllOnPullStatus(): SyncConfigStatus {
  return {
    qualityProfiles: createProfileConfig({ trigger: 'on_pull' }),
    delayProfiles: createProfileConfig({ trigger: 'on_pull' }),
    mediaManagement: createProfileConfig({ trigger: 'on_pull' }),
    metadataProfiles: createProfileConfig({ trigger: 'on_pull' }),
  };
}

Deno.test('triggerSyncs uses stable dedupe keys across repeated on_pull events', async () => {
  const restores: Restore[] = [];
  const pendingCalls: string[] = [];
  const firstRunKeys: string[] = [];
  const secondRunKeys: string[] = [];

  patchTarget(arrSyncQueries, 'getInstanceIdsForTrigger', () => [801], restores);
  patchTarget(arrSyncQueries, 'getSyncConfigStatus', () => buildAllOnPullStatus(), restores);

  patchTarget(
    jobQueueQueries,
    'upsertScheduled',
    (input: CreateJobQueueInput) => {
      const dedupeKey = input.dedupeKey ?? '';
      const payload = input.payload ?? {};
      const _instanceId = (payload['instanceId'] as number) ?? 0;
      firstRunKeys.push(dedupeKey);
      return createScheduledRecord(input);
    },
    restores
  );
  patchTarget(
    jobDispatcher,
    'notifyJobEnqueued',
    () => {
      return;
    },
    restores
  );

  patchTarget(
    arrSyncQueries,
    'setQualityProfilesStatusPending',
    (instanceId: number) => {
      pendingCalls.push(`quality:${instanceId}`);
    },
    restores
  );
  patchTarget(
    arrSyncQueries,
    'setDelayProfilesStatusPending',
    (instanceId: number) => {
      pendingCalls.push(`delay:${instanceId}`);
    },
    restores
  );
  patchTarget(
    arrSyncQueries,
    'setMediaManagementStatusPending',
    (instanceId: number) => {
      pendingCalls.push(`media:${instanceId}`);
    },
    restores
  );
  patchTarget(
    arrSyncQueries,
    'setMetadataProfilesStatusPending',
    (instanceId: number) => {
      pendingCalls.push(`metadata:${instanceId}`);
    },
    restores
  );

  await triggerSyncs({ event: 'on_pull', databaseId: 10 });

  const firstRunSorted = [...firstRunKeys].sort();
  assertEquals(
    firstRunSorted,
    [
      'arr.sync.delayProfiles:event:801',
      'arr.sync.mediaManagement:event:801',
      'arr.sync.metadataProfiles:event:801',
      'arr.sync.qualityProfiles:event:801',
    ].sort()
  );
  assertEquals(pendingCalls.sort(), ['delay:801', 'media:801', 'metadata:801', 'quality:801'].sort());

  firstRunKeys.length = 0;
  patchTarget(
    jobQueueQueries,
    'upsertScheduled',
    (input: CreateJobQueueInput) => {
      const dedupeKey = input.dedupeKey ?? '';
      const payload = input.payload ?? {};
      const _instanceId = (payload['instanceId'] as number) ?? 0;
      secondRunKeys.push(dedupeKey);
      return createScheduledRecord(input);
    },
    restores
  );
  patchTarget(
    jobDispatcher,
    'notifyJobEnqueued',
    () => {
      return;
    },
    restores
  );

  await triggerSyncs({ event: 'on_pull', databaseId: 10 });

  assertEquals(firstRunKeys.length, 0);
  assertEquals(secondRunKeys.sort(), firstRunSorted);
  assertEquals(
    pendingCalls.sort(),
    [
      'delay:801',
      'media:801',
      'metadata:801',
      'quality:801',
      'delay:801',
      'media:801',
      'metadata:801',
      'quality:801',
    ].sort()
  );

  for (const restore of restores.reverse()) {
    restore();
  }
});

Deno.test('triggerSyncs skips startup-active instances to avoid duplicate enqueue', async () => {
  const restores: Restore[] = [];
  const scheduledCalls: TriggerLog[] = [];

  patchTarget(arrSyncQueries, 'getInstanceIdsForTrigger', () => [901], restores);
  patchTarget(arrSyncQueries, 'getSyncConfigStatus', () => buildAllOnPullStatus(), restores);

  patchTarget(
    jobQueueQueries,
    'upsertScheduled',
    (input: CreateJobQueueInput) => {
      const payload = input.payload ?? {};
      const instanceId = (payload['instanceId'] as number) ?? 0;
      scheduledCalls.push({ instanceId, dedupeKey: input.dedupeKey ?? '' });
      return createScheduledRecord(input);
    },
    restores
  );

  markInstanceStartupPullActive(901);
  try {
    assertEquals(isStartupPullInstanceActive(901), true);

    await triggerSyncs({ event: 'on_pull', databaseId: 10 });

    assertEquals(scheduledCalls.length, 0);
  } finally {
    markInstanceStartupPullComplete(901);
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});
