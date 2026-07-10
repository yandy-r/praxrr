import { assert, assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { syncHistoryQueries, type SyncHistoryFilters } from '$db/queries/syncHistory.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import type { SyncEntityChange, SyncHistoryInput, SyncSectionResult } from '$sync/syncHistory/types.ts';

/**
 * Point the db singleton at a scratch SQLite file under a fresh temp base path,
 * run the full migration chain (so migration 20260710 creates the sync_history
 * tables and seeds the settings singleton in its real context), invoke the test
 * body, then tear the connection down. Mirrors driftQueries.test.ts.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/sync-history-queries-${crypto.randomUUID()}`;
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
 * target. A random name dodges case-insensitive uniqueness across seeds.
 */
function seedInstance(type: 'radarr' | 'sonarr' | 'lidarr' = 'radarr'): number {
  return arrInstancesQueries.create({
    name: `${type}-${crypto.randomUUID()}`,
    type,
    url: 'http://localhost:7878',
    apiKey: 'test-api-key',
  });
}

function makeInput(instanceId: number, overrides: Partial<SyncHistoryInput> = {}): SyncHistoryInput {
  return {
    arrInstanceId: instanceId,
    instanceName: 'Radarr Main',
    arrType: 'radarr',
    jobId: 101,
    trigger: 'manual',
    triggerEvent: null,
    sectionsAttempted: ['qualityProfiles', 'mediaManagement'],
    status: 'success',
    sectionsRun: 2,
    itemsSynced: 5,
    failureCount: 0,
    sectionResults: [
      { section: 'qualityProfiles', status: 'success', itemsSynced: 3, error: null },
      { section: 'mediaManagement', status: 'success', itemsSynced: 2, error: null },
    ],
    changes: [],
    entityOutcomes: [],
    previewId: null,
    error: null,
    startedAt: '2026-07-08T10:00:00.000Z',
    finishedAt: '2026-07-08T10:00:05.000Z',
    durationMs: 5000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Schema: columns + CHECK constraints (proves the migration ran + is registered)
// ---------------------------------------------------------------------------

migratedTest('sync_history migration registers all columns via PRAGMA table_info', () => {
  const columns = db.query<{ name: string; type: string; notnull: number; dflt_value: string | null }>(
    'PRAGMA table_info(sync_history)'
  );
  const byName = new Map(columns.map((c) => [c.name, c]));

  const expected = [
    'id',
    'arr_instance_id',
    'instance_name',
    'arr_type',
    'job_id',
    'trigger',
    'trigger_event',
    'sections_attempted',
    'status',
    'sections_run',
    'items_synced',
    'failure_count',
    'entity_change_count',
    'entity_outcome_count',
    'section_results',
    'changes',
    'entity_outcomes',
    'preview_id',
    'error',
    'started_at',
    'finished_at',
    'duration_ms',
    'created_at',
  ];
  for (const name of expected) {
    assert(byName.has(name), `expected sync_history to have column ${name}`);
  }
  assertEquals(byName.size, expected.length);

  // NOT NULL columns per the migration.
  assertEquals(byName.get('instance_name')?.notnull, 1);
  assertEquals(byName.get('arr_type')?.notnull, 1);
  assertEquals(byName.get('status')?.notnull, 1);
  assertEquals(byName.get('started_at')?.notnull, 1);
  // Nullable columns.
  assertEquals(byName.get('arr_instance_id')?.notnull, 0);
  assertEquals(byName.get('job_id')?.notnull, 0);
  assertEquals(byName.get('trigger_event')?.notnull, 0);
  assertEquals(byName.get('finished_at')?.notnull, 0);
});

migratedTest('sync_history CHECK constraints are present in the table DDL', () => {
  const row = db.queryFirst<{ sql: string }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sync_history'"
  );
  assertExists(row);
  const ddl = row.sql;

  assert(ddl.includes("arr_type IN ('radarr', 'sonarr', 'lidarr')"), 'arr_type CHECK missing');
  assert(ddl.includes("trigger IN ('manual', 'schedule', 'system')"), 'trigger CHECK missing');
  assert(
    ddl.includes("trigger_event IN ('on_pull', 'on_change') OR trigger_event IS NULL"),
    'trigger_event CHECK missing'
  );
  assert(ddl.includes("status IN ('success', 'partial', 'failed', 'skipped')"), 'status CHECK missing');
});

migratedTest('sync_history CHECK constraints reject out-of-domain values at the DB boundary', () => {
  const instanceId = seedInstance('radarr');

  // A bad arr_type violates the CHECK and must throw rather than silently store.
  let threw = false;
  try {
    syncHistoryQueries.insert(makeInput(instanceId, { arrType: 'plexarr' as SyncHistoryInput['arrType'] }));
  } catch {
    threw = true;
  }
  assert(threw, 'expected arr_type CHECK violation to throw');

  // A bad status likewise.
  threw = false;
  try {
    syncHistoryQueries.insert(makeInput(instanceId, { status: 'cancelled' as SyncHistoryInput['status'] }));
  } catch {
    threw = true;
  }
  assert(threw, 'expected status CHECK violation to throw');
});

// ---------------------------------------------------------------------------
// insert + getById round-trip
// ---------------------------------------------------------------------------

migratedTest('insert then getById round-trips changes, sectionResults, and sectionsAttempted JSON exactly', () => {
  const instanceId = seedInstance('radarr');

  const changes: SyncEntityChange[] = [
    {
      section: 'qualityProfiles',
      category: 'customFormats',
      entityType: 'custom_format',
      name: 'HDR10',
      action: 'update',
      remoteId: 42,
      fields: [{ field: 'score', type: 'changed', current: 100, desired: 250 }],
    },
    {
      section: 'qualityProfiles',
      category: 'qualityProfiles',
      entityType: 'quality_profile',
      name: 'HD-1080p',
      action: 'create',
      remoteId: null,
      fields: [],
    },
  ];
  const sectionResults: SyncSectionResult[] = [
    { section: 'qualityProfiles', status: 'success', itemsSynced: 2, error: null },
    { section: 'mediaManagement', status: 'failed', itemsSynced: 0, error: 'boom', failedProfiles: ['Bad'] },
  ];
  const sectionsAttempted: SyncHistoryInput['sectionsAttempted'] = ['qualityProfiles', 'mediaManagement'];

  const id = syncHistoryQueries.insert(
    makeInput(instanceId, {
      status: 'partial',
      sectionsAttempted,
      sectionsRun: 2,
      failureCount: 1,
      itemsSynced: 2,
      changes,
      sectionResults,
      error: 'partial failure',
    })
  );
  assert(id > 0);

  const detail = syncHistoryQueries.getById(id);
  assertExists(detail);
  assertEquals(detail.id, id);
  assertEquals(detail.arrInstanceId, instanceId);
  assertEquals(detail.instanceName, 'Radarr Main');
  assertEquals(detail.arrType, 'radarr');
  assertEquals(detail.jobId, 101);
  assertEquals(detail.trigger, 'manual');
  assertEquals(detail.triggerEvent, null);
  assertEquals(detail.status, 'partial');
  assertEquals(detail.sectionsRun, 2);
  assertEquals(detail.itemsSynced, 2);
  assertEquals(detail.failureCount, 1);
  // entity_change_count is derived from changes.length by insert().
  assertEquals(detail.entityChangeCount, 2);
  assertEquals(detail.error, 'partial failure');
  assertEquals(detail.startedAt, '2026-07-08T10:00:00.000Z');
  assertEquals(detail.finishedAt, '2026-07-08T10:00:05.000Z');
  assertEquals(detail.durationMs, 5000);
  // The JSON blobs decode back to the exact structures we wrote.
  assertEquals(detail.sectionsAttempted, sectionsAttempted);
  assertEquals(detail.changes, changes);
  assertEquals(detail.sectionResults, sectionResults);
});

migratedTest('insert stores job_id as NULL when provided as null', () => {
  const instanceId = seedInstance('sonarr');
  const id = syncHistoryQueries.insert(
    makeInput(instanceId, { arrType: 'sonarr', instanceName: 'Sonarr TV', jobId: null })
  );

  const detail = syncHistoryQueries.getById(id);
  assertExists(detail);
  assertEquals(detail.jobId, null);
  assertEquals(detail.arrType, 'sonarr');
});

migratedTest('getById returns undefined for an unknown id', () => {
  assert(syncHistoryQueries.getById(999_999) === undefined);
});

// ---------------------------------------------------------------------------
// Filters (each independent, then combined) + empty result set
// ---------------------------------------------------------------------------

migratedTest('search filters each dimension independently and combined; per-arr_type isolation holds', () => {
  const radarrId = seedInstance('radarr');
  const sonarrId = seedInstance('sonarr');
  const lidarrId = seedInstance('lidarr');

  // Radarr: manual success on qualityProfiles.
  syncHistoryQueries.insert(
    makeInput(radarrId, {
      arrType: 'radarr',
      instanceName: 'Radarr Films',
      trigger: 'manual',
      status: 'success',
      sectionsAttempted: ['qualityProfiles'],
      startedAt: '2026-07-01T10:00:00.000Z',
    })
  );
  // Sonarr: schedule failed on mediaManagement.
  syncHistoryQueries.insert(
    makeInput(sonarrId, {
      arrType: 'sonarr',
      instanceName: 'Sonarr Shows',
      trigger: 'schedule',
      status: 'failed',
      sectionsAttempted: ['mediaManagement'],
      error: 'network unreachable',
      startedAt: '2026-07-05T10:00:00.000Z',
    })
  );
  // Lidarr: system partial on metadataProfiles.
  syncHistoryQueries.insert(
    makeInput(lidarrId, {
      arrType: 'lidarr',
      instanceName: 'Lidarr Music',
      trigger: 'system',
      status: 'partial',
      sectionsAttempted: ['metadataProfiles'],
      startedAt: '2026-07-10T10:00:00.000Z',
    })
  );

  const page = { limit: 100, offset: 0 };
  const idsOf = (f: SyncHistoryFilters) => syncHistoryQueries.search(f, page).map((r) => r.arrInstanceId);

  // instanceId
  assertEquals(idsOf({ instanceId: radarrId }), [radarrId]);
  // arrType — per-Arr isolation (no cross-Arr leakage).
  assertEquals(idsOf({ arrType: 'sonarr' }), [sonarrId]);
  assertEquals(idsOf({ arrType: 'lidarr' }), [lidarrId]);
  // status
  assertEquals(idsOf({ status: 'failed' }), [sonarrId]);
  // trigger
  assertEquals(idsOf({ trigger: 'system' }), [lidarrId]);
  // section via quoted-token LIKE
  assertEquals(idsOf({ section: 'qualityProfiles' }), [radarrId]);
  assertEquals(idsOf({ section: 'metadataProfiles' }), [lidarrId]);
  // q matches instance_name and error
  assertEquals(idsOf({ q: 'Films' }), [radarrId]);
  assertEquals(idsOf({ q: 'unreachable' }), [sonarrId]);

  // from/to date range (inclusive bounds around the sonarr row only).
  assertEquals(idsOf({ from: '2026-07-03T00:00:00.000Z', to: '2026-07-07T00:00:00.000Z' }), [sonarrId]);
  // Open-ended lower bound picks up sonarr (07-05) + lidarr (07-10), newest first.
  assertEquals(idsOf({ from: '2026-07-05T10:00:00.000Z' }), [lidarrId, sonarrId]);

  // Combined filters: sonarr + failed + mediaManagement -> the one row.
  assertEquals(idsOf({ arrType: 'sonarr', status: 'failed', section: 'mediaManagement' }), [sonarrId]);

  // A filter combination matching nothing yields an empty result set.
  assertEquals(syncHistoryQueries.search({ arrType: 'radarr', status: 'failed' }, page), []);
  assertEquals(syncHistoryQueries.count({ arrType: 'radarr', status: 'failed' }), 0);
});

migratedTest('empty table returns no rows and a zero count', () => {
  assertEquals(syncHistoryQueries.search({}, { limit: 50, offset: 0 }), []);
  assertEquals(syncHistoryQueries.count({}), 0);
});

// ---------------------------------------------------------------------------
// Pagination + ordering, and search/count agreement
// ---------------------------------------------------------------------------

migratedTest('search paginates with stable newest-first (started_at DESC, id DESC) ordering', () => {
  const instanceId = seedInstance('radarr');

  // Three distinct timestamps plus a tie on the newest timestamp to exercise the
  // id DESC tiebreak. Insert order is intentionally NOT chronological.
  const tie = '2026-07-09T10:00:00.000Z';
  const idOld = syncHistoryQueries.insert(makeInput(instanceId, { startedAt: '2026-07-01T10:00:00.000Z' }));
  const idMid = syncHistoryQueries.insert(makeInput(instanceId, { startedAt: '2026-07-05T10:00:00.000Z' }));
  const idTieA = syncHistoryQueries.insert(makeInput(instanceId, { startedAt: tie }));
  const idTieB = syncHistoryQueries.insert(makeInput(instanceId, { startedAt: tie }));

  const page = { limit: 2, offset: 0 };
  const first = syncHistoryQueries.search({}, page);
  // Same started_at -> higher id first (idTieB before idTieA).
  assertEquals(
    first.map((r) => r.id),
    [idTieB, idTieA]
  );

  const second = syncHistoryQueries.search({}, { limit: 2, offset: 2 });
  assertEquals(
    second.map((r) => r.id),
    [idMid, idOld]
  );

  // No overlap and full coverage across pages.
  const third = syncHistoryQueries.search({}, { limit: 2, offset: 4 });
  assertEquals(third, []);
});

migratedTest('search + count agree: paged rows sum to total across every page', () => {
  const radarrId = seedInstance('radarr');
  const sonarrId = seedInstance('sonarr');

  const total = 7;
  for (let i = 0; i < total; i++) {
    const isRadarr = i % 2 === 0;
    syncHistoryQueries.insert(
      makeInput(isRadarr ? radarrId : sonarrId, {
        arrType: isRadarr ? 'radarr' : 'sonarr',
        instanceName: isRadarr ? 'Radarr' : 'Sonarr',
        startedAt: `2026-07-0${i + 1}T10:00:00.000Z`,
      })
    );
  }

  const filters: SyncHistoryFilters = {};
  const count = syncHistoryQueries.count(filters);
  assertEquals(count, total);

  // Walk every page; the concatenation must have exactly `count` unique rows.
  const limit = 3;
  const seen: number[] = [];
  for (let offset = 0; offset < count; offset += limit) {
    const rows = syncHistoryQueries.search(filters, { limit, offset });
    for (const r of rows) seen.push(r.id);
  }
  assertEquals(seen.length, count);
  assertEquals(new Set(seen).size, count);

  // Filtered count also agrees with a single full-page search.
  const radarrCount = syncHistoryQueries.count({ arrType: 'radarr' });
  const radarrRows = syncHistoryQueries.search({ arrType: 'radarr' }, { limit: 100, offset: 0 });
  assertEquals(radarrRows.length, radarrCount);
  assertEquals(radarrCount, 4);
});
