import { assertEquals, assertExists } from '@std/assert';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import type { RenameSettings } from '$db/queries/arrRenameSettings.ts';
import { arrRenameSettingsQueries } from '$db/queries/arrRenameSettings.ts';
import { upgradeConfigsQueries } from '$db/queries/upgradeConfigs.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';
import type { JobQueueRecord, JobSource, JobType } from '$jobs/queueTypes.ts';
import type { UpgradeConfig } from '$shared/upgrades/filters.ts';

import '$jobs/handlers/arrRename.ts';
import '$jobs/handlers/arrUpgrade.ts';

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

function createRenameSettings(instanceId: number, enabled: boolean): RenameSettings {
  const now = new Date().toISOString();
  return {
    id: instanceId,
    arrInstanceId: instanceId,
    dryRun: true,
    renameFolders: false,
    ignoreTag: null,
    summaryNotifications: true,
    enabled,
    schedule: 60,
    lastRunAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function createUpgradeConfig(instanceId: number, enabled: boolean): UpgradeConfig {
  const now = new Date().toISOString();
  return {
    id: instanceId,
    arrInstanceId: instanceId,
    enabled,
    dryRun: true,
    schedule: 60,
    filterMode: 'round_robin',
    filters: [],
    currentFilterIndex: 0,
    lastRunAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function createJob(jobType: JobType, instanceId: number, source: JobSource): JobQueueRecord {
  const now = new Date().toISOString();
  return {
    id: instanceId,
    jobType,
    status: 'queued',
    runAt: now,
    payload: { instanceId },
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

Deno.test(
  'rename/upgrade handlers: lidarr capability gates stay explicit and mixed-arr behavior remains stable',
  async () => {
    const renameHandler = jobQueueRegistry.get('arr.rename');
    const upgradeHandler = jobQueueRegistry.get('arr.upgrade');
    assertExists(renameHandler);
    assertExists(upgradeHandler);

    const instances = new Map<number, ArrInstance>([
      [201, createInstance(201, 'lidarr')],
      [202, createInstance(202, 'radarr')],
      [203, createInstance(203, 'sonarr')],
    ]);

    const originalGetById = arrInstancesQueries.getById;
    const originalGetRenameSettings = arrRenameSettingsQueries.getByInstanceId;
    const originalGetUpgradeConfig = upgradeConfigsQueries.getByArrInstanceId;

    arrInstancesQueries.getById = (id: number) => instances.get(id);
    arrRenameSettingsQueries.getByInstanceId = (instanceId: number) =>
      createRenameSettings(instanceId, instanceId === 201);
    upgradeConfigsQueries.getByArrInstanceId = (instanceId: number) =>
      createUpgradeConfig(instanceId, instanceId === 201);

    try {
      const lidarrRenameResult = await renameHandler(createJob('arr.rename', 201, 'manual'));
      assertEquals(lidarrRenameResult.status, 'skipped');
      assertEquals(lidarrRenameResult.output, 'Rename is not supported for Lidarr in v1.');

      const lidarrUpgradeResult = await upgradeHandler(createJob('arr.upgrade', 201, 'manual'));
      assertEquals(lidarrUpgradeResult.status, 'skipped');
      assertEquals(lidarrUpgradeResult.output, 'Upgrades are not supported for Lidarr in v1.');

      for (const supportedId of [202, 203]) {
        const supportedRenameResult = await renameHandler(createJob('arr.rename', supportedId, 'manual'));
        assertEquals(supportedRenameResult.status, 'cancelled');
        assertEquals(supportedRenameResult.output, 'Rename config disabled');

        const supportedUpgradeResult = await upgradeHandler(createJob('arr.upgrade', supportedId, 'schedule'));
        assertEquals(supportedUpgradeResult.status, 'cancelled');
        assertEquals(supportedUpgradeResult.output, 'Upgrade config disabled');
      }
    } finally {
      arrInstancesQueries.getById = originalGetById;
      arrRenameSettingsQueries.getByInstanceId = originalGetRenameSettings;
      upgradeConfigsQueries.getByArrInstanceId = originalGetUpgradeConfig;
    }
  }
);
