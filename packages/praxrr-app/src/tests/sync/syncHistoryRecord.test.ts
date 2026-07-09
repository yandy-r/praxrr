import { assert, assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { syncHistoryQueries } from '$db/queries/syncHistory.ts';
import { syncHistorySettingsQueries } from '$db/queries/syncHistorySettings.ts';
import { deriveSyncHistoryStatus, isSyncHistoryEnabled, recordSyncHistory } from '$sync/syncHistory/record.ts';
import type {
  SyncEntityChange,
  SyncHistoryInput,
  SyncOperationStatus,
  SyncPreviewArrType,
  SyncSectionResult,
  SyncTrigger,
} from '$sync/syncHistory/types.ts';

/**
 * Point the db singleton at a scratch SQLite file under a fresh temp base path,
 * run the full migration chain (so migration 20260710 creates the sync history
 * tables and seeds the settings singleton in its real context), invoke the test
 * body, then tear the connection down. Mirrors driftQueries.test.ts.
 *
 * `sanitizeOps: false` — the failed/partial path fires a strictly
 * fire-and-forget notification whose async send may outlive the test body.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/sync-history-record-${crypto.randomUUID()}`;
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

/**
 * Insert an arr_instances row so sync_history.arr_instance_id has a valid FK
 * target. Names carry a UUID to dodge case-insensitive uniqueness.
 */
function seedInstance(type: SyncPreviewArrType): number {
  const port = type === 'radarr' ? 7878 : type === 'sonarr' ? 8989 : 8686;
  return arrInstancesQueries.create({
    name: `${type}-${crypto.randomUUID()}`,
    type,
    url: `http://localhost:${port}`,
    apiKey: 'test-api-key',
  });
}

function makeChange(section: SyncEntityChange['section'], category: string, name: string): SyncEntityChange {
  return {
    section,
    category,
    entityType: 'custom_format',
    name,
    action: 'update',
    remoteId: 1,
    fields: [{ field: 'score', type: 'changed', current: 100, desired: 250 }],
  };
}

function makeInput(
  instanceId: number,
  arrType: SyncPreviewArrType,
  overrides: Partial<SyncHistoryInput> = {}
): SyncHistoryInput {
  return {
    arrInstanceId: instanceId,
    instanceName: `${arrType}-instance`,
    arrType,
    jobId: null,
    trigger: 'manual',
    triggerEvent: null,
    sectionsAttempted: ['qualityProfiles'],
    status: 'success',
    sectionsRun: 1,
    itemsSynced: 3,
    failureCount: 0,
    sectionResults: [{ section: 'qualityProfiles', status: 'success', itemsSynced: 3, error: null }],
    changes: [makeChange('qualityProfiles', 'customFormats', 'HDR10')],
    error: null,
    startedAt: '2026-07-09T10:00:00.000Z',
    finishedAt: '2026-07-09T10:00:01.000Z',
    durationMs: 1000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Append semantics — the table GROWS (opposite of drift's latest-state upsert).
// ---------------------------------------------------------------------------

migratedTest('recordSyncHistory appends exactly one row and the count grows across N calls', () => {
  const instanceId = seedInstance('radarr');
  assertEquals(syncHistoryQueries.count({}), 0);

  const N = 4;
  for (let i = 1; i <= N; i++) {
    recordSyncHistory(makeInput(instanceId, 'radarr'));
    // Each call appends exactly one row — the count strictly grows.
    assertEquals(syncHistoryQueries.count({}), i);
  }

  assertEquals(syncHistoryQueries.count({}), N);
});

// ---------------------------------------------------------------------------
// Each terminal status persists with the right snapshot, per arr_type.
// ---------------------------------------------------------------------------

migratedTest('recordSyncHistory persists status/trigger/snapshot/error/sectionResults per arr_type', () => {
  const radarrId = seedInstance('radarr');
  const sonarrId = seedInstance('sonarr');
  const lidarrId = seedInstance('lidarr');

  const cases: {
    instanceId: number;
    arrType: SyncPreviewArrType;
    status: SyncOperationStatus;
    trigger: SyncTrigger;
    error: string | null;
    sectionResults: SyncSectionResult[];
    changes: SyncEntityChange[];
  }[] = [
    {
      instanceId: radarrId,
      arrType: 'radarr',
      status: 'success',
      trigger: 'manual',
      error: null,
      sectionResults: [{ section: 'qualityProfiles', status: 'success', itemsSynced: 2, error: null }],
      changes: [makeChange('qualityProfiles', 'customFormats', 'Radarr-CF')],
    },
    {
      instanceId: sonarrId,
      arrType: 'sonarr',
      status: 'partial',
      trigger: 'schedule',
      error: '1 section(s) failed',
      sectionResults: [
        { section: 'qualityProfiles', status: 'success', itemsSynced: 1, error: null },
        { section: 'mediaManagement', status: 'failed', itemsSynced: 0, error: 'boom', failedProfiles: ['HD'] },
      ],
      changes: [makeChange('qualityProfiles', 'qualityProfiles', 'Sonarr-QP')],
    },
    {
      instanceId: lidarrId,
      arrType: 'lidarr',
      status: 'failed',
      trigger: 'system',
      error: 'connection refused',
      sectionResults: [{ section: 'metadataProfiles', status: 'failed', itemsSynced: 0, error: 'connection refused' }],
      changes: [],
    },
    {
      instanceId: radarrId,
      arrType: 'radarr',
      status: 'skipped',
      trigger: 'manual',
      error: null,
      sectionResults: [{ section: 'qualityProfiles', status: 'skipped', itemsSynced: 0, error: null }],
      changes: [],
    },
  ];

  for (const c of cases) {
    recordSyncHistory(
      makeInput(c.instanceId, c.arrType, {
        instanceName: `${c.arrType}-snapshot`,
        status: c.status,
        trigger: c.trigger,
        error: c.error,
        sectionResults: c.sectionResults,
        changes: c.changes,
        failureCount: c.sectionResults.filter((s) => s.status === 'failed').length,
      })
    );
  }

  assertEquals(syncHistoryQueries.count({}), cases.length);

  for (const c of cases) {
    const rows = syncHistoryQueries.searchAll({ instanceId: c.instanceId, status: c.status });
    assertEquals(rows.length, 1);
    const detail = rows[0];
    assertExists(detail);
    // Per-arr_type snapshot: never assume cross-Arr parity.
    assertEquals(detail.arrType, c.arrType);
    assertEquals(detail.arrInstanceId, c.instanceId);
    assertEquals(detail.instanceName, `${c.arrType}-snapshot`);
    assertEquals(detail.status, c.status);
    assertEquals(detail.trigger, c.trigger);
    assertEquals(detail.error, c.error);
    assertEquals(detail.sectionResults, c.sectionResults);
    assertEquals(detail.changes, c.changes);
    assertEquals(detail.entityChangeCount, c.changes.length);
  }
});

// ---------------------------------------------------------------------------
// Never throws — even when the row would violate a DB constraint.
// ---------------------------------------------------------------------------

migratedTest('recordSyncHistory never throws even when the insert would fail', () => {
  const instanceId = seedInstance('radarr');

  // `arr_type` has a CHECK constraint (radarr|sonarr|lidarr). An out-of-domain
  // value makes the INSERT throw; the recorder must swallow it, not propagate.
  const bad = makeInput(instanceId, 'chaptarr' as unknown as SyncPreviewArrType);

  let threw = false;
  try {
    recordSyncHistory(bad);
  } catch {
    threw = true;
  }
  assert(!threw, 'recordSyncHistory must not throw on a failing insert');

  // The failed insert wrote nothing.
  assertEquals(syncHistoryQueries.count({}), 0);

  // A subsequent valid record still works — the recorder is not left wedged.
  recordSyncHistory(makeInput(instanceId, 'radarr'));
  assertEquals(syncHistoryQueries.count({}), 1);
});

// ---------------------------------------------------------------------------
// Gated on the settings enable flag.
// ---------------------------------------------------------------------------

migratedTest('recordSyncHistory records nothing when disabled and isSyncHistoryEnabled reflects the setting', () => {
  const instanceId = seedInstance('radarr');

  // Seeded singleton defaults to enabled.
  assertEquals(isSyncHistoryEnabled(), true);

  // Disable recording via the settings singleton.
  assertEquals(syncHistorySettingsQueries.update({ enabled: false }), true);
  assertEquals(isSyncHistoryEnabled(), false);

  recordSyncHistory(makeInput(instanceId, 'radarr'));
  assertEquals(syncHistoryQueries.count({}), 0);

  // Re-enabling resumes recording.
  assertEquals(syncHistorySettingsQueries.update({ enabled: true }), true);
  assertEquals(isSyncHistoryEnabled(), true);

  recordSyncHistory(makeInput(instanceId, 'radarr'));
  assertEquals(syncHistoryQueries.count({}), 1);
});

function section(status: SyncSectionResult['status'], itemsSynced: number): SyncSectionResult {
  return { section: 'qualityProfiles', status, itemsSynced, error: status === 'failed' ? 'boom' : null };
}

Deno.test('deriveSyncHistoryStatus discriminates partial vs failed on section success, not item count', () => {
  // No sections ran → skipped (regardless of captured changes).
  assertEquals(deriveSyncHistoryStatus(0, 0, []), 'skipped');

  // All sections succeeded → success.
  assertEquals(deriveSyncHistoryStatus(2, 0, [section('success', 3), section('success', 0)]), 'success');

  // Every ran section failed → failed.
  assertEquals(deriveSyncHistoryStatus(1, 1, [section('failed', 0)]), 'failed');

  // Mixed: a zero-item success alongside a failure is PARTIAL (regression guard —
  // total itemsSynced is 0 here, which the old count-based check mislabeled 'failed').
  assertEquals(deriveSyncHistoryStatus(2, 1, [section('success', 0), section('failed', 0)]), 'partial');

  // Mirror: a single failed section reporting items>0 is FAILED, not partial.
  assertEquals(deriveSyncHistoryStatus(1, 1, [section('failed', 5)]), 'failed');
});
