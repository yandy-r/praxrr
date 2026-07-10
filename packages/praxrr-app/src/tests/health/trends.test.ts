import { assertEquals, assertNotStrictEquals, assertThrows } from '@std/assert';
import type { CriterionResult } from '$shared/health/index.ts';
import {
  CONFIG_HEALTH_TREND_EVIDENCE_BUDGET,
  ConfigHealthTrendEvidenceLimitError,
  type ConfigHealthTrendSnapshotDetail,
} from '$db/queries/configHealthSnapshots.ts';
import type { ConfigHealthTrendFilters } from '$lib/server/health/trendFilters.ts';
import {
  buildConfigHealthTrendResult,
  ConfigHealthTrendServiceError,
  MAX_CONFIG_HEALTH_TREND_POINTS,
  readConfigHealthTrend,
  type ConfigHealthTrendServiceDependencies,
} from '$lib/server/health/trends.ts';
import { toTrendsResponse } from '$lib/server/health/responses.ts';

const NOW = '2026-07-10T12:00:00.000Z';
const FILTERS: ConfigHealthTrendFilters = {
  from: '2026-06-01T00:00:00.000Z',
  to: NOW,
  profile: undefined,
};

function criterion(overrides: Partial<CriterionResult> = {}): CriterionResult {
  return {
    id: 'completeness',
    label: 'Completeness',
    score: 80,
    weight: 20,
    contribution: 16,
    detail: [],
    suggestions: [],
    ...overrides,
  };
}

function snapshot(
  id: number,
  overrides: Partial<ConfigHealthTrendSnapshotDetail> = {}
): ConfigHealthTrendSnapshotDetail {
  return {
    id,
    arrInstanceId: 12,
    arrType: 'sonarr',
    engineVersion: '1',
    overallScore: 80,
    band: 'attention',
    criteriaScores: [criterion()],
    profileScores: [{ name: 'WEB-1080p', score: 82, band: 'attention' }],
    criteriaScoresValid: true,
    profileScoresValid: true,
    criteriaScoresBytes: 2,
    profileScoresBytes: 2,
    generatedAt: `2026-06-${String(id).padStart(2, '0')}T00:00:00.000Z`,
    ...overrides,
  };
}

function build(snapshots: readonly ConfigHealthTrendSnapshotDetail[], filters: ConfigHealthTrendFilters = FILTERS) {
  return buildConfigHealthTrendResult({
    instance: { id: 12, name: 'Living Room Sonarr', arrType: 'sonarr' },
    filters,
    snapshots,
    settings: { retention_days: 90, retention_max_entries: 5000 },
    currentEngineVersion: '9',
    nowIso: NOW,
  });
}

function dependencies(
  type: string,
  snapshots: ConfigHealthTrendSnapshotDetail[],
  overrides: Partial<ConfigHealthTrendServiceDependencies> = {}
): ConfigHealthTrendServiceDependencies {
  return {
    getInstance: (id) => ({ id, name: `${type} instance`, type, enabled: 1 }),
    getSettings: () => ({ retention_days: 90, retention_max_entries: 5000 }),
    searchTrend: () => snapshots,
    listProfileNames: () =>
      [...new Set(snapshots.flatMap((snapshot) => snapshot.profileScores.map((profile) => profile.name)))].sort(),
    hasArrTypeMismatch: (_instanceId, arrType) => snapshots.some((snapshot) => snapshot.arrType !== arrType),
    now: () => Date.parse(NOW),
    currentEngineVersion: '9',
    ...overrides,
  };
}

Deno.test('trend projector preserves order, stored versions and every overall evidence state', () => {
  const generatedAt = '2026-06-01T00:00:00.000Z';
  const rows = [
    snapshot(9, {
      generatedAt,
      overallScore: 0,
      band: 'healthy',
      profileScores: [{ name: 'z profile', score: 10, band: 'needs-review' }],
      criteriaScores: [
        criterion({ score: 0, contribution: 0 }),
        criterion({ id: 'drift', label: 'Drift', score: null, weight: 30, contribution: 0 }),
        criterion({ id: 'coherence', label: 'Coherence', score: Number.NaN }),
      ],
    }),
    snapshot(3, {
      generatedAt,
      overallScore: 0,
      band: 'unknown',
      profileScores: [{ name: 'A profile', score: 50, band: 'attention' }],
    }),
    snapshot(7, {
      generatedAt: '2026-07-01T00:00:00.000Z',
      engineVersion: '2',
      criteriaScores: [],
      criteriaScoresValid: false,
    }),
  ];

  const result = build(rows);

  assertEquals(
    result.points.map((point) => point.snapshotId),
    [9, 3, 7]
  );
  assertEquals(result.currentEngineVersion, '9');
  assertEquals(
    result.points.map((point) => point.engineVersion),
    ['1', '1', '2']
  );
  assertEquals(result.points[0], {
    snapshotId: 9,
    generatedAt,
    engineVersion: '1',
    state: 'measured',
    score: 0,
    band: 'healthy',
    criteria: [
      {
        id: 'completeness',
        label: 'Completeness',
        state: 'measured',
        score: 0,
        weight: 20,
        contribution: 0,
      },
      {
        id: 'drift',
        label: 'Drift',
        state: 'not-evaluated',
        score: null,
        weight: 30,
        contribution: null,
      },
      {
        id: 'coherence',
        label: 'Coherence',
        state: 'not-recorded',
        score: null,
        weight: null,
        contribution: null,
      },
    ],
  });
  assertEquals(result.points[1].state, 'unknown');
  assertEquals(result.points[1].score, null);
  assertEquals(result.points[1].band, 'unknown');
  assertEquals(result.points[2].state, 'not-recorded');
  assertEquals(result.points[2].score, null);
  assertEquals(result.points[2].band, null);
  assertEquals(result.counts, { points: 3, measured: 1, unknown: 1, missing: 1 });
  assertEquals(result.availableProfiles, ['A profile', 'WEB-1080p', 'z profile']);
  assertEquals(result.engineBoundaries, [
    { engineVersion: '1', startsAt: generatedAt, pointIndex: 0 },
    { engineVersion: '2', startsAt: '2026-07-01T00:00:00.000Z', pointIndex: 2 },
  ]);
  assertEquals(result.retention, {
    days: 90,
    maxEntries: 5000,
    ageCutoffAt: '2026-04-11T12:00:00.000Z',
    oldestAvailableAt: generatedAt,
    newestAvailableAt: '2026-07-01T00:00:00.000Z',
  });
});

Deno.test('trend projector distinguishes a valid empty overall breakdown from malformed evidence', () => {
  const result = build([
    snapshot(1, { criteriaScores: [], criteriaScoresValid: true }),
    snapshot(2, { criteriaScores: [], criteriaScoresValid: false }),
  ]);

  assertEquals(result.points[0].state, 'measured');
  assertEquals(result.points[0].criteria, []);
  assertEquals(result.points[1].state, 'not-recorded');
});

Deno.test('trend projector accepts only OpenAPI integer and range compliant numeric evidence', () => {
  const validBoundaries = build([
    snapshot(1, {
      overallScore: 100,
      criteriaScores: [criterion({ score: 0, weight: 0, contribution: -1 })],
    }),
  ]);
  assertEquals(validBoundaries.points[0].state, 'measured');
  assertEquals(validBoundaries.points[0].criteria[0], {
    id: 'completeness',
    label: 'Completeness',
    state: 'measured',
    score: 0,
    weight: 0,
    contribution: -1,
  });

  for (const overallScore of [-1, 100.1, 101]) {
    assertEquals(build([snapshot(2, { overallScore })]).points[0].state, 'not-recorded');
  }

  for (const malformed of [
    criterion({ score: -1 }),
    criterion({ score: 10.5 }),
    criterion({ score: 101 }),
    criterion({ weight: -1 }),
    criterion({ weight: 1.5 }),
    criterion({ contribution: 1.5 }),
  ]) {
    assertEquals(build([snapshot(3, { criteriaScores: [malformed] })]).points[0].criteria[0].state, 'not-recorded');
  }

  for (const score of [-1, 50.5, 101]) {
    const result = build([snapshot(4, { profileScores: [{ name: 'WEB-1080p', score, band: 'attention' }] })], {
      ...FILTERS,
      profile: 'WEB-1080p',
    });
    assertEquals(result.points[0].state, 'not-recorded');
  }
});

Deno.test('trend projector matches profile names exactly and retains absence and malformed timestamps', () => {
  const exactName = '  WEB / Anime?!  ';
  const result = build(
    [
      snapshot(1, {
        profileScores: [
          { name: exactName, score: 0, band: 'needs-review' },
          { name: exactName.toLowerCase(), score: 91, band: 'healthy' },
        ],
      }),
      snapshot(2, { profileScores: [{ name: exactName.trim(), score: 88, band: 'healthy' }] }),
      snapshot(3, { profileScores: [], profileScoresValid: false }),
      snapshot(4, { profileScores: [{ name: exactName, score: 0, band: 'unknown' }] }),
    ],
    { ...FILTERS, profile: exactName }
  );

  assertEquals(
    result.points.map((point) => ({
      state: point.state,
      score: point.score,
      band: point.band,
      criteria: point.criteria,
    })),
    [
      { state: 'measured', score: 0, band: 'needs-review', criteria: [] },
      { state: 'profile-missing', score: null, band: null, criteria: [] },
      { state: 'not-recorded', score: null, band: null, criteria: [] },
      { state: 'unknown', score: null, band: 'unknown', criteria: [] },
    ]
  );
  assertEquals(result.normalizedFilter.profile, exactName);
  assertEquals(result.counts, { points: 4, measured: 1, unknown: 1, missing: 2 });
});

Deno.test('trend projector rejects empty profile names without trimming exact whitespace names', () => {
  const exactWhitespaceName = '  ';
  const result = build(
    [
      snapshot(1, { profileScores: [{ name: '', score: 80, band: 'attention' }] }),
      snapshot(2, { profileScores: [{ name: exactWhitespaceName, score: 80, band: 'attention' }] }),
    ],
    { ...FILTERS, profile: exactWhitespaceName }
  );

  assertEquals(
    result.points.map((point) => point.state),
    ['not-recorded', 'measured']
  );
  assertEquals(result.availableProfiles, [exactWhitespaceName]);
});

Deno.test('trend projector returns an explicit empty success envelope', () => {
  const result = build([], { from: undefined, to: NOW, profile: undefined });

  assertEquals(result.normalizedFilter, { from: null, to: NOW, profile: null });
  assertEquals(result.points, []);
  assertEquals(result.availableProfiles, []);
  assertEquals(result.counts, { points: 0, measured: 0, unknown: 0, missing: 0 });
  assertEquals(result.engineBoundaries, []);
  assertEquals(result.retention.oldestAvailableAt, null);
  assertEquals(result.retention.newestAvailableAt, null);
});

Deno.test('trend service validates Radarr, Sonarr and Lidarr explicitly and uses the canonical bounded query', () => {
  for (const arrType of ['radarr', 'sonarr', 'lidarr']) {
    const calls: Array<{
      instanceId: number;
      options: {
        from?: string;
        to?: string;
        limit: number;
        evidenceBudget?: typeof CONFIG_HEALTH_TREND_EVIDENCE_BUDGET;
      };
    }> = [];
    const rows = [snapshot(1, { arrType: arrType as 'radarr' | 'sonarr' | 'lidarr' })];
    const result = readConfigHealthTrend(
      42,
      FILTERS,
      dependencies(arrType, rows, {
        searchTrend: (instanceId, options) => {
          calls.push({ instanceId, options });
          return rows;
        },
      })
    );

    assertEquals(result.instance, { id: 42, name: `${arrType} instance`, arrType });
    assertEquals(calls, [
      {
        instanceId: 42,
        options: {
          from: FILTERS.from,
          to: FILTERS.to,
          limit: MAX_CONFIG_HEALTH_TREND_POINTS + 1,
          evidenceBudget: CONFIG_HEALTH_TREND_EVIDENCE_BUDGET,
        },
      },
    ]);
  }
});

Deno.test('trend service fails closed for missing and unsupported Arr types before reading history', () => {
  for (const arrType of ['all', 'chaptarr', 'unknown']) {
    let queried = false;
    const error = assertThrows(
      () =>
        readConfigHealthTrend(
          1,
          FILTERS,
          dependencies(arrType, [], {
            searchTrend: () => {
              queried = true;
              return [];
            },
          })
        ),
      ConfigHealthTrendServiceError
    );
    assertEquals(error.status, 404);
    assertEquals(queried, false);
  }

  const missing = assertThrows(
    () => readConfigHealthTrend(1, FILTERS, dependencies('radarr', [], { getInstance: () => undefined })),
    ConfigHealthTrendServiceError
  );
  assertEquals(missing.status, 404);
});

Deno.test('trend service fails closed for disabled instances and persisted Arr type mismatches', () => {
  for (const arrType of ['radarr', 'sonarr', 'lidarr'] as const) {
    let queried = false;
    const disabled = assertThrows(
      () =>
        readConfigHealthTrend(
          1,
          FILTERS,
          dependencies(arrType, [], {
            getInstance: (id) => ({ id, name: `${arrType} instance`, type: arrType, enabled: 0 }),
            searchTrend: () => {
              queried = true;
              return [];
            },
          })
        ),
      ConfigHealthTrendServiceError
    );
    assertEquals(disabled.status, 404);
    assertEquals(queried, false);
  }

  let queried = false;
  const mismatch = assertThrows(
    () =>
      readConfigHealthTrend(
        12,
        FILTERS,
        dependencies('sonarr', [snapshot(1, { arrType: 'radarr' })], {
          searchTrend: () => {
            queried = true;
            return [];
          },
        })
      ),
    ConfigHealthTrendServiceError
  );
  assertEquals(mismatch.status, 404);
  assertEquals(queried, false);
});

Deno.test('trend service loads stable profile options independently from the point time range', () => {
  const selected = [snapshot(2, { profileScores: [{ name: 'Current', score: 80, band: 'attention' }] })];
  const calls: Array<{
    instanceId: number;
    limit: number;
    snapshotLimit: number;
    evidenceBudget: typeof CONFIG_HEALTH_TREND_EVIDENCE_BUDGET | undefined;
  }> = [];
  const result = readConfigHealthTrend(
    12,
    FILTERS,
    dependencies('sonarr', selected, {
      hasArrTypeMismatch: () => false,
      listProfileNames: (instanceId, _arrType, options) => {
        calls.push({
          instanceId,
          limit: options.limit,
          snapshotLimit: options.snapshotLimit,
          evidenceBudget: options.evidenceBudget,
        });
        return ['Current', 'Historical'];
      },
    })
  );

  assertEquals(
    result.points.map((point) => point.snapshotId),
    [2]
  );
  assertEquals(result.availableProfiles, ['Current', 'Historical']);
  assertEquals(calls, [
    {
      instanceId: 12,
      limit: MAX_CONFIG_HEALTH_TREND_POINTS,
      snapshotLimit: MAX_CONFIG_HEALTH_TREND_POINTS,
      evidenceBudget: CONFIG_HEALTH_TREND_EVIDENCE_BUDGET,
    },
  ]);
});

Deno.test('trend service maps storage evidence budget failures to atomic 422 errors', () => {
  let settingsRead = false;
  let profilesRead = false;
  const error = assertThrows(
    () =>
      readConfigHealthTrend(
        12,
        FILTERS,
        dependencies('sonarr', [], {
          searchTrend: () => {
            throw new ConfigHealthTrendEvidenceLimitError();
          },
          getSettings: () => {
            settingsRead = true;
            return { retention_days: 90, retention_max_entries: 5000 };
          },
          listProfileNames: () => {
            profilesRead = true;
            return [];
          },
        })
      ),
    ConfigHealthTrendServiceError
  );

  assertEquals(error.status, 422);
  assertEquals(settingsRead, false);
  assertEquals(profilesRead, false);
});

Deno.test('trend service rejects 10,001 matches atomically with 422', () => {
  let settingsRead = false;
  const row = snapshot(1);
  const rows = Array.from({ length: MAX_CONFIG_HEALTH_TREND_POINTS + 1 }, () => row);
  const error = assertThrows(
    () =>
      readConfigHealthTrend(
        12,
        FILTERS,
        dependencies('sonarr', rows, {
          getSettings: () => {
            settingsRead = true;
            return { retention_days: 90, retention_max_entries: 5000 };
          },
        })
      ),
    ConfigHealthTrendServiceError
  );

  assertEquals(error.status, 422);
  assertEquals(settingsRead, false);
});

Deno.test('trend wire mapper returns OpenAPI-aligned mutable copies', () => {
  const result = build([snapshot(1)]);
  const response = toTrendsResponse(result);

  assertEquals(response, result);
  assertNotStrictEquals(response.instance, result.instance);
  assertNotStrictEquals(response.points, result.points);
  assertNotStrictEquals(response.points[0].criteria, result.points[0].criteria);
  response.points[0].criteria[0].label = 'Changed on wire';
  assertEquals(result.points[0].criteria[0].label, 'Completeness');
});
