import { assert, assertEquals, assertExists, assertStringIncludes } from '@std/assert';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import type { RenameSettings } from '$db/queries/arrRenameSettings.ts';
import { arrRenameSettingsQueries } from '$db/queries/arrRenameSettings.ts';
import { upgradeConfigsQueries } from '$db/queries/upgradeConfigs.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';
import type { JobHandler, JobQueueRecord, JobSource, JobType } from '$jobs/queueTypes.ts';
import type { FilterConfig, UpgradeConfig } from '$shared/upgrades/filters.ts';
import { arrInstanceCredentialsQueries } from '$db/queries/arrInstanceCredentials.ts';
import { logger } from '$logger/logger.ts';

// Side-effect imports register the 'arr.rename' and 'arr.upgrade' handlers.
import '$jobs/handlers/arrRename.ts';
import '$jobs/handlers/arrUpgrade.ts';

// ============================================================================
// Evidence branches and recurring failure recovery for arr.rename / arr.upgrade.
// Query/logger methods are restored after each test; no database or network is used.
// ============================================================================

function getHandler(jobType: 'arr.rename' | 'arr.upgrade'): JobHandler {
  const handler = jobQueueRegistry.get(jobType);
  assertExists(handler, `${jobType} handler should be registered`);
  return handler;
}

function createInstance(id: number, type: ArrInstance['type']): ArrInstance {
  const now = new Date().toISOString();
  return {
    id,
    name: `${type}-${id}`,
    type,
    external_url: null,
    url: 'http://127.0.0.1:8989',
    api_key: `${type}-key`,
    api_key_fingerprint: null,
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

function createEnabledFilter(id: string): FilterConfig {
  return {
    id,
    name: `filter-${id}`,
    enabled: true,
    group: { type: 'group', match: 'all', children: [] },
    selector: 'newest',
    count: 1,
    cutoff: 1,
  };
}

function createUpgradeConfig(instanceId: number, overrides: Partial<UpgradeConfig> = {}): UpgradeConfig {
  const now = new Date().toISOString();
  return {
    id: instanceId,
    arrInstanceId: instanceId,
    enabled: true,
    dryRun: true,
    schedule: 60,
    filterMode: 'round_robin',
    filters: [],
    currentFilterIndex: 0,
    lastRunAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
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

// ============================================================================
// arr.rename — evidence branches
// ============================================================================

Deno.test('arr.rename: non-finite instanceId returns failure with invalidPayload evidence', async () => {
  const handler = getHandler('arr.rename');

  // NaN instanceId short-circuits before any query lookup — no mocking required.
  const result = await handler(createJob('arr.rename', Number.NaN, 'manual'));

  assertEquals(result.status, 'failure');
  assert(result.status === 'failure');
  assertEquals(result.failureCode, 'invalidPayload');
});

Deno.test('arr.rename: disabled rename settings on a radarr instance returns cancelled decision', async () => {
  const handler = getHandler('arr.rename');

  const originalGetById = arrInstancesQueries.getById;
  const originalGetRenameSettings = arrRenameSettingsQueries.getByInstanceId;

  arrInstancesQueries.getById = () => createInstance(301, 'radarr');
  // Disabled settings -> handler cancels before reaching processRenameConfig.
  arrRenameSettingsQueries.getByInstanceId = (instanceId: number) => createRenameSettings(instanceId, false);

  try {
    const result = await handler(createJob('arr.rename', 301, 'manual'));

    assertEquals(result.status, 'cancelled');
    assert(result.status !== 'failure');
    assertEquals(result.decision, 'Rename config disabled');
  } finally {
    arrInstancesQueries.getById = originalGetById;
    arrRenameSettingsQueries.getByInstanceId = originalGetRenameSettings;
  }
});

// ============================================================================
// arr.upgrade — evidence branches
// ============================================================================

Deno.test('arr.upgrade: non-finite instanceId returns failure with invalidPayload evidence', async () => {
  const handler = getHandler('arr.upgrade');

  const result = await handler(createJob('arr.upgrade', Number.NaN, 'manual'));

  assertEquals(result.status, 'failure');
  assert(result.status === 'failure');
  assertEquals(result.failureCode, 'invalidPayload');
});

Deno.test('arr.upgrade: missing instance returns failure with targetNotFound evidence', async () => {
  const handler = getHandler('arr.upgrade');

  const originalGetById = arrInstancesQueries.getById;

  arrInstancesQueries.getById = () => undefined;

  try {
    const result = await handler(createJob('arr.upgrade', 999, 'manual'));

    assertEquals(result.status, 'failure');
    assert(result.status === 'failure');
    assertEquals(result.failureCode, 'targetNotFound');
  } finally {
    arrInstancesQueries.getById = originalGetById;
  }
});

Deno.test('arr.upgrade: manual run against a non-dry-run config fails the Dry Run precondition', async () => {
  const handler = getHandler('arr.upgrade');

  const originalGetById = arrInstancesQueries.getById;
  const originalGetUpgradeConfig = upgradeConfigsQueries.getByArrInstanceId;
  // The precondition only trips when we are NOT running in the dev channel.
  const originalChannel = Deno.env.get('VITE_CHANNEL');
  Deno.env.set('VITE_CHANNEL', 'production');

  arrInstancesQueries.getById = () => createInstance(302, 'radarr');
  upgradeConfigsQueries.getByArrInstanceId = (instanceId: number) =>
    createUpgradeConfig(instanceId, {
      enabled: true,
      dryRun: false,
      filters: [createEnabledFilter('f1')],
      filterMode: 'round_robin',
      schedule: 60,
      lastRunAt: null,
    });

  try {
    const result = await handler(createJob('arr.upgrade', 302, 'manual'));

    assertEquals(result.status, 'failure');
    assert(result.status === 'failure');
    assertEquals(result.failureCode, 'precondition');
    assertExists(result.decision);
    assertStringIncludes(result.decision, 'Dry Run');
  } finally {
    arrInstancesQueries.getById = originalGetById;
    upgradeConfigsQueries.getByArrInstanceId = originalGetUpgradeConfig;
    if (originalChannel === undefined) {
      Deno.env.delete('VITE_CHANNEL');
    } else {
      Deno.env.set('VITE_CHANNEL', originalChannel);
    }
  }
});

Deno.test('arr.upgrade: disabled upgrade config on a radarr instance returns cancelled decision', async () => {
  const handler = getHandler('arr.upgrade');

  const originalGetById = arrInstancesQueries.getById;
  const originalGetUpgradeConfig = upgradeConfigsQueries.getByArrInstanceId;

  arrInstancesQueries.getById = () => createInstance(303, 'radarr');
  // Disabled config -> handler cancels before reaching processUpgradeConfig.
  upgradeConfigsQueries.getByArrInstanceId = (instanceId: number) =>
    createUpgradeConfig(instanceId, { enabled: false });

  try {
    const result = await handler(createJob('arr.upgrade', 303, 'schedule'));

    assertEquals(result.status, 'cancelled');
    assert(result.status !== 'failure');
    assertEquals(result.decision, 'Upgrade config disabled');
  } finally {
    arrInstancesQueries.getById = originalGetById;
    upgradeConfigsQueries.getByArrInstanceId = originalGetUpgradeConfig;
  }
});

for (const source of ['schedule', 'manual'] as const) {
  for (const jobType of ['arr.rename', 'arr.upgrade'] as const) {
    Deno.test(`${jobType}: thrown processor failure recurrence: ${source}`, async () => {
      const originalGetById = arrInstancesQueries.getById;
      const originalGetRenameSettings = arrRenameSettingsQueries.getByInstanceId;
      const originalGetUpgradeConfig = upgradeConfigsQueries.getByArrInstanceId;
      const originalGetCredentials = arrInstanceCredentialsQueries.getByInstanceId;
      const originalUpdateRenameLastRun = arrRenameSettingsQueries.updateLastRun;
      const originalUpdateUpgradeLastRun = upgradeConfigsQueries.updateLastRun;
      const originalDebug = logger.debug;
      const originalError = logger.error;
      let processorReached = false;
      let lastRunUpdates = 0;

      arrInstancesQueries.getById = () => createInstance(304, 'radarr');
      arrRenameSettingsQueries.getByInstanceId = (id) => createRenameSettings(id, true);
      upgradeConfigsQueries.getByArrInstanceId = (id) =>
        createUpgradeConfig(id, { filters: [createEnabledFilter('f1')] });
      arrRenameSettingsQueries.updateLastRun = () => {
        lastRunUpdates++;
      };
      upgradeConfigsQueries.updateLastRun = () => {
        lastRunUpdates++;
      };
      logger.error = async () => {};
      // Both are processor-entry dependencies outside their internal catch blocks:
      // rename logs its start; upgrade acquires its authenticated Arr client.
      logger.debug = async () => {
        if (jobType === 'arr.rename') {
          processorReached = true;
          throw new Error('Processor start unavailable');
        }
      };
      arrInstanceCredentialsQueries.getByInstanceId = () => {
        processorReached = true;
        throw new Error('Credential storage unavailable');
      };

      try {
        const earliest = Date.now() + 60 * 60_000;
        const result = await getHandler(jobType)(createJob(jobType, 304, source));

        assert(processorReached, 'The real processor must be reached before the injected failure');
        assert(result.status === 'failure');
        assertEquals(lastRunUpdates, 0, 'Thrown processing must not update lastRunAt');
        if (source === 'schedule') {
          assertExists(result.rescheduleAt);
          const next = Date.parse(result.rescheduleAt);
          assert(next >= earliest, 'Retry must wait for the configured normal interval');
          assert(next <= Date.now() + 60 * 60_000);
        } else {
          assertEquals(result.rescheduleAt, undefined);
        }
      } finally {
        arrInstancesQueries.getById = originalGetById;
        arrRenameSettingsQueries.getByInstanceId = originalGetRenameSettings;
        upgradeConfigsQueries.getByArrInstanceId = originalGetUpgradeConfig;
        arrInstanceCredentialsQueries.getByInstanceId = originalGetCredentials;
        arrRenameSettingsQueries.updateLastRun = originalUpdateRenameLastRun;
        upgradeConfigsQueries.updateLastRun = originalUpdateUpgradeLastRun;
        logger.debug = originalDebug;
        logger.error = originalError;
      }
    });
  }
}

for (const jobType of ['arr.rename', 'arr.upgrade'] as const) {
  Deno.test(`${jobType}: invalid scheduled payload and deleted instance stop recurrence`, async () => {
    const originalGetById = arrInstancesQueries.getById;
    arrInstancesQueries.getById = () => undefined;
    try {
      for (const [instanceId, failureCode] of [
        [Number.NaN, 'invalidPayload'],
        [999, 'targetNotFound'],
      ] as const) {
        const result = await getHandler(jobType)(createJob(jobType, instanceId, 'schedule'));
        assert(result.status === 'failure');
        assertEquals(result.failureCode, failureCode);
        assertEquals(result.rescheduleAt, undefined);
      }
    } finally {
      arrInstancesQueries.getById = originalGetById;
    }
  });
}
