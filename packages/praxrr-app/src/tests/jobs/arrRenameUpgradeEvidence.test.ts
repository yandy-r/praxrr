import { assert, assertEquals, assertExists, assertStringIncludes } from '@std/assert';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import type { RenameSettings } from '$db/queries/arrRenameSettings.ts';
import { arrRenameSettingsQueries } from '$db/queries/arrRenameSettings.ts';
import { upgradeConfigsQueries } from '$db/queries/upgradeConfigs.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';
import type { JobHandler, JobQueueRecord, JobSource, JobType } from '$jobs/queueTypes.ts';
import type { FilterConfig, UpgradeConfig } from '$shared/upgrades/filters.ts';

// Side-effect imports register the 'arr.rename' and 'arr.upgrade' handlers.
import '$jobs/handlers/arrRename.ts';
import '$jobs/handlers/arrUpgrade.ts';

// ============================================================================
// This suite covers the CLEANLY-TESTABLE early-return evidence branches of the
// arr.rename / arr.upgrade handlers (issue #237, AC #5): the branches that emit
// typed safe evidence (failureCode / decision) WITHOUT reaching the
// non-mockable processRenameConfig / processUpgradeConfig direct-function
// imports. Every branch here short-circuits before the processor call, so the
// handlers only touch the swappable query objects below — no real DB needed.
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
