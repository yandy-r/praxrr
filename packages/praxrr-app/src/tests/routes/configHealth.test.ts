// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals, assertMatch } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import {
  CONFIG_HEALTH_TREND_EVIDENCE_BUDGET,
  configHealthSnapshotsQueries,
} from '$db/queries/configHealthSnapshots.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import { CONFIG_HEALTH_ENGINE_VERSION } from '$shared/health/index.ts';
import { isPublicPath } from '$auth/middleware.ts';
import {
  CONFIG_HEALTH_RECOMPUTE_RATE_LIMIT_MAX_REQUESTS,
  registerConfigHealthRecomputeAttempt,
  resetConfigHealthRecomputeRateLimitForTests,
} from '$lib/server/health/recomputeLimits.ts';
import type {
  ConfigHealthSettingsResponse,
  ConfigHealthSummaryResponse,
  ConfigHealthTrendsResponse,
} from '$lib/server/health/responses.ts';
import { GET as GET_SUMMARY } from '../../routes/api/v1/config-health/summary/+server.ts';
import { GET as GET_DETAIL } from '../../routes/api/v1/config-health/[instanceId]/+server.ts';
import { POST as POST_RECOMPUTE } from '../../routes/api/v1/config-health/[instanceId]/recompute/+server.ts';
import { GET as GET_TRENDS } from '../../routes/api/v1/config-health/[instanceId]/trends/+server.ts';
import { GET as GET_TRENDS_EXPORT } from '../../routes/api/v1/config-health/[instanceId]/trends/export/+server.ts';
import { GET as GET_SETTINGS, PUT as PUT_SETTINGS } from '../../routes/api/v1/config-health/settings/+server.ts';
import { load as LOAD_DETAIL_PAGE } from '../../routes/config-health/[instanceId]/+page.server.ts';

type SummaryGetEvent = Parameters<typeof GET_SUMMARY>[0];
type DetailGetEvent = Parameters<typeof GET_DETAIL>[0];
type RecomputeEvent = Parameters<typeof POST_RECOMPUTE>[0];
type TrendsEvent = Parameters<typeof GET_TRENDS>[0];
type TrendsExportEvent = Parameters<typeof GET_TRENDS_EXPORT>[0];
type SettingsGetEvent = Parameters<typeof GET_SETTINGS>[0];
type SettingsPutEvent = Parameters<typeof PUT_SETTINGS>[0];
type DetailPageLoadEvent = Parameters<typeof LOAD_DETAIL_PAGE>[0];

type ErrorResponse = { error: string };
type DetailPageData = { instanceId: number | null; error?: string };

/**
 * Mirrors syncHistory.test.ts: point the db singleton at a scratch SQLite file under a fresh temp
 * base path, run the full migration chain (so config_health + job queue tables exist in real
 * context), invoke the body, then tear down. The dispatcher is stopped in finally because the
 * settings PUT path reschedules the snapshot/cleanup jobs (which poke the dispatcher).
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/config-health-route-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);

      try {
        await db.initialize();
        await runMigrations();
        // The recompute limiter is a module-global keyed by instance id; reset it so an exhausted
        // window from one test cannot leak into another that reuses a low instance id.
        resetConfigHealthRecomputeRateLimitForTests();
        await fn();
      } finally {
        resetConfigHealthRecomputeRateLimitForTests();
        jobDispatcher.stop();
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

function summaryEvent(): SummaryGetEvent {
  return {} as unknown as SummaryGetEvent;
}

function detailEvent(instanceId: string): DetailGetEvent {
  return { params: { instanceId } } as unknown as DetailGetEvent;
}

function recomputeEvent(instanceId: string): RecomputeEvent {
  return { params: { instanceId } } as unknown as RecomputeEvent;
}

function trendsEvent(instanceId: string, query = ''): TrendsEvent {
  return {
    params: { instanceId },
    url: new URL(`http://localhost/api/v1/config-health/${instanceId}/trends${query ? `?${query}` : ''}`),
  } as unknown as TrendsEvent;
}

function trendsExportEvent(instanceId: string, query = ''): TrendsExportEvent {
  return {
    params: { instanceId },
    url: new URL(`http://localhost/api/v1/config-health/${instanceId}/trends/export${query ? `?${query}` : ''}`),
  } as unknown as TrendsExportEvent;
}

function detailPageEvent(instanceId: string): DetailPageLoadEvent {
  return { params: { instanceId } } as unknown as DetailPageLoadEvent;
}

/** Seed an arr instance so the recompute route can pass the existence / sync-capable / enabled gates. */
function seedInstance(type: string, enabled = true): number {
  return arrInstancesQueries.create({
    name: `${type}-${crypto.randomUUID()}`,
    type,
    url: 'http://127.0.0.1:9',
    apiKey: 'test-api-key',
    enabled,
  });
}

interface TrendSnapshotSeed {
  instanceId: number;
  instanceName: string;
  arrType: string;
  engineVersion?: string;
  overallScore?: number;
  band?: string;
  criteriaScores?: unknown;
  profileScores?: unknown;
  generatedAt: string;
}

function storedJson(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function seedTrendSnapshot(input: TrendSnapshotSeed): number {
  db.execute(
    `INSERT INTO config_health_snapshots (
       arr_instance_id, instance_name, arr_type, engine_version,
       overall_score, band, criteria_scores, profile_scores, generated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.instanceId,
    input.instanceName,
    input.arrType,
    input.engineVersion ?? '1',
    input.overallScore ?? 80,
    input.band ?? 'attention',
    storedJson(input.criteriaScores ?? []),
    storedJson(input.profileScores ?? []),
    input.generatedAt
  );
  return db.queryFirst<{ id: number }>('SELECT last_insert_rowid() AS id')?.id ?? 0;
}

function parseCsv(csv: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted && character === '"' && csv[index + 1] === '"') {
      cell += '"';
      index += 1;
      continue;
    }
    if (quoted && character === '"') {
      quoted = false;
      continue;
    }
    if (quoted) {
      cell += character;
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      record.push(cell);
      cell = '';
    } else if (character === '\r' && csv[index + 1] === '\n') {
      record.push(cell);
      records.push(record);
      record = [];
      cell = '';
      index += 1;
    } else {
      cell += character;
    }
  }

  record.push(cell);
  records.push(record);
  return records;
}

async function withFixedNow<T>(now: string, fn: () => Promise<T>): Promise<T> {
  const originalNow = Date.now;
  Date.now = () => Date.parse(now);
  try {
    return await fn();
  } finally {
    Date.now = originalNow;
  }
}

function settingsGetEvent(): SettingsGetEvent {
  return {} as unknown as SettingsGetEvent;
}

function settingsPutEvent(body: unknown): SettingsPutEvent {
  const request = new Request('http://localhost/api/v1/config-health/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { request } as unknown as SettingsPutEvent;
}

// ============================================================================
// SUMMARY -- GET /config-health/summary
// ============================================================================

migratedTest('GET /config-health/summary: 200 with engine version, empty instances, and zeroed totals', async () => {
  const response = await GET_SUMMARY(summaryEvent());
  assertEquals(response.status, 200);

  const body = (await response.json()) as ConfigHealthSummaryResponse;
  assertEquals(body.engineVersion, CONFIG_HEALTH_ENGINE_VERSION);
  assertEquals(body.instances, []);
  assertEquals(body.totals.instances, 0);
  assertEquals(body.totals.healthy, 0);
  assertEquals(body.totals.averageScore, null);
  assertEquals(typeof body.settings.enabled, 'boolean');
  assert(typeof body.generatedAt === 'string' && body.generatedAt.length > 0);
});

// ============================================================================
// DETAIL -- GET /config-health/{instanceId}
// ============================================================================

migratedTest('GET /config-health/{instanceId}: non-numeric id returns 400', async () => {
  const response = await GET_DETAIL(detailEvent('abc'));
  assertEquals(response.status, 400);
  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});

migratedTest('GET /config-health/{instanceId}: zero id returns 400', async () => {
  const response = await GET_DETAIL(detailEvent('0'));
  assertEquals(response.status, 400);
});

migratedTest('Config Health path boundaries reject non-canonical positive safe integer ids', async () => {
  for (const invalidId of ['1e2', ' 1', '1.5', String(Number.MAX_SAFE_INTEGER + 1), '0', '-1']) {
    for (const response of [
      await GET_DETAIL(detailEvent(invalidId)),
      await POST_RECOMPUTE(recomputeEvent(invalidId)),
      await GET_TRENDS(trendsEvent(invalidId)),
      await GET_TRENDS_EXPORT(trendsExportEvent(invalidId)),
    ]) {
      assertEquals(response.status, 400, `expected ${invalidId} to return 400`);
    }

    const page = (await LOAD_DETAIL_PAGE(detailPageEvent(invalidId))) as DetailPageData;
    assertEquals(page.instanceId, null);
    assertEquals(page.error, 'Invalid instance ID');
  }
});

migratedTest('Config Health page accepts a valid positive safe integer id', async () => {
  const page = (await LOAD_DETAIL_PAGE(detailPageEvent('42'))) as DetailPageData;
  assertEquals(page.instanceId, 42);
  assertEquals(page.error, undefined);
});

migratedTest('GET /config-health/{instanceId}: unknown numeric id returns 404', async () => {
  const response = await GET_DETAIL(detailEvent('999999'));
  assertEquals(response.status, 404);
  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});

// ============================================================================
// RECOMPUTE -- POST /config-health/{instanceId}/recompute
// ============================================================================

migratedTest(
  'POST /config-health/{instanceId}/recompute: enabled sync-capable instance recomputes, persists, and returns 200 with the engine version',
  async () => {
    const id = seedInstance('radarr');
    const response = await POST_RECOMPUTE(recomputeEvent(String(id)));
    assertEquals(response.status, 200);

    // Same schema + engine version as the scheduled computation (AC), via the shared toDetailResponse.
    const body = (await response.json()) as { engineVersion: string; instanceId: number };
    assertEquals(body.engineVersion, CONFIG_HEALTH_ENGINE_VERSION);
    assertEquals(body.instanceId, id);

    // AC: exactly one trend snapshot was persisted through the route.
    assertEquals(configHealthSnapshotsQueries.getTrend(id).length, 1);
  }
);

migratedTest('POST /config-health/{instanceId}/recompute: non-numeric id returns 400', async () => {
  const response = await POST_RECOMPUTE(recomputeEvent('abc'));
  assertEquals(response.status, 400);
  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});

migratedTest('POST /config-health/{instanceId}/recompute: unknown numeric id returns 404', async () => {
  const response = await POST_RECOMPUTE(recomputeEvent('999999'));
  assertEquals(response.status, 404);
});

migratedTest('POST /config-health/{instanceId}/recompute: not sync-capable instance returns 404', async () => {
  const id = seedInstance('prowlarr');
  const response = await POST_RECOMPUTE(recomputeEvent(String(id)));
  assertEquals(response.status, 404);
});

migratedTest('POST /config-health/{instanceId}/recompute: disabled instance returns 400', async () => {
  const id = seedInstance('radarr', false);
  const response = await POST_RECOMPUTE(recomputeEvent(String(id)));
  assertEquals(response.status, 400);
  const body = (await response.json()) as ErrorResponse;
  assert(body.error.toLowerCase().includes('disabled'));
});

migratedTest(
  'POST /config-health/{instanceId}/recompute: rate-limited request returns 429 with Retry-After',
  async () => {
    const id = seedInstance('radarr');
    // Exhaust the per-instance window directly so the route rejects at the limiter, before any scoring.
    const now = Date.now();
    for (let i = 0; i < CONFIG_HEALTH_RECOMPUTE_RATE_LIMIT_MAX_REQUESTS; i++) {
      registerConfigHealthRecomputeAttempt(id, now);
    }
    const response = await POST_RECOMPUTE(recomputeEvent(String(id)));
    assertEquals(response.status, 429);
    assertEquals(response.headers.get('Retry-After'), '60');
  }
);

// ============================================================================
// SETTINGS -- GET + PUT /config-health/settings
// ============================================================================

migratedTest('GET /config-health/settings: 200 with criteria, catalog, and engine version', async () => {
  const response = await GET_SETTINGS(settingsGetEvent());
  assertEquals(response.status, 200);

  const body = (await response.json()) as ConfigHealthSettingsResponse;
  assertEquals(body.engineVersion, CONFIG_HEALTH_ENGINE_VERSION);
  assertEquals(body.criteria.length, 5);
  assertEquals(body.catalog.length, 5);
  assertEquals(typeof body.enabled, 'boolean');
  assertEquals(body.intervalMinutes, 360);
});

migratedTest('PUT /config-health/settings: engine version mismatch returns 409', async () => {
  const response = await PUT_SETTINGS(settingsPutEvent({ expectedEngineVersion: '999', intervalMinutes: 120 }));
  assertEquals(response.status, 409);
  const body = (await response.json()) as ErrorResponse;
  assert(body.error.includes('version'));
});

migratedTest('PUT /config-health/settings: valid version + intervalMinutes updates and returns 200', async () => {
  // The update reschedules the snapshot/cleanup jobs, which poke the dispatcher; stub the wake so
  // no real timer fires under test.
  const originalNotify = jobDispatcher.notifyJobEnqueued;
  jobDispatcher.notifyJobEnqueued = () => {};

  try {
    const response = await PUT_SETTINGS(
      settingsPutEvent({ expectedEngineVersion: CONFIG_HEALTH_ENGINE_VERSION, intervalMinutes: 120 })
    );
    assertEquals(response.status, 200);

    const body = (await response.json()) as ConfigHealthSettingsResponse;
    assertEquals(body.intervalMinutes, 120);
    assertEquals(body.engineVersion, CONFIG_HEALTH_ENGINE_VERSION);
  } finally {
    jobDispatcher.notifyJobEnqueued = originalNotify;
  }
});

// ============================================================================
// TRENDS + EXPORT -- GET /config-health/{instanceId}/trends[/export]
// ============================================================================

migratedTest('GET trends and JSON/CSV export share the exact canonical selection and order', async () => {
  const instanceId = seedInstance('sonarr');
  const instance = arrInstancesQueries.getById(instanceId)!;
  const exactProfile = '=Profile, "quoted"\r\nnext';
  db.execute('UPDATE config_health_settings SET retention_days = 77, retention_max_entries = 123 WHERE id = 1');

  const firstId = seedTrendSnapshot({
    instanceId,
    instanceName: instance.name,
    arrType: 'sonarr',
    engineVersion: 'old-engine',
    overallScore: 0,
    band: 'healthy',
    criteriaScores: [
      { id: 'completeness', label: 'Complete, "quoted"', score: 0, weight: 20, contribution: 0 },
      { id: 'drift', label: 'Drift', score: null, weight: 30, contribution: 0 },
      { id: 'coherence', label: 'Not recorded' },
    ],
    profileScores: [{ name: exactProfile, score: 0, band: 'needs-review' }],
    generatedAt: '2026-06-01T00:00:00.000Z',
  });
  const secondId = seedTrendSnapshot({
    instanceId,
    instanceName: instance.name,
    arrType: 'sonarr',
    engineVersion: 'old-engine',
    overallScore: 0,
    band: 'unknown',
    criteriaScores: [],
    profileScores: [{ name: 'Other Profile', score: 90, band: 'healthy' }],
    generatedAt: '2026-06-01T00:00:00.000Z',
  });
  const thirdId = seedTrendSnapshot({
    instanceId,
    instanceName: instance.name,
    arrType: 'sonarr',
    engineVersion: 'new-engine',
    criteriaScores: '{malformed',
    profileScores: '{malformed',
    generatedAt: '2026-07-01T00:00:00.000Z',
  });

  const range = 'from=2026-06-01T00%3A00%3A00.000Z&to=2026-07-01T00%3A00%3A00.000Z';
  await withFixedNow('2026-07-10T12:00:00.000Z', async () => {
    const response = await GET_TRENDS(trendsEvent(String(instanceId), range));
    assertEquals(response.status, 200);
    const body = (await response.json()) as ConfigHealthTrendsResponse;

    assertEquals(body.instance, { id: instanceId, name: instance.name, arrType: 'sonarr' });
    assertEquals(body.currentEngineVersion, CONFIG_HEALTH_ENGINE_VERSION);
    assertEquals(body.normalizedFilter, {
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
      profile: null,
    });
    assertEquals(body.retention.days, 77);
    assertEquals(body.retention.maxEntries, 123);
    assertMatch(body.retention.ageCutoffAt, /^2026-04-24T/);
    assertEquals(body.retention.oldestAvailableAt, '2026-06-01T00:00:00.000Z');
    assertEquals(body.retention.newestAvailableAt, '2026-07-01T00:00:00.000Z');
    assertEquals(body.availableProfiles, [exactProfile, 'Other Profile']);
    assertEquals(body.counts, { points: 3, measured: 1, unknown: 1, missing: 1 });
    assertEquals(
      body.points.map((point) => point.snapshotId),
      [firstId, secondId, thirdId]
    );
    assertEquals(
      body.points.map((point) => point.state),
      ['measured', 'unknown', 'not-recorded']
    );
    assertEquals(body.points[0].score, 0);
    assertEquals(body.points[1].score, null);
    assertEquals(body.points[2].band, null);
    assertEquals(
      body.points[0].criteria.map((criterion) => criterion.state),
      ['measured', 'not-evaluated', 'not-recorded']
    );
    assertEquals(body.engineBoundaries, [
      { engineVersion: 'old-engine', startsAt: '2026-06-01T00:00:00.000Z', pointIndex: 0 },
      { engineVersion: 'new-engine', startsAt: '2026-07-01T00:00:00.000Z', pointIndex: 2 },
    ]);

    const jsonExport = await GET_TRENDS_EXPORT(trendsExportEvent(String(instanceId), range));
    assertEquals(jsonExport.status, 200);
    assertEquals(jsonExport.headers.get('Content-Type'), 'application/json; charset=utf-8');
    assertEquals(jsonExport.headers.get('Cache-Control'), 'no-store');
    assertEquals(jsonExport.headers.get('X-Content-Type-Options'), 'nosniff');
    assertMatch(
      jsonExport.headers.get('Content-Disposition') ?? '',
      new RegExp(`^attachment; filename="config-health-${instanceId}-trends-\\d+\\.json"$`)
    );
    const exportedBody = (await jsonExport.json()) as ConfigHealthTrendsResponse;
    assertMatch(exportedBody.retention.ageCutoffAt, /^2026-04-24T/);
    assertEquals(
      { ...exportedBody, retention: { ...exportedBody.retention, ageCutoffAt: null } },
      { ...body, retention: { ...body.retention, ageCutoffAt: null } }
    );

    const csvExport = await GET_TRENDS_EXPORT(trendsExportEvent(String(instanceId), `format=csv&${range}`));
    assertEquals(csvExport.status, 200);
    assertEquals(csvExport.headers.get('Content-Type'), 'text/csv; charset=utf-8');
    assertEquals(csvExport.headers.get('Cache-Control'), 'no-store');
    assertEquals(csvExport.headers.get('X-Content-Type-Options'), 'nosniff');
    assertMatch(
      csvExport.headers.get('Content-Disposition') ?? '',
      new RegExp(`^attachment; filename="config-health-${instanceId}-trends-\\d+\\.csv"$`)
    );
    const rows = parseCsv(await csvExport.text());
    assertEquals(rows[0], [
      'snapshotId',
      'generatedAt',
      'engineVersion',
      'scopeKind',
      'profileName',
      'state',
      'score',
      'band',
      'criteria',
    ]);
    assertEquals(
      rows.slice(1).map((row) => Number(row[0])),
      body.points.map((point) => point.snapshotId)
    );
    assertEquals(
      rows.slice(1).map((row) => row[1]),
      body.points.map((point) => point.generatedAt)
    );
    assertEquals(JSON.parse(rows[1][8]), body.points[0].criteria);
  });
});

migratedTest(
  'GET trends preserves exact profile identity and every profile evidence state in both formats',
  async () => {
    const instanceId = seedInstance('radarr');
    const instance = arrInstancesQueries.getById(instanceId)!;
    const exactProfile = '= WEB / UHD, "exact"';
    const firstId = seedTrendSnapshot({
      instanceId,
      instanceName: instance.name,
      arrType: 'radarr',
      overallScore: 99,
      band: 'healthy',
      profileScores: [{ name: exactProfile, score: 0, band: 'needs-review' }],
      generatedAt: '2026-06-01T00:00:00.000Z',
    });
    const secondId = seedTrendSnapshot({
      instanceId,
      instanceName: instance.name,
      arrType: 'radarr',
      profileScores: [{ name: exactProfile.toLowerCase(), score: 80, band: 'attention' }],
      generatedAt: '2026-06-02T00:00:00.000Z',
    });
    const thirdId = seedTrendSnapshot({
      instanceId,
      instanceName: instance.name,
      arrType: 'radarr',
      profileScores: 'not-json',
      generatedAt: '2026-06-03T00:00:00.000Z',
    });
    const query = `profile=${encodeURIComponent(exactProfile)}&from=2026-06-01&to=2026-06-03`;

    const response = await GET_TRENDS(trendsEvent(String(instanceId), query));
    const body = (await response.json()) as ConfigHealthTrendsResponse;
    assertEquals(body.normalizedFilter.profile, exactProfile);
    assertEquals(
      body.points.map((point) => point.snapshotId),
      [firstId, secondId, thirdId]
    );
    const expectedProfileStates: Array<Pick<ConfigHealthTrendsResponse['points'][number], 'state' | 'score' | 'band'>> =
      [];
    expectedProfileStates.push({ state: 'measured', score: 0, band: 'needs-review' });
    expectedProfileStates.push({ state: 'profile-missing', score: null, band: null });
    expectedProfileStates.push({ state: 'not-recorded', score: null, band: null });
    assertEquals(
      body.points.map((point) => ({ state: point.state, score: point.score, band: point.band })),
      expectedProfileStates
    );
    assert(body.points.every((point) => point.criteria.length === 0));

    const csv = await GET_TRENDS_EXPORT(trendsExportEvent(String(instanceId), `format=csv&${query}`));
    const rows = parseCsv(await csv.text());
    assertEquals(rows.length, body.points.length + 1);
    assertEquals(rows[1][3], 'profile');
    assertEquals(rows[1][4], `'${exactProfile}`);
    assertEquals(
      rows.slice(1).map((row) => row[5]),
      body.points.map((point) => point.state)
    );
  }
);

migratedTest('GET trends applies omitted, relative, and inclusive absolute time filters', async () => {
  const instanceId = seedInstance('lidarr');
  const instance = arrInstancesQueries.getById(instanceId)!;
  for (const generatedAt of ['2026-06-01T00:00:00.000Z', '2026-06-30T23:59:59.999Z', '2026-07-01T00:00:00.000Z']) {
    seedTrendSnapshot({
      instanceId,
      instanceName: instance.name,
      arrType: 'lidarr',
      generatedAt,
    });
  }

  await withFixedNow('2026-07-10T12:00:00.000Z', async () => {
    const all = (await (await GET_TRENDS(trendsEvent(String(instanceId)))).json()) as ConfigHealthTrendsResponse;
    assertEquals(all.points.length, 3);
    assertEquals(all.normalizedFilter, { from: null, to: '2026-07-10T12:00:00.000Z', profile: null });

    const days = (await (
      await GET_TRENDS(trendsEvent(String(instanceId), 'days=30'))
    ).json()) as ConfigHealthTrendsResponse;
    assertEquals(days.points.length, 2);
    assertEquals(days.normalizedFilter.from, '2026-06-10T12:00:00.000Z');

    const inclusive = (await (
      await GET_TRENDS(trendsEvent(String(instanceId), 'from=2026-06-01&to=2026-06-30'))
    ).json()) as ConfigHealthTrendsResponse;
    assertEquals(inclusive.points.length, 2);

    const lower = (await (
      await GET_TRENDS(trendsEvent(String(instanceId), 'from=2026-07-01'))
    ).json()) as ConfigHealthTrendsResponse;
    assertEquals(lower.points.length, 1);

    const upper = (await (
      await GET_TRENDS(trendsEvent(String(instanceId), 'to=2026-06-01'))
    ).json()) as ConfigHealthTrendsResponse;
    assertEquals(upper.points.length, 1);
  });
});

migratedTest(
  'GET trends and export return typed 400 errors for invalid ids, filters, ranges, and formats',
  async () => {
    const instanceId = seedInstance('radarr');
    for (const response of [
      await GET_TRENDS(trendsEvent('abc')),
      await GET_TRENDS_EXPORT(trendsExportEvent('0')),
      await GET_TRENDS(trendsEvent(String(instanceId), 'days=7&from=2026-07-01')),
      await GET_TRENDS(trendsEvent(String(instanceId), 'from=2026-07-02&to=2026-07-01')),
      await GET_TRENDS_EXPORT(trendsExportEvent(String(instanceId), 'profile=')),
      await GET_TRENDS_EXPORT(trendsExportEvent(String(instanceId), 'format=xml')),
    ]) {
      assertEquals(response.status, 400);
      const error = (await response.json()) as ErrorResponse;
      assert(typeof error.error === 'string' && error.error.length > 0);
    }
  }
);

migratedTest('GET trends isolates Radarr, Sonarr, and Lidarr by the explicit path instance', async () => {
  const expected = new Map<number, { arrType: 'radarr' | 'sonarr' | 'lidarr'; snapshotId: number }>();
  for (const arrType of ['radarr', 'sonarr', 'lidarr'] as const) {
    const instanceId = seedInstance(arrType);
    const instance = arrInstancesQueries.getById(instanceId)!;
    const snapshotId = seedTrendSnapshot({
      instanceId,
      instanceName: instance.name,
      arrType,
      generatedAt: '2026-07-01T00:00:00.000Z',
    });
    expected.set(instanceId, { arrType, snapshotId });
  }

  for (const [instanceId, expectation] of expected) {
    const response = await GET_TRENDS(trendsEvent(String(instanceId), 'to=2026-07-02'));
    assertEquals(response.status, 200);
    const body = (await response.json()) as ConfigHealthTrendsResponse;
    assertEquals(body.instance.arrType, expectation.arrType);
    assertEquals(
      body.points.map((point) => point.snapshotId),
      [expectation.snapshotId]
    );
  }

  const unsupportedId = seedInstance('prowlarr');
  assertEquals((await GET_TRENDS(trendsEvent(String(unsupportedId)))).status, 404);
  assertEquals((await GET_TRENDS_EXPORT(trendsExportEvent(String(unsupportedId)))).status, 404);
  assertEquals((await GET_TRENDS(trendsEvent('999999'))).status, 404);
});

migratedTest('GET trends and export reject disabled Radarr, Sonarr, and Lidarr instances', async () => {
  for (const arrType of ['radarr', 'sonarr', 'lidarr'] as const) {
    const instanceId = seedInstance(arrType, false);
    assertEquals((await GET_TRENDS(trendsEvent(String(instanceId)))).status, 404);
    assertEquals((await GET_TRENDS_EXPORT(trendsExportEvent(String(instanceId)))).status, 404);
  }
});

migratedTest('GET trends fails closed after an instance Arr type changes', async () => {
  const instanceId = seedInstance('radarr');
  const instance = arrInstancesQueries.getById(instanceId)!;
  seedTrendSnapshot({
    instanceId,
    instanceName: instance.name,
    arrType: 'radarr',
    generatedAt: '2026-07-01T00:00:00.000Z',
  });
  db.execute("UPDATE arr_instances SET type = 'sonarr' WHERE id = ?", instanceId);

  assertEquals((await GET_TRENDS(trendsEvent(String(instanceId)))).status, 404);
  assertEquals((await GET_TRENDS_EXPORT(trendsExportEvent(String(instanceId)))).status, 404);
});

migratedTest('GET trends keeps retained profile options stable outside the selected range', async () => {
  const instanceId = seedInstance('lidarr');
  const instance = arrInstancesQueries.getById(instanceId)!;
  seedTrendSnapshot({
    instanceId,
    instanceName: instance.name,
    arrType: 'lidarr',
    profileScores: [{ name: 'Historical Profile', score: 70, band: 'attention' }],
    generatedAt: '2026-05-01T00:00:00.000Z',
  });
  seedTrendSnapshot({
    instanceId,
    instanceName: instance.name,
    arrType: 'lidarr',
    profileScores: [{ name: 'Current Profile', score: 90, band: 'healthy' }],
    generatedAt: '2026-07-01T00:00:00.000Z',
  });

  const response = await GET_TRENDS(trendsEvent(String(instanceId), 'from=2026-07-01&to=2026-07-02'));
  assertEquals(response.status, 200);
  const body = (await response.json()) as ConfigHealthTrendsResponse;
  assertEquals(body.points.length, 1);
  assertEquals(body.availableProfiles, ['Current Profile', 'Historical Profile']);
});

migratedTest('GET trends and export return successful empty JSON and header-only CSV responses', async () => {
  const instanceId = seedInstance('sonarr');
  const trends = await GET_TRENDS(trendsEvent(String(instanceId), 'from=2026-07-01&to=2026-07-02'));
  const body = (await trends.json()) as ConfigHealthTrendsResponse;
  assertEquals(body.points, []);
  assertEquals(body.counts, { points: 0, measured: 0, unknown: 0, missing: 0 });

  const jsonExport = await GET_TRENDS_EXPORT(
    trendsExportEvent(String(instanceId), 'format=json&from=2026-07-01&to=2026-07-02')
  );
  assertEquals(((await jsonExport.json()) as ConfigHealthTrendsResponse).points, []);

  const csvExport = await GET_TRENDS_EXPORT(
    trendsExportEvent(String(instanceId), 'format=csv&from=2026-07-01&to=2026-07-02')
  );
  assertEquals(
    await csvExport.text(),
    'snapshotId,generatedAt,engineVersion,scopeKind,profileName,state,score,band,criteria'
  );
});

migratedTest('GET trends and export reject a 10,001-point exact selection atomically with 422', async () => {
  const instanceId = seedInstance('radarr');
  const instance = arrInstancesQueries.getById(instanceId)!;
  db.execute(
    `WITH RECURSIVE sequence(value) AS (
       VALUES (1)
       UNION ALL
       SELECT value + 1 FROM sequence WHERE value < 10001
     )
     INSERT INTO config_health_snapshots (
       arr_instance_id, instance_name, arr_type, engine_version,
       overall_score, band, criteria_scores, profile_scores, generated_at
     )
     SELECT ?, ?, 'radarr', '1', 80, 'attention', '[]', '[]', '2026-07-01T00:00:00.000Z'
     FROM sequence`,
    instanceId,
    instance.name
  );

  const range = 'from=2026-07-01&to=2026-07-01';
  for (const response of [
    await GET_TRENDS(trendsEvent(String(instanceId), range)),
    await GET_TRENDS_EXPORT(trendsExportEvent(String(instanceId), `format=csv&${range}`)),
  ]) {
    assertEquals(response.status, 422);
    const body = (await response.json()) as ErrorResponse;
    assert(body.error.toLowerCase().includes('narrow'));
  }
});

migratedTest('GET trends and export reject oversized stored evidence atomically with 422', async () => {
  const instanceId = seedInstance('radarr');
  const instance = arrInstancesQueries.getById(instanceId)!;
  const oversizedId = seedTrendSnapshot({
    instanceId,
    instanceName: instance.name,
    arrType: 'radarr',
    generatedAt: '2026-07-01T00:00:00.000Z',
  });
  const oversizedCriteria = JSON.stringify(['x'.repeat(CONFIG_HEALTH_TREND_EVIDENCE_BUDGET.maxBytesPerRow)]);
  db.execute(
    'UPDATE config_health_snapshots SET criteria_scores = ?, profile_scores = ? WHERE id = ?',
    oversizedCriteria,
    '[]',
    oversizedId
  );

  for (const response of [
    await GET_TRENDS(trendsEvent(String(instanceId))),
    await GET_TRENDS_EXPORT(trendsExportEvent(String(instanceId), 'format=json')),
    await GET_TRENDS_EXPORT(trendsExportEvent(String(instanceId), 'format=csv')),
  ]) {
    assertEquals(response.status, 422);
    assertEquals(await response.json(), {
      error: 'Stored Config Health trend evidence exceeds the safe request budget',
    });
  }
});

migratedTest('GET trends and export sanitize unexpected read failures as 500 responses', async () => {
  const instanceId = seedInstance('radarr');
  db.execute('DROP TABLE config_health_snapshots');

  const trends = await GET_TRENDS(trendsEvent(String(instanceId)));
  assertEquals(trends.status, 500);
  assertEquals(await trends.json(), { error: 'Failed to read config health trends' });

  const exported = await GET_TRENDS_EXPORT(trendsExportEvent(String(instanceId), 'format=csv'));
  assertEquals(exported.status, 500);
  assertEquals(await exported.json(), { error: 'Failed to export config health trends' });
});

Deno.test('Config Health trend and export paths inherit the global authenticated API boundary', () => {
  assertEquals(isPublicPath('/api/v1/config-health/12/trends'), false);
  assertEquals(isPublicPath('/api/v1/config-health/12/trends/export'), false);
});
