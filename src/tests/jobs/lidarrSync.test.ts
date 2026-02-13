import { assertEquals, assertExists, assertStringIncludes } from '@std/assert';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';
import type { JobQueueRecord, JobSource } from '$jobs/queueTypes.ts';

import '$jobs/handlers/arrSync.ts';

function createInstance(id: number, type: ArrInstance['type']): ArrInstance {
  const now = new Date().toISOString();
  return {
    id,
    name: `${type}-${id}`,
    type,
    url: 'http://127.0.0.1:8989',
    api_key: `${type}-key`,
    tags: null,
    enabled: 1,
    created_at: now,
    updated_at: now,
  };
}

function createSyncJob(instanceId: number, source: JobSource): JobQueueRecord {
  const now = new Date().toISOString();
  return {
    id: instanceId,
    jobType: 'arr.sync',
    status: 'queued',
    runAt: now,
    payload: {
      instanceId,
      section: 'qualityProfiles',
    },
    source,
    dedupeKey: null,
    cooldownUntil: null,
    attempts: 0,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

Deno.test({
  name: 'arr.sync qualityProfiles: lidarr is explicitly unsupported without regressing radarr/sonarr',
  sanitizeResources: false,
  fn: async () => {
    const handler = jobQueueRegistry.get('arr.sync');
    assertExists(handler);

    const instances = new Map<number, ArrInstance>([
      [101, createInstance(101, 'lidarr')],
      [102, createInstance(102, 'radarr')],
      [103, createInstance(103, 'sonarr')],
    ]);

    const originalGetById = arrInstancesQueries.getById;
    const originalGetSyncConfigStatus = arrSyncQueries.getSyncConfigStatus;
    const originalGetNextScheduledRunAt = arrSyncQueries.getNextScheduledRunAt;

    arrInstancesQueries.getById = (id: number) => instances.get(id);
    arrSyncQueries.getSyncConfigStatus = () => ({
      qualityProfiles: {
        trigger: 'manual',
        cron: null,
        nextRunAt: null,
        syncStatus: 'idle',
      },
      delayProfiles: {
        trigger: 'manual',
        cron: null,
        nextRunAt: null,
        syncStatus: 'idle',
      },
      mediaManagement: {
        trigger: 'manual',
        cron: null,
        nextRunAt: null,
        syncStatus: 'idle',
      },
    });
    arrSyncQueries.getNextScheduledRunAt = () => null;

    try {
      const lidarrResult = await handler(createSyncJob(101, 'manual'));
      assertEquals(lidarrResult.status, 'skipped');
      assertStringIncludes(lidarrResult.output ?? '', 'qualityProfiles: skipped (');
      assertStringIncludes(lidarrResult.output ?? '', 'Lidarr quality profile sync is not supported yet');

      for (const supportedId of [102, 103]) {
        const supportedResult = await handler(createSyncJob(supportedId, 'schedule'));
        assertEquals(supportedResult.status, 'skipped');
        assertEquals(supportedResult.output, 'qualityProfiles: skipped');
      }
    } finally {
      arrInstancesQueries.getById = originalGetById;
      arrSyncQueries.getSyncConfigStatus = originalGetSyncConfigStatus;
      arrSyncQueries.getNextScheduledRunAt = originalGetNextScheduledRunAt;
    }
  },
});
