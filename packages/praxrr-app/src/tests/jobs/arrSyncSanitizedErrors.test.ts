import { assert, assertEquals } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { type ArrInstance, arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { syncHistoryQueries } from '$db/queries/syncHistory.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';
import type { JobQueueRecord, JobSource } from '$jobs/queueTypes.ts';
import { getSection } from '$lib/server/sync/registry.ts';
import type { BaseSyncer, SectionType } from '$lib/server/sync/types.ts';
import { BaseArrClient } from '$arr/base.ts';
import { HttpError } from '$http/types.ts';
import { logger } from '$logger/logger.ts';

// Registers arrSyncHandler ('arr.sync') plus every section handler.
import '$jobs/handlers/arrSync.ts';

/**
 * Mirrors the DB bootstrap in tests/jobs/arrSyncVersionGate.test.ts: scratch SQLite
 * under a temp base path, full migration chain, body, teardown.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/arr-sync-sanitized-errors-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);

      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

type Restore = () => void;

function createRadarrInstanceRow(name: string): number {
  return arrInstancesQueries.create({
    name,
    type: 'radarr',
    url: 'http://127.0.0.1:8989',
    apiKey: 'radarr-key',
  });
}

function baselineSyncConfigStatus() {
  const section = {
    trigger: 'manual' as const,
    cron: null,
    nextRunAt: null,
    syncStatus: 'idle',
  };
  return {
    qualityProfiles: { ...section },
    delayProfiles: { ...section },
    mediaManagement: { ...section },
    metadataProfiles: { ...section },
  };
}

function createQualityProfilesSyncJob(instanceId: number, source: JobSource): JobQueueRecord {
  const now = new Date().toISOString();
  return {
    id: instanceId,
    jobType: 'arr.sync',
    status: 'queued',
    runAt: now,
    payload: { instanceId, section: 'qualityProfiles' as SectionType },
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

const SECRET = 'apikey=sk_live_SECRET123';
const REJECTED_400 = 'The Arr instance rejected the request (HTTP 400).';
const raw = new HttpError('HTTP 400: Bad Request | ' + JSON.stringify({ message: SECRET }), 400, { message: SECRET });

interface LoggedCall {
  source: string;
  meta: Record<string, unknown>;
}

/**
 * Patch the shared singletons the LIVE arrSyncHandler touches (same seams as
 * arrSyncVersionGate's driveHandlerHarness) but make the section syncer the failure
 * vector under test. `failSync` is deliberately NOT stubbed — the test asserts on the
 * persisted `last_error` it writes. Returns captured logger.error meta + restore.
 */
function driveThrowingHarness(syncOutcome: 'throw' | 'return-raw'): {
  logged: LoggedCall[];
  restore: Restore;
} {
  const restores: Restore[] = [];
  const logged: LoggedCall[] = [];

  const originalGetById = arrInstancesQueries.getById;
  arrInstancesQueries.getById = (id: number) => {
    const row = originalGetById(id);
    return row ? ({ ...row, api_key: 'radarr-key' } as ArrInstance) : row;
  };
  restores.push(() => {
    arrInstancesQueries.getById = originalGetById;
  });

  const originalGetSystemStatus = BaseArrClient.prototype.getSystemStatus;
  BaseArrClient.prototype.getSystemStatus = () =>
    Promise.resolve({
      ok: true as const,
      appName: 'Radarr',
      version: '5.14.0.9383',
    });
  restores.push(() => {
    BaseArrClient.prototype.getSystemStatus = originalGetSystemStatus;
  });

  const originalGetSyncConfigStatus = arrSyncQueries.getSyncConfigStatus;
  arrSyncQueries.getSyncConfigStatus = () => baselineSyncConfigStatus();
  restores.push(() => {
    arrSyncQueries.getSyncConfigStatus = originalGetSyncConfigStatus;
  });

  const originalGetQualityProfilesSync = arrSyncQueries.getQualityProfilesSync;
  arrSyncQueries.getQualityProfilesSync = () => ({
    selections: [],
    config: { trigger: 'manual', cron: null },
  });
  restores.push(() => {
    arrSyncQueries.getQualityProfilesSync = originalGetQualityProfilesSync;
  });

  const originalGetNextScheduledRunAt = arrSyncQueries.getNextScheduledRunAt;
  arrSyncQueries.getNextScheduledRunAt = () => null;
  restores.push(() => {
    arrSyncQueries.getNextScheduledRunAt = originalGetNextScheduledRunAt;
  });

  const qpHandler = getSection('qualityProfiles');
  const originalHasConfig = qpHandler.hasConfig;
  const originalSetStatusPending = qpHandler.setStatusPending;
  const originalClaimSync = qpHandler.claimSync;
  const originalCompleteSync = qpHandler.completeSync;
  const originalSetNextRunAt = qpHandler.setNextRunAt;
  const originalCreateSyncer = qpHandler.createSyncer;

  qpHandler.hasConfig = () => true;
  qpHandler.setStatusPending = () => undefined;
  qpHandler.claimSync = () => true;
  qpHandler.completeSync = () => undefined;
  qpHandler.setNextRunAt = () => undefined;
  qpHandler.createSyncer = (_client, _instance) =>
    ({
      sync: async () => {
        if (syncOutcome === 'throw') {
          throw raw;
        }
        return {
          success: false,
          itemsSynced: 0,
          error: raw.message,
          outcomes: [],
        };
      },
      generatePreview: async () => ({
        section: 'qualityProfiles',
        profile: null,
      }),
      setPreviewConfig: () => undefined,
      clearPreviewConfig: () => undefined,
    }) as unknown as BaseSyncer;

  restores.push(() => {
    qpHandler.hasConfig = originalHasConfig;
    qpHandler.setStatusPending = originalSetStatusPending;
    qpHandler.claimSync = originalClaimSync;
    qpHandler.completeSync = originalCompleteSync;
    qpHandler.setNextRunAt = originalSetNextRunAt;
    qpHandler.createSyncer = originalCreateSyncer;
  });

  const originalLoggerError = logger.error;
  logger.error = ((_msg: string, opts?: { source: string; meta?: Record<string, unknown> }) => {
    logged.push({ source: opts?.source ?? '', meta: opts?.meta ?? {} });
    return Promise.resolve();
  }) as typeof logger.error;
  restores.push(() => {
    logger.error = originalLoggerError;
  });

  return {
    logged,
    restore: () => {
      for (const restore of restores.reverse()) {
        restore();
      }
    },
  };
}

async function runJob(instanceId: number) {
  const handler = jobQueueRegistry.get('arr.sync');
  assert(handler !== undefined, 'arr.sync handler must be registered');
  return await handler(createQualityProfilesSyncJob(instanceId, 'manual'));
}

function persistedRows(instanceId: number) {
  const configRow = db.queryFirst<{ last_error: string | null }>(
    'SELECT last_error FROM arr_sync_quality_profiles_config WHERE instance_id = ?',
    instanceId
  );
  const historyRow = db.queryFirst<{ id: number; error: string | null; section_results: string | null }>(
    'SELECT id, error, section_results FROM sync_history WHERE arr_instance_id = ? ORDER BY id DESC LIMIT 1',
    instanceId
  );
  return { configRow, historyRow };
}

migratedTest('arrSyncHandler: a throwing syncer stores only the closed reason everywhere', async () => {
  const id = createRadarrInstanceRow('Radarr Throwing Syncer');
  arrSyncQueries.saveQualityProfilesSync(id, [], {
    trigger: 'manual',
    cron: null,
  });
  arrSyncQueries.setQualityProfilesStatusPending(id);
  const { logged, restore } = driveThrowingHarness('throw');
  try {
    const result = await runJob(id);

    assertEquals(result.status, 'failure');

    const { configRow, historyRow } = persistedRows(id);
    assertEquals(configRow?.last_error, REJECTED_400);
    assert(!JSON.stringify(configRow).includes('SECRET123'), 'last_error must not leak the raw body');

    assert(historyRow !== undefined, 'a sync_history row must be recorded');
    assertEquals(historyRow.error, 'qualityProfiles: failed');
    assert(!String(historyRow.error).includes('SECRET123'));

    const sectionResults = JSON.parse(historyRow.section_results ?? '[]') as Array<{
      error: string | null;
      errorCode?: string | null;
    }>;
    assertEquals(sectionResults[0].error, REJECTED_400);
    assertEquals(sectionResults[0].errorCode, 'rejected');
    assert(!JSON.stringify(sectionResults).includes('SECRET123'), 'section results must not leak');

    // The mapped reader surfaces are sanitized too (list + canary diagnostics path).
    const summary = syncHistoryQueries.search(
      { instanceId: id },
      {
        limit: 5,
        offset: 0,
      }
    )[0];
    assert(summary !== undefined);
    assertEquals(summary.error, 'qualityProfiles: failed');

    const detail = syncHistoryQueries.getById(historyRow.id);
    assert(detail !== undefined);
    assertEquals(detail.sectionResults[0].error, REJECTED_400);
    assertEquals(detail.sectionResults[0].errorCode, 'rejected');

    // Raw detail reached the sanitized logger's protected meta.
    const serializedLogs = JSON.stringify(logged);
    assert(serializedLogs.includes('SECRET123'), 'the raw error must still reach the logger meta');
  } finally {
    restore();
  }
});

migratedTest(
  'arrSyncHandler: a legacy syncer returning raw error text is backstopped to the closed reason',
  async () => {
    const id = createRadarrInstanceRow('Radarr Legacy Syncer');
    arrSyncQueries.saveQualityProfilesSync(id, [], {
      trigger: 'manual',
      cron: null,
    });
    arrSyncQueries.setQualityProfilesStatusPending(id);
    const { restore } = driveThrowingHarness('return-raw');
    try {
      const result = await runJob(id);

      assertEquals(result.status, 'failure');

      const { configRow, historyRow } = persistedRows(id);
      assertEquals(configRow?.last_error, REJECTED_400);
      assert(!JSON.stringify(configRow).includes('SECRET123'), 'last_error must not leak the raw body');

      assert(historyRow !== undefined, 'a sync_history row must be recorded');
      const sectionResults = JSON.parse(historyRow.section_results ?? '[]') as Array<{
        error: string | null;
        errorCode?: string | null;
      }>;
      assertEquals(sectionResults[0].error, REJECTED_400);
      assert(!JSON.stringify(sectionResults).includes('SECRET123'));
    } finally {
      restore();
    }
  }
);

migratedTest("arrSyncHandler: a scheduled section client failure ignores another section's past next run", async () => {
  const id = arrInstancesQueries.create({
    name: 'Radarr Bad URL',
    type: 'radarr',
    url: 'http://169.254.169.254/latest',
    apiKey: 'radarr-key',
  });
  const cron = '0 */6 * * *';
  const pastNextRunAt = new Date(Date.now() - 3_600_000).toISOString();
  arrSyncQueries.saveQualityProfilesSync(id, [], {
    trigger: 'schedule',
    cron,
    nextRunAt: pastNextRunAt,
  });
  arrSyncQueries.saveDelayProfilesSync(id, {
    databaseId: null,
    profileName: null,
    trigger: 'schedule',
    cron,
    nextRunAt: pastNextRunAt,
  });

  const origLoggerError = logger.error;
  logger.error = (() => Promise.resolve()) as typeof logger.error;
  try {
    const syncHandler = jobQueueRegistry.get('arr.sync.qualityProfiles');
    assert(syncHandler !== undefined, 'quality profiles sync handler must be registered');
    const result = await syncHandler({
      ...createQualityProfilesSyncJob(id, 'schedule'),
      jobType: 'arr.sync.qualityProfiles',
    });

    assertEquals(result.status, 'failure');
    const nextRunAt = arrSyncQueries.getSyncConfigStatus(id).qualityProfiles.nextRunAt;
    assert(nextRunAt !== null, 'the scheduled section next_run_at must advance');
    assert(Date.parse(nextRunAt) > Date.now(), 'the section must advance to a future slot');
    assertEquals(
      arrSyncQueries.getNextScheduledRunAt(id),
      pastNextRunAt,
      'the second scheduled section must retain its earlier next_run_at'
    );
    assertEquals(result.rescheduleAt, nextRunAt);
  } finally {
    logger.error = origLoggerError;
  }
});

migratedTest('arrSyncHandler: a combined scheduled client failure uses the earliest section next run', async () => {
  const id = arrInstancesQueries.create({
    name: 'Radarr Combined Bad URL',
    type: 'radarr',
    url: 'http://169.254.169.254/latest',
    apiKey: 'radarr-key',
  });
  const cron = '0 */6 * * *';
  const futureNextRunAt = new Date(Date.now() + 3_600_000).toISOString();
  arrSyncQueries.saveQualityProfilesSync(id, [], {
    trigger: 'schedule',
    cron,
    nextRunAt: futureNextRunAt,
  });
  arrSyncQueries.saveDelayProfilesSync(id, {
    databaseId: null,
    profileName: null,
    trigger: 'schedule',
    cron,
    nextRunAt: futureNextRunAt,
  });

  const origLoggerError = logger.error;
  logger.error = (() => Promise.resolve()) as typeof logger.error;
  try {
    const syncHandler = jobQueueRegistry.get('arr.sync');
    assert(syncHandler !== undefined, 'combined sync handler must be registered');
    const result = await syncHandler(createQualityProfilesSyncJob(id, 'schedule'));

    assertEquals(result.status, 'failure');
    assertEquals(result.rescheduleAt, arrSyncQueries.getNextScheduledRunAt(id));
  } finally {
    logger.error = origLoggerError;
  }
});
