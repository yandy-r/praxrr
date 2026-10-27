// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { syncHistoryQueries } from '$db/queries/syncHistory.ts';
import type { SyncHistoryDetail, SyncHistorySummary } from '$db/queries/syncHistory.ts';
import type { SyncEntityChange, SyncHistoryInput, SyncPreviewArrType } from '$sync/syncHistory/types.ts';
import type { SyncHistoryListResponse, SyncHistorySettingsResponse } from '$sync/syncHistory/responses.ts';
import { GENERIC_SYNC_ERROR_TEXT } from '$sync/syncHistoryFailure.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import { GET as GET_LIST } from '../../routes/api/v1/sync-history/+server.ts';
import { GET as GET_DETAIL } from '../../routes/api/v1/sync-history/[id]/+server.ts';
import { GET as GET_EXPORT } from '../../routes/api/v1/sync-history/export/+server.ts';
import { GET as GET_SETTINGS, PATCH as PATCH_SETTINGS } from '../../routes/api/v1/sync-history/settings/+server.ts';

type ListGetEvent = Parameters<typeof GET_LIST>[0];
type DetailGetEvent = Parameters<typeof GET_DETAIL>[0];
type ExportGetEvent = Parameters<typeof GET_EXPORT>[0];
type SettingsGetEvent = Parameters<typeof GET_SETTINGS>[0];
type SettingsPatchEvent = Parameters<typeof PATCH_SETTINGS>[0];

type ErrorResponse = { error: string };

const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r', '\n', '＝', '＋', '－', '＠'] as const;

// ============================================================================
// DB BOOTSTRAP -- mirrors tests/routes/drift.test.ts: point the db singleton at a
// scratch SQLite file under a fresh temp base path, run the full migration chain
// (so migration 20260710 creates the sync_history tables + settings singleton in
// their real context), invoke the body, then tear the connection down. The job
// dispatcher is stopped in finally so the settings PATCH path (which pokes the
// dispatcher when scheduling cleanup) never leaks a timer across tests.
// ============================================================================

function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/sync-history-route-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);

      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        jobDispatcher.stop();
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

/**
 * Insert an arr_instances row (unique name to dodge case-insensitive uniqueness)
 * so sync_history.arr_instance_id has a valid FK target. Type is explicit per Arr.
 */
function createInstance(type: SyncPreviewArrType): number {
  return arrInstancesQueries.create({
    name: `${type} ${crypto.randomUUID()}`,
    type,
    url: 'http://127.0.0.1:9',
    apiKey: 'test-api-key',
  });
}

function entityChange(overrides: Partial<SyncEntityChange> = {}): SyncEntityChange {
  return {
    section: 'qualityProfiles',
    category: 'customFormats',
    entityType: 'customFormat',
    name: 'HDR10',
    action: 'update',
    remoteId: 42,
    fields: [{ field: 'score', type: 'changed', current: 100, desired: 250 }],
    ...overrides,
  };
}

/**
 * Append a sync_history row via the query module and return its id. Defaults model
 * a radarr success run; overrides tune the fields a given assertion cares about.
 */
function seedRow(overrides: Partial<SyncHistoryInput> = {}): number {
  const arrType: SyncPreviewArrType = overrides.arrType ?? 'radarr';
  const input: SyncHistoryInput = {
    arrInstanceId: overrides.arrInstanceId ?? createInstance(arrType),
    instanceName: overrides.instanceName ?? `${arrType} instance`,
    arrType,
    jobId: overrides.jobId ?? null,
    trigger: overrides.trigger ?? 'manual',
    triggerEvent: overrides.triggerEvent ?? null,
    sectionsAttempted: overrides.sectionsAttempted ?? ['qualityProfiles'],
    status: overrides.status ?? 'success',
    sectionsRun: overrides.sectionsRun ?? 1,
    itemsSynced: overrides.itemsSynced ?? 3,
    failureCount: overrides.failureCount ?? 0,
    sectionResults: overrides.sectionResults ?? [
      { section: 'qualityProfiles', status: 'success', itemsSynced: 3, error: null },
    ],
    changes: overrides.changes ?? [entityChange()],
    entityOutcomes: overrides.entityOutcomes ?? [],
    previewId: overrides.previewId ?? null,
    error: overrides.error ?? null,
    startedAt: overrides.startedAt ?? new Date().toISOString(),
    finishedAt: overrides.finishedAt ?? new Date().toISOString(),
    durationMs: overrides.durationMs ?? 100,
  };
  return syncHistoryQueries.insert(input);
}

function listEvent(query: string): ListGetEvent {
  const url = new URL(`http://localhost/api/v1/sync-history?${query}`);
  return { url } as unknown as ListGetEvent;
}

function detailEvent(id: string): DetailGetEvent {
  return { params: { id } } as unknown as DetailGetEvent;
}

function exportEvent(query: string): ExportGetEvent {
  const url = new URL(`http://localhost/api/v1/sync-history/export?${query}`);
  return { url } as unknown as ExportGetEvent;
}

function settingsGetEvent(): SettingsGetEvent {
  return {} as unknown as SettingsGetEvent;
}

function settingsPatchEvent(rawBody: string): SettingsPatchEvent {
  const request = new Request('http://localhost/api/v1/sync-history/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: rawBody,
  });
  return { request } as unknown as SettingsPatchEvent;
}

// ============================================================================
// LIST ENDPOINT -- GET /sync-history
// ============================================================================

migratedTest('GET /sync-history: filters by instanceId + arrType with per-Arr correctness', async () => {
  const radarrId = createInstance('radarr');
  const sonarrId = createInstance('sonarr');
  const lidarrId = createInstance('lidarr');

  seedRow({ arrInstanceId: radarrId, arrType: 'radarr' });
  seedRow({ arrInstanceId: radarrId, arrType: 'radarr' });
  seedRow({ arrInstanceId: sonarrId, arrType: 'sonarr', trigger: 'schedule', status: 'failed' });
  seedRow({ arrInstanceId: lidarrId, arrType: 'lidarr', trigger: 'system', status: 'partial' });

  const byInstance = await GET_LIST(listEvent(`instanceId=${radarrId}`));
  assertEquals(byInstance.status, 200);
  const instanceBody = (await byInstance.json()) as SyncHistoryListResponse;
  assertEquals(instanceBody.totalRecords, 2);
  assert(instanceBody.items.every((item) => item.arrInstanceId === radarrId));
  assert(instanceBody.items.every((item) => item.arrType === 'radarr'));

  const bySonarr = await GET_LIST(listEvent('arrType=sonarr'));
  assertEquals(bySonarr.status, 200);
  const sonarrBody = (await bySonarr.json()) as SyncHistoryListResponse;
  assertEquals(sonarrBody.totalRecords, 1);
  assertEquals(sonarrBody.items[0].arrType, 'sonarr');
  assertEquals(sonarrBody.items[0].arrInstanceId, sonarrId);

  const byStatus = await GET_LIST(listEvent('status=partial'));
  assertEquals(byStatus.status, 200);
  const statusBody = (await byStatus.json()) as SyncHistoryListResponse;
  assertEquals(statusBody.totalRecords, 1);
  assertEquals(statusBody.items[0].arrType, 'lidarr');
});

migratedTest('GET /sync-history: paginates via page + pageSize', async () => {
  const radarrId = createInstance('radarr');
  seedRow({ arrInstanceId: radarrId });
  seedRow({ arrInstanceId: radarrId });
  seedRow({ arrInstanceId: radarrId });

  const page1 = await GET_LIST(listEvent(`instanceId=${radarrId}&page=1&pageSize=2`));
  assertEquals(page1.status, 200);
  const body1 = (await page1.json()) as SyncHistoryListResponse;
  assertEquals(body1.items.length, 2);
  assertEquals(body1.totalRecords, 3);
  assertEquals(body1.totalPages, 2);
  assertEquals(body1.page, 1);
  assertEquals(body1.pageSize, 2);
  assertEquals(body1.hasNext, true);

  const page2 = await GET_LIST(listEvent(`instanceId=${radarrId}&page=2&pageSize=2`));
  const body2 = (await page2.json()) as SyncHistoryListResponse;
  assertEquals(body2.items.length, 1);
  assertEquals(body2.hasNext, false);
});

migratedTest('GET /sync-history: 400 on an invalid status filter', async () => {
  const response = await GET_LIST(listEvent('status=bogus'));
  assertEquals(response.status, 400);
  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});

migratedTest('GET /sync-history: 400 on a non-numeric instanceId filter', async () => {
  const response = await GET_LIST(listEvent('instanceId=abc'));
  assertEquals(response.status, 400);
  const body = (await response.json()) as ErrorResponse;
  assert(body.error.includes('instanceId'));
});

// ============================================================================
// DETAIL ENDPOINT -- GET /sync-history/{id}
// ============================================================================

migratedTest('GET /sync-history/{id}: unknown id returns 404', async () => {
  const response = await GET_DETAIL(detailEvent('999999'));
  assertEquals(response.status, 404);
  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});

migratedTest('GET /sync-history/{id}: non-numeric id returns 400', async () => {
  const response = await GET_DETAIL(detailEvent('abc'));
  assertEquals(response.status, 400);
  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});

migratedTest('GET /sync-history/{id}: 200 returns the full diff for a seeded run', async () => {
  const radarrId = createInstance('radarr');
  const changes: SyncEntityChange[] = [
    entityChange({ name: 'Changed CF', action: 'update', category: 'customFormats' }),
    entityChange({ entityType: 'qualityProfile', name: 'New QP', action: 'create', category: 'qualityProfiles' }),
  ];
  const id = seedRow({
    arrInstanceId: radarrId,
    status: 'partial',
    changes,
    sectionResults: [
      { section: 'qualityProfiles', status: 'success', itemsSynced: 2, error: null },
      {
        section: 'delayProfiles',
        status: 'failed',
        itemsSynced: 0,
        error: GENERIC_SYNC_ERROR_TEXT,
        errorCode: 'internal',
      },
    ],
  });

  const response = await GET_DETAIL(detailEvent(String(id)));
  assertEquals(response.status, 200);

  const body = (await response.json()) as SyncHistoryDetail;
  assertEquals(body.id, id);
  assertEquals(body.arrType, 'radarr');
  assertEquals(body.status, 'partial');
  assertEquals(body.entityChangeCount, 2);
  assertEquals(body.changes.length, 2);
  assertEquals(body.changes[0].name, 'Changed CF');
  assertEquals(body.changes[0].fields[0], { field: 'score', type: 'changed', current: 100, desired: 250 });
  assertEquals(body.sectionResults.length, 2);
  assertEquals(body.sectionResults[1].error, GENERIC_SYNC_ERROR_TEXT);
  assertEquals(body.sectionResults[1].errorCode, 'internal');
});

// ============================================================================
// EXPORT ENDPOINT -- GET /sync-history/export
// ============================================================================

migratedTest('GET /sync-history/export?format=json: JSON attachment whose body is an array', async () => {
  const radarrId = createInstance('radarr');
  seedRow({ arrInstanceId: radarrId });
  seedRow({ arrInstanceId: radarrId });

  const response = await GET_EXPORT(exportEvent(`instanceId=${radarrId}&format=json`));
  assertEquals(response.status, 200);
  assertEquals(response.headers.get('Content-Type'), 'application/json');
  const disposition = response.headers.get('Content-Disposition');
  assertExists(disposition);
  assert(disposition.includes('attachment'));
  assert(disposition.includes('.json'));

  const body = (await response.json()) as SyncHistorySummary[];
  assert(Array.isArray(body));
  assertEquals(body.length, 2);
});

migratedTest('GET /sync-history/export?format=csv: CSV attachment with RFC-4180 escaping', async () => {
  const radarrId = createInstance('radarr');
  seedRow({
    arrInstanceId: radarrId,
    instanceName: 'Radarr, "Main"',
    status: 'failed',
    failureCount: 1,
    error: GENERIC_SYNC_ERROR_TEXT,
  });

  const response = await GET_EXPORT(exportEvent(`instanceId=${radarrId}&format=csv`));
  assertEquals(response.status, 200);
  assertEquals(response.headers.get('Content-Type'), 'text/csv; charset=utf-8');
  const disposition = response.headers.get('Content-Disposition');
  assertExists(disposition);
  assert(disposition.includes('attachment'));
  assert(disposition.includes('.csv'));

  const csv = await response.text();
  assert(csv.startsWith('id,arrInstanceId,instanceName,arrType'));
  assert(csv.includes('"Radarr, ""Main"""'));
  assert(csv.includes(GENERIC_SYNC_ERROR_TEXT));
});

// ============================================================================
// SETTINGS ENDPOINT -- GET + PATCH /sync-history/settings
// ============================================================================

migratedTest('GET /sync-history/settings: 200 returns the settings shape', async () => {
  const response = await GET_SETTINGS(settingsGetEvent());
  assertEquals(response.status, 200);

  const body = (await response.json()) as SyncHistorySettingsResponse;
  assertEquals(typeof body.enabled, 'boolean');
  assertEquals(body.retentionDays, 90);
  assertEquals(body.retentionMaxEntries, 10000);
});

migratedTest('PATCH /sync-history/settings: valid body updates and returns the new settings', async () => {
  // The enabled=true path reschedules the cleanup job and pokes the dispatcher;
  // stub the wake so the timer never fires an actual run under test.
  const originalNotify = jobDispatcher.notifyJobEnqueued;
  jobDispatcher.notifyJobEnqueued = () => {};

  try {
    const response = await PATCH_SETTINGS(
      settingsPatchEvent(JSON.stringify({ enabled: true, retentionDays: 30, retentionMaxEntries: 500 }))
    );
    assertEquals(response.status, 200);

    const body = (await response.json()) as SyncHistorySettingsResponse;
    assertEquals(body.enabled, true);
    assertEquals(body.retentionDays, 30);
    assertEquals(body.retentionMaxEntries, 500);
  } finally {
    jobDispatcher.notifyJobEnqueued = originalNotify;
  }
});

migratedTest('PATCH /sync-history/settings: invalid JSON body returns 400', async () => {
  const response = await PATCH_SETTINGS(settingsPatchEvent('{ not json'));
  assertEquals(response.status, 400);
  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});

migratedTest('PATCH /sync-history/settings: retentionDays=0 returns 400', async () => {
  const response = await PATCH_SETTINGS(settingsPatchEvent(JSON.stringify({ retentionDays: 0 })));
  assertEquals(response.status, 400);
  const body = (await response.json()) as ErrorResponse;
  assert(body.error.includes('retentionDays'));
});

// ============================================================================
// REVIEW FIXES -- CSV formula injection + strict/inclusive date bounds
// ============================================================================

migratedTest('GET /sync-history/export?format=csv: neutralizes every spreadsheet formula prefix', async () => {
  const radarrId = createInstance('radarr');
  const payloads = FORMULA_PREFIXES.map((prefix) => `${prefix}formula, "quoted"\r\nnext`);
  for (const payload of payloads) {
    seedRow({
      arrInstanceId: radarrId,
      status: 'failed',
      failureCount: 1,
      instanceName: payload,
    });
  }

  const response = await GET_EXPORT(exportEvent(`instanceId=${radarrId}&format=csv`));
  assertEquals(response.status, 200);
  const csv = await response.text();

  for (const payload of payloads) {
    const expectedCell = `"'${payload.replaceAll('"', '""')}"`;
    assert(csv.includes(expectedCell), `formula-prefixed instanceName must be guarded: ${JSON.stringify(payload)}`);
  }
});

migratedTest('GET /sync-history: date-only "to" includes runs recorded later that day', async () => {
  const radarrId = createInstance('radarr');
  seedRow({ arrInstanceId: radarrId, startedAt: '2026-07-09T18:30:00.000Z' });

  const response = await GET_LIST(listEvent(`instanceId=${radarrId}&from=2026-07-09&to=2026-07-09`));
  assertEquals(response.status, 200);
  const body = (await response.json()) as SyncHistoryListResponse;
  assertEquals(body.totalRecords, 1, 'an afternoon run must fall within an inclusive same-day range');
});

migratedTest('GET /sync-history: 400 on a loose date bound SQLite cannot parse', async () => {
  const response = await GET_LIST(listEvent('from=2026-07'));
  assertEquals(response.status, 400);
});

// ============================================================================
// SANITIZATION -- stored + legacy raw rows never expose raw bodies
// ============================================================================

migratedTest(
  'sync-history routes: raw upstream error text is scrubbed at write AND legacy rows are sanitized at read',
  async () => {
    const SECRET = 'apikey=sk_live_SECRET123';
    const rawMessage = 'HTTP 400: Bad Request | ' + JSON.stringify({ message: SECRET });
    const instanceId = createInstance('radarr');
    const closed = 'The Arr instance rejected the request (HTTP 400).';

    // Write-time chokepoint: the stored column and section_results must already be clean.
    const id = seedRow({
      arrInstanceId: instanceId,
      instanceName: 'Radarr leak',
      status: 'failed',
      failureCount: 1,
      error: rawMessage,
      sectionResults: [{ section: 'qualityProfiles', status: 'failed', itemsSynced: 0, error: rawMessage }],
    });

    const stored = db.queryFirst<{ error: string | null; section_results: string | null }>(
      'SELECT error, section_results FROM sync_history WHERE id = ?',
      id
    );
    assertExists(stored);
    assert(!String(stored.error).includes('SECRET123'), 'stored error must be scrubbed at insert time');
    assert(!String(stored.section_results).includes('SECRET123'), 'stored section_results must be scrubbed');

    // Read-time backstop: model a LEGACY raw row persisted before sanitization.
    db.execute(
      'UPDATE sync_history SET error = ?, section_results = ? WHERE id = ?',
      rawMessage,
      JSON.stringify([{ section: 'qualityProfiles', status: 'failed', itemsSynced: 0, error: rawMessage }]),
      id
    );

    const listResponse = await GET_LIST(listEvent(''));
    const listBody = (await listResponse.json()) as SyncHistoryListResponse;
    assertEquals(listBody.items[0].error, closed);
    assert(!JSON.stringify(listBody).includes('SECRET123'));
    assert(!JSON.stringify(listBody).includes('HTTP 400:'));

    const detailResponse = await GET_DETAIL(detailEvent(String(id)));
    const detailBody = (await detailResponse.json()) as {
      sectionResults: Array<{ error: string | null; errorCode?: string | null }>;
    };
    assertEquals(detailBody.sectionResults[0].error, closed);
    assertEquals(detailBody.sectionResults[0].errorCode, 'rejected');
    assert(!JSON.stringify(detailBody).includes('SECRET123'));

    const jsonExport = await GET_EXPORT(exportEvent('format=json'));
    const jsonBody = await jsonExport.text();
    assert(!jsonBody.includes('SECRET123'));
    assert(!jsonBody.includes('HTTP 400:'));
    assert(jsonExport.headers.get('content-disposition')?.includes('attachment') ?? false);

    const csvExport = await GET_EXPORT(exportEvent('format=csv'));
    const csvBody = await csvExport.text();
    assert(!csvBody.includes('SECRET123'));
    assert(!csvBody.includes('HTTP 400:'));

    for (const legacyError of ['apikey sk_live_SECRET123', 'Bearer SECRET123', 'Invalid API key sk_live_SECRET123']) {
      db.execute(
        'UPDATE sync_history SET error = ?, section_results = ? WHERE id = ?',
        legacyError,
        JSON.stringify([{ section: 'qualityProfiles', status: 'failed', itemsSynced: 0, error: legacyError }]),
        id
      );

      const legacyListResponse = await GET_LIST(listEvent(''));
      const legacyListBody = (await legacyListResponse.json()) as SyncHistoryListResponse;
      assertEquals(legacyListBody.items[0].error, GENERIC_SYNC_ERROR_TEXT);
      assert(!JSON.stringify(legacyListBody).includes('SECRET123'));

      const legacyDetailResponse = await GET_DETAIL(detailEvent(String(id)));
      const legacyDetailBody = (await legacyDetailResponse.json()) as {
        error: string | null;
        sectionResults: Array<{ error: string | null; errorCode?: string | null }>;
      };
      assertEquals(legacyDetailBody.error, GENERIC_SYNC_ERROR_TEXT);
      assertEquals(legacyDetailBody.sectionResults[0].error, GENERIC_SYNC_ERROR_TEXT);
      assertEquals(legacyDetailBody.sectionResults[0].errorCode, 'internal');
      assert(!JSON.stringify(legacyDetailBody).includes('SECRET123'));
    }
  }
);
