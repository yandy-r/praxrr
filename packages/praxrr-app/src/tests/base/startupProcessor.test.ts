import { assertEquals } from '@std/assert';
import { arrSyncQueries } from '../../lib/server/db/queries/arrSync.ts';
import { jobDispatcher } from '../../lib/server/jobs/dispatcher.ts';
import { jobQueueQueries } from '../../lib/server/db/queries/jobQueue.ts';
import {
  isStartupPullInstanceActive,
  markInstanceStartupPullActive,
  markInstanceStartupPullComplete,
  triggerSyncs,
} from '../../lib/server/sync/processor.ts';
import { processInstance } from '../../lib/server/pull/startup/orchestrator.ts';
import type { ArrInstance } from '../../lib/server/db/queries/arrInstances.ts';
import type { JobQueueRecord } from '../../lib/server/jobs/queueTypes.ts';

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

Deno.test('startup pull active instance set tracks active instance IDs', () => {
  const instanceId = 111;

  markInstanceStartupPullActive(instanceId);
  assertEquals(isStartupPullInstanceActive(instanceId), true);
  markInstanceStartupPullComplete(instanceId);
  assertEquals(isStartupPullInstanceActive(instanceId), false);
});

Deno.test('startup pull processInstance clears active flag in finally when processing throws', async () => {
  const instance = {
    id: 222,
    name: 'radarr-main',
    type: 'radarr',
    url: 'http://radarr.local',
    external_url: null,
    api_key_fingerprint: 'fingerprint',
    source: 'ui',
    enabled: 1,
    tags: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as ArrInstance;

  const input = {
    instanceId: 222,
    instanceName: 'radarr-main',
    arrType: 'radarr' as const,
    url: 'http://radarr.local',
    databaseIds: [1],
  };

  const result = await processInstance(instance, input, undefined, () => {
    throw new Error('boom');
  });

  assertEquals(result.status, 'failure');
  assertEquals(result.failed, 1);
  assertEquals(isStartupPullInstanceActive(222), false);
});

Deno.test('triggerSyncs skips instances marked active in startup pull', async () => {
  const restores: Restore[] = [];
  const scheduledCalls: Array<{ jobType: string; payload: { instanceId: number } }> = [];
  const setPendingCalls: string[] = [];

  patchTarget(arrSyncQueries, 'getInstanceIdsForTrigger', (_event: 'on_pull' | 'on_change') => [501, 502], restores);

  const syncStatus = {
    trigger: 'on_pull' as const,
    cron: null,
    nextRunAt: null,
    syncStatus: 'pending' as const,
  };

  patchTarget(
    arrSyncQueries,
    'getSyncConfigStatus',
    () => ({
      qualityProfiles: syncStatus,
      delayProfiles: syncStatus,
      mediaManagement: syncStatus,
      metadataProfiles: syncStatus,
    }),
    restores
  );

  patchTarget(
    jobQueueQueries,
    'upsertScheduled',
    (job) => {
      scheduledCalls.push({
        jobType: job.jobType,
        payload: job.payload as { instanceId: number },
      });

      return {
        id: 1,
        jobType: job.jobType,
        status: 'queued',
        runAt: '2026-01-01T00:00:00Z',
        payload: (job.payload ?? {}) as JobQueueRecord['payload'],
        source: job.source ?? 'system',
        dedupeKey: job.dedupeKey ?? null,
        cooldownUntil: job.cooldownUntil ?? null,
        attempts: 0,
        startedAt: null,
        finishedAt: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };
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
      setPendingCalls.push(`quality:${instanceId}`);
    },
    restores
  );
  patchTarget(
    arrSyncQueries,
    'setDelayProfilesStatusPending',
    (instanceId: number) => {
      setPendingCalls.push(`delay:${instanceId}`);
    },
    restores
  );
  patchTarget(
    arrSyncQueries,
    'setMediaManagementStatusPending',
    (instanceId: number) => {
      setPendingCalls.push(`media:${instanceId}`);
    },
    restores
  );
  patchTarget(
    arrSyncQueries,
    'setMetadataProfilesStatusPending',
    (instanceId: number) => {
      setPendingCalls.push(`metadata:${instanceId}`);
    },
    restores
  );

  markInstanceStartupPullActive(501);

  try {
    await triggerSyncs({ event: 'on_pull', databaseId: 1 });

    assertEquals(
      scheduledCalls.every((entry) => entry.payload.instanceId !== 501),
      true
    );
    assertEquals(
      scheduledCalls.every((entry) => entry.payload.instanceId === 502),
      true
    );
    assertEquals(scheduledCalls.length, 4);
    assertEquals(
      setPendingCalls.sort().join(','),
      ['delay:502', 'metadata:502', 'media:502', 'quality:502'].sort().join(',')
    );
  } finally {
    markInstanceStartupPullComplete(501);
    for (const restore of restores.reverse()) restore();
  }
});
