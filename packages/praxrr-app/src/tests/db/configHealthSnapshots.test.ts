import { assert, assertEquals, assertThrows } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import {
  CONFIG_HEALTH_TREND_EVIDENCE_BUDGET,
  ConfigHealthTrendEvidenceLimitError,
  configHealthSnapshotsQueries,
  type ConfigHealthTrendEvidenceBudget,
} from '$db/queries/configHealthSnapshots.ts';
import {
  CONFIG_HEALTH_ENGINE_VERSION,
  type CriterionResult,
  type HealthArrType,
  type HealthBand,
  type HealthReport,
} from '$shared/health/index.ts';

/**
 * Point the db singleton at a scratch SQLite file under a fresh temp base path, run the full
 * migration chain (so config_health_snapshots exists with its FK + CHECK constraints in real
 * context), invoke the body, then tear the connection down. Mirrors syncHistoryRetention.test.ts.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/config-health-snapshots-${crypto.randomUUID()}`;
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

/** Create an arr_instances row so config_health_snapshots.arr_instance_id has a valid FK target. */
function seedInstance(type: HealthArrType): number {
  return arrInstancesQueries.create({
    name: `${type}-${crypto.randomUUID()}`,
    type,
    url: 'http://127.0.0.1:9',
    apiKey: 'test-api-key',
  });
}

/** ISO-8601 UTC instant `days` before now, to exercise the datetime()-wrapped age windows. */
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Build a minimal, valid HealthReport for one instance at a controlled `generatedAt`. */
function makeReport(
  instanceId: number,
  arrType: HealthArrType,
  generatedAt: string,
  score: number,
  band: HealthBand
): HealthReport {
  return {
    engineVersion: CONFIG_HEALTH_ENGINE_VERSION,
    instanceId,
    instanceName: `${arrType}-instance`,
    arrType,
    generatedAt,
    overall: { score, band, criteria: [], suggestions: [] },
    profiles: [{ name: 'HD', score, band, criteria: [], suggestions: [] }],
  };
}

// ---------------------------------------------------------------------------
// getPrevious — append-order predecessor
// ---------------------------------------------------------------------------

migratedTest('getPrevious returns no baseline for empty or first-snapshot state', () => {
  const radarr = seedInstance('radarr');

  assertEquals(configHealthSnapshotsQueries.getPrevious(radarr, 1), undefined);

  const firstId = configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', isoDaysAgo(1), 90, 'healthy'));
  assertEquals(configHealthSnapshotsQueries.getPrevious(radarr, firstId), undefined);
});

migratedTest('getPrevious is strictly scoped to the requested instance', () => {
  const radarr = seedInstance('radarr');
  const sonarr = seedInstance('sonarr');
  const radarrBaselineId = configHealthSnapshotsQueries.insert(
    makeReport(radarr, 'radarr', isoDaysAgo(3), 90, 'healthy')
  );
  configHealthSnapshotsQueries.insert(makeReport(sonarr, 'sonarr', isoDaysAgo(2), 40, 'needs-review'));
  const radarrCurrentId = configHealthSnapshotsQueries.insert(
    makeReport(radarr, 'radarr', isoDaysAgo(1), 80, 'attention')
  );

  const previous = configHealthSnapshotsQueries.getPrevious(radarr, radarrCurrentId);
  assertEquals(previous?.id, radarrBaselineId);
  assertEquals(previous?.arrInstanceId, radarr);
  assertEquals(previous?.arrType, 'radarr');
});

migratedTest('getPrevious selects the immediate append-order predecessor, not timestamp order', () => {
  const radarr = seedInstance('radarr');
  const immediateGeneratedAt = isoDaysAgo(10);
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', isoDaysAgo(1), 90, 'healthy'));
  const immediateId = configHealthSnapshotsQueries.insert(
    makeReport(radarr, 'radarr', immediateGeneratedAt, 75, 'attention')
  );
  const currentId = configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', isoDaysAgo(5), 70, 'attention'));

  const previous = configHealthSnapshotsQueries.getPrevious(radarr, currentId);
  assertEquals(previous?.id, immediateId);
  assertEquals(previous?.overallScore, 75);
  assertEquals(previous?.generatedAt, immediateGeneratedAt);
});

migratedTest('getPrevious keeps overlapping same-instance inserts adjacent to each caller', () => {
  const radarr = seedInstance('radarr');
  const baselineId = configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', isoDaysAgo(3), 90, 'healthy'));
  const firstCurrentId = configHealthSnapshotsQueries.insert(
    makeReport(radarr, 'radarr', isoDaysAgo(2), 80, 'attention')
  );

  // Simulate a second caller persisting before the first caller reads its predecessor.
  const overlappingCurrentId = configHealthSnapshotsQueries.insert(
    makeReport(radarr, 'radarr', isoDaysAgo(1), 70, 'attention')
  );

  assertEquals(configHealthSnapshotsQueries.getPrevious(radarr, firstCurrentId)?.id, baselineId);
  assertEquals(configHealthSnapshotsQueries.getPrevious(radarr, overlappingCurrentId)?.id, firstCurrentId);
});

migratedTest('getPrevious parses persisted criteria without reading unrelated profile score JSON', () => {
  const lidarr = seedInstance('lidarr');
  const criterion: CriterionResult = {
    id: 'drift',
    label: 'Drift',
    score: 60,
    weight: 30,
    contribution: 18,
    detail: ['One persisted detail'],
    suggestions: [],
  };
  const baseline = makeReport(lidarr, 'lidarr', isoDaysAgo(2), 60, 'attention');
  const baselineId = configHealthSnapshotsQueries.insert({
    ...baseline,
    overall: { ...baseline.overall, criteria: [criterion] },
    profiles: [
      {
        name: 'Music',
        score: 60,
        band: 'attention',
        criteria: [criterion],
        suggestions: [],
      },
      {
        name: 'Lossless',
        score: 88,
        band: 'healthy',
        criteria: [],
        suggestions: [],
      },
    ],
  });
  db.execute("UPDATE config_health_snapshots SET profile_scores = 'not-json' WHERE id = ?", baselineId);
  const currentId = configHealthSnapshotsQueries.insert(makeReport(lidarr, 'lidarr', isoDaysAgo(1), 55, 'attention'));

  const previous = configHealthSnapshotsQueries.getPrevious(lidarr, currentId);
  assertEquals(previous?.id, baselineId);
  assertEquals(previous?.criteriaScores, [criterion]);
  assertEquals(previous && 'profileScores' in previous, false);
});

migratedTest('getPrevious uses the instance/id predecessor index without a temporary sort', () => {
  const radarr = seedInstance('radarr');
  const plan = db.query<{ detail: string }>(
    `EXPLAIN QUERY PLAN
     SELECT id, arr_instance_id, instance_name, arr_type, engine_version,
            overall_score, band, criteria_scores, generated_at
       FROM config_health_snapshots
      WHERE arr_instance_id = ? AND id < ?
      ORDER BY id DESC
      LIMIT 1`,
    radarr,
    Number.MAX_SAFE_INTEGER
  );
  const detail = plan.map((row) => row.detail).join('\n');

  assert(detail.includes('idx_config_health_snapshots_instance_id_desc'), detail);
  assertEquals(detail.includes('USE TEMP B-TREE'), false, detail);
});

// ---------------------------------------------------------------------------
// getTrend — ordering + days bound
// ---------------------------------------------------------------------------

migratedTest('getTrend returns snapshots oldest -> newest regardless of insert order', () => {
  const radarr = seedInstance('radarr');
  const tOld = isoDaysAgo(10);
  const tMid = isoDaysAgo(5);
  const tNew = isoDaysAgo(1);

  // Insert scrambled; getTrend must reorder ascending by generated_at.
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', tMid, 60, 'attention'));
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', tNew, 90, 'healthy'));
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', tOld, 40, 'needs-review'));

  const trend = configHealthSnapshotsQueries.getTrend(radarr);
  assertEquals(trend.length, 3);
  assertEquals(
    trend.map((s) => s.generatedAt),
    [tOld, tMid, tNew]
  );
  assertEquals(
    trend.map((s) => s.overallScore),
    [40, 60, 90]
  );
  // Parsed profile blob round-trips.
  assertEquals(trend[0].profileScores, [{ name: 'HD', score: 40, band: 'needs-review' }]);
});

migratedTest('getTrend(days) excludes snapshots older than the window', () => {
  const radarr = seedInstance('radarr');
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', isoDaysAgo(10), 40, 'needs-review'));
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', isoDaysAgo(5), 60, 'attention'));
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', isoDaysAgo(1), 90, 'healthy'));

  const bounded = configHealthSnapshotsQueries.getTrend(radarr, 7);
  assertEquals(bounded.length, 2, 'the 10-day-old snapshot falls outside a 7-day window');
  assertEquals(
    bounded.map((s) => s.overallScore),
    [60, 90]
  );

  // No bound returns the full series.
  assertEquals(configHealthSnapshotsQueries.getTrend(radarr).length, 3);
});

migratedTest('getTrend is scoped to one instance', () => {
  const radarr = seedInstance('radarr');
  const sonarr = seedInstance('sonarr');
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', isoDaysAgo(2), 80, 'healthy'));
  configHealthSnapshotsQueries.insert(makeReport(sonarr, 'sonarr', isoDaysAgo(2), 30, 'needs-review'));

  const radarrTrend = configHealthSnapshotsQueries.getTrend(radarr);
  assertEquals(radarrTrend.length, 1);
  assertEquals(radarrTrend[0].arrType, 'radarr');
  assertEquals(radarrTrend[0].arrInstanceId, radarr);
});

// ---------------------------------------------------------------------------
// searchTrend — canonical bounds, ordering, cap, isolation, and evidence
// ---------------------------------------------------------------------------

migratedTest('searchTrend applies optional inclusive canonical from and to bounds', () => {
  const radarr = seedInstance('radarr');
  const before = '2026-06-30T23:59:59.999Z';
  const from = '2026-07-01T00:00:00.000Z';
  const middle = '2026-07-05T12:00:00.000Z';
  const to = '2026-07-10T23:59:59.999Z';
  const after = '2026-07-11T00:00:00.000Z';

  [before, from, middle, to, after].forEach((generatedAt, index) => {
    configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', generatedAt, 50 + index, 'attention'));
  });

  assertEquals(
    configHealthSnapshotsQueries.searchTrend(radarr, { from, limit: 10 }).map((row) => row.generatedAt),
    [from, middle, to, after]
  );
  assertEquals(
    configHealthSnapshotsQueries.searchTrend(radarr, { to, limit: 10 }).map((row) => row.generatedAt),
    [before, from, middle, to]
  );
  assertEquals(
    configHealthSnapshotsQueries.searchTrend(radarr, { from, to, limit: 10 }).map((row) => row.generatedAt),
    [from, middle, to],
    'rows exactly on both bounds are included'
  );
});

migratedTest('searchTrend orders equal timestamps by snapshot id ascending', () => {
  const sonarr = seedInstance('sonarr');
  const generatedAt = '2026-07-10T12:00:00.000Z';
  const ids = [70, 20, 90].map((score) =>
    configHealthSnapshotsQueries.insert(makeReport(sonarr, 'sonarr', generatedAt, score, 'attention'))
  );

  const trend = configHealthSnapshotsQueries.searchTrend(sonarr, { limit: 10 });

  assertEquals(
    trend.map((row) => row.id),
    ids
  );
  assertEquals(
    trend.map((row) => row.overallScore),
    [70, 20, 90]
  );
});

migratedTest('searchTrend isolates Radarr, Sonarr, and Lidarr snapshots', () => {
  const radarr = seedInstance('radarr');
  const sonarr = seedInstance('sonarr');
  const lidarr = seedInstance('lidarr');
  const generatedAt = '2026-07-10T12:00:00.000Z';

  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', generatedAt, 91, 'healthy'));
  configHealthSnapshotsQueries.insert(makeReport(sonarr, 'sonarr', generatedAt, 62, 'attention'));
  configHealthSnapshotsQueries.insert(makeReport(lidarr, 'lidarr', generatedAt, 33, 'needs-review'));

  for (const [instanceId, arrType, score] of [
    [radarr, 'radarr', 91],
    [sonarr, 'sonarr', 62],
    [lidarr, 'lidarr', 33],
  ] as const) {
    const trend = configHealthSnapshotsQueries.searchTrend(instanceId, { limit: 10 });
    assertEquals(trend.length, 1);
    assertEquals(trend[0].arrInstanceId, instanceId);
    assertEquals(trend[0].arrType, arrType);
    assertEquals(trend[0].overallScore, score);
  }
});

migratedTest('searchTrend returns the caller-requested cap sentinel row', () => {
  const lidarr = seedInstance('lidarr');
  const timestamps = [
    '2026-07-01T00:00:00.000Z',
    '2026-07-02T00:00:00.000Z',
    '2026-07-03T00:00:00.000Z',
    '2026-07-04T00:00:00.000Z',
  ];
  timestamps.forEach((generatedAt, index) => {
    configHealthSnapshotsQueries.insert(makeReport(lidarr, 'lidarr', generatedAt, 40 + index, 'attention'));
  });

  const serviceCap = 2;
  const trend = configHealthSnapshotsQueries.searchTrend(lidarr, { limit: serviceCap + 1 });

  assertEquals(trend.length, serviceCap + 1);
  assertEquals(
    trend.map((row) => row.generatedAt),
    timestamps.slice(0, serviceCap + 1),
    'the query preserves the overflow sentinel instead of truncating to the service cap'
  );
  assertThrows(
    () => configHealthSnapshotsQueries.searchTrend(lidarr, { limit: 0 }),
    RangeError,
    'positive safe integer'
  );
});

migratedTest('trend profile names form a deterministic bounded retained union and detect Arr type changes', () => {
  const instanceId = seedInstance('radarr');
  const ids = ['z profile', 'A profile', 'middle profile'].map((name, index) => {
    const id = configHealthSnapshotsQueries.insert(
      makeReport(instanceId, 'radarr', `2026-07-0${index + 1}T00:00:00.000Z`, 70 + index, 'attention')
    );
    db.execute(
      'UPDATE config_health_snapshots SET profile_scores = ? WHERE id = ?',
      JSON.stringify([{ name, score: 80, band: 'attention' }]),
      id
    );
    return id;
  });

  assertEquals(configHealthSnapshotsQueries.hasTrendArrTypeMismatch(instanceId, 'radarr'), false);
  assertEquals(configHealthSnapshotsQueries.listTrendProfileNames(instanceId, 'radarr', { limit: 2 }), [
    'A profile',
    'middle profile',
  ]);
  assertThrows(
    () => configHealthSnapshotsQueries.listTrendProfileNames(instanceId, 'radarr', { limit: 0 }),
    RangeError,
    'positive safe integer'
  );

  db.execute("UPDATE config_health_snapshots SET arr_type = 'sonarr' WHERE id = ?", ids[0]);
  assertEquals(configHealthSnapshotsQueries.hasTrendArrTypeMismatch(instanceId, 'radarr'), true);
});

migratedTest('searchTrend distinguishes valid empty arrays from malformed or non-array evidence', () => {
  const radarr = seedInstance('radarr');
  const emptyId = configHealthSnapshotsQueries.insert(
    makeReport(radarr, 'radarr', '2026-07-01T00:00:00.000Z', 80, 'attention')
  );
  const malformedId = configHealthSnapshotsQueries.insert(
    makeReport(radarr, 'radarr', '2026-07-02T00:00:00.000Z', 70, 'attention')
  );
  const nonArrayId = configHealthSnapshotsQueries.insert(
    makeReport(radarr, 'radarr', '2026-07-03T00:00:00.000Z', 60, 'attention')
  );

  db.execute("UPDATE config_health_snapshots SET criteria_scores = '[]', profile_scores = '[]' WHERE id = ?", emptyId);
  db.execute(
    "UPDATE config_health_snapshots SET criteria_scores = 'not-json', profile_scores = '[' WHERE id = ?",
    malformedId
  );
  db.execute(
    "UPDATE config_health_snapshots SET criteria_scores = '{}', profile_scores = 'null' WHERE id = ?",
    nonArrayId
  );

  const [empty, malformed, nonArray] = configHealthSnapshotsQueries.searchTrend(radarr, { limit: 10 });

  assertEquals(empty.id, emptyId);
  assertEquals(empty.criteriaScores, []);
  assertEquals(empty.profileScores, []);
  assertEquals(empty.criteriaScoresValid, true);
  assertEquals(empty.profileScoresValid, true);

  for (const row of [malformed, nonArray]) {
    assertEquals(row.criteriaScores, []);
    assertEquals(row.profileScores, []);
    assertEquals(row.criteriaScoresValid, false);
    assertEquals(row.profileScoresValid, false);
  }
});

migratedTest('searchTrend reports UTF-8 evidence bytes and rejects row, aggregate, and nested overages', () => {
  const radarr = seedInstance('radarr');
  const firstId = configHealthSnapshotsQueries.insert(
    makeReport(radarr, 'radarr', '2026-07-01T00:00:00.000Z', 80, 'attention')
  );
  const secondId = configHealthSnapshotsQueries.insert(
    makeReport(radarr, 'radarr', '2026-07-02T00:00:00.000Z', 70, 'attention')
  );
  const criteriaJson = JSON.stringify([{ label: 'Santé' }]);
  const profileJson = JSON.stringify([{ name: 'Vidéo', score: 80, band: 'attention' }]);
  for (const id of [firstId, secondId]) {
    db.execute(
      'UPDATE config_health_snapshots SET criteria_scores = ?, profile_scores = ? WHERE id = ?',
      criteriaJson,
      profileJson,
      id
    );
  }

  const rows = configHealthSnapshotsQueries.searchTrend(radarr, { limit: 10 });
  assertEquals(rows[0].criteriaScoresBytes, new TextEncoder().encode(criteriaJson).byteLength);
  assertEquals(rows[0].profileScoresBytes, new TextEncoder().encode(profileJson).byteLength);
  assertEquals('instanceName' in rows[0], false);
  assertEquals('createdAt' in rows[0], false);

  const rowBytes = rows[0].criteriaScoresBytes + rows[0].profileScoresBytes;
  const budget = (overrides: Partial<ConfigHealthTrendEvidenceBudget>): ConfigHealthTrendEvidenceBudget => ({
    ...CONFIG_HEALTH_TREND_EVIDENCE_BUDGET,
    ...overrides,
  });
  for (const evidenceBudget of [
    budget({ maxBytesPerRow: rowBytes - 1 }),
    budget({ maxTotalBytes: rowBytes * 2 - 1 }),
  ]) {
    assertThrows(
      () => configHealthSnapshotsQueries.searchTrend(radarr, { limit: 10, evidenceBudget }),
      ConfigHealthTrendEvidenceLimitError
    );
  }

  db.execute('UPDATE config_health_snapshots SET criteria_scores = ? WHERE id = ?', JSON.stringify([{}, {}]), firstId);
  assertThrows(
    () =>
      configHealthSnapshotsQueries.searchTrend(radarr, {
        limit: 10,
        evidenceBudget: budget({ maxCriteriaPerRow: 1 }),
      }),
    ConfigHealthTrendEvidenceLimitError
  );
});

migratedTest('searchTrend bounded predicates use the instance timestamp index lexically', () => {
  const radarr = seedInstance('radarr');
  const plan = db.query<{ detail: string }>(
    `EXPLAIN QUERY PLAN
     SELECT * FROM config_health_snapshots
      WHERE arr_instance_id = ? AND generated_at >= ? AND generated_at <= ?
      ORDER BY generated_at ASC, id ASC
      LIMIT ?`,
    radarr,
    '2026-07-01T00:00:00.000Z',
    '2026-07-10T23:59:59.999Z',
    10
  );
  const detail = plan.map((row) => row.detail).join('\n');

  assert(detail.includes('idx_config_health_snapshots_instance'), detail);
  assert(detail.includes('generated_at>?') && detail.includes('generated_at<?'), detail);
  assertEquals(detail.includes('datetime'), false, detail);
});

// ---------------------------------------------------------------------------
// pruneOlderThan — age retention
// ---------------------------------------------------------------------------

migratedTest('pruneOlderThan deletes only snapshots older than the cutoff', () => {
  const radarr = seedInstance('radarr');
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', isoDaysAgo(400), 40, 'needs-review'));
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', isoDaysAgo(1), 90, 'healthy'));

  const deleted = configHealthSnapshotsQueries.pruneOlderThan(30);
  assertEquals(deleted, 1);

  const remaining = configHealthSnapshotsQueries.getTrend(radarr);
  assertEquals(remaining.length, 1);
  assertEquals(remaining[0].overallScore, 90);
});

// ---------------------------------------------------------------------------
// pruneBeyondMaxEntries — count retention
// ---------------------------------------------------------------------------

migratedTest('pruneBeyondMaxEntries keeps exactly the newest max snapshots', () => {
  const radarr = seedInstance('radarr');
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', isoDaysAgo(3), 40, 'needs-review'));
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', isoDaysAgo(2), 60, 'attention'));
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', isoDaysAgo(1), 90, 'healthy'));

  const deleted = configHealthSnapshotsQueries.pruneBeyondMaxEntries(2);
  assertEquals(deleted, 1, 'the single oldest of three snapshots is dropped');

  const remaining = configHealthSnapshotsQueries.getTrend(radarr);
  assertEquals(
    remaining.map((s) => s.overallScore),
    [60, 90],
    'the two newest survive, still oldest -> newest'
  );
});

migratedTest('pruneBeyondMaxEntries(0) is a no-op (age-only retention)', () => {
  const radarr = seedInstance('radarr');
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', isoDaysAgo(2), 60, 'attention'));
  configHealthSnapshotsQueries.insert(makeReport(radarr, 'radarr', isoDaysAgo(1), 90, 'healthy'));

  assertEquals(configHealthSnapshotsQueries.pruneBeyondMaxEntries(0), 0);
  assertEquals(configHealthSnapshotsQueries.getTrend(radarr).length, 2);
});
