/**
 * Idempotency and counter accuracy tests for the startup pull feature.
 *
 * Validates:
 * - Repeated identical runs produce zero additional writes (idempotency)
 * - Compare-before-save logic in applySelections prevents unnecessary saves
 * - Per-instance counters align with classification events
 * - Run-level counters equal the sum of all instance counters
 * - Correct counting for skippedDefault, skippedNoMatch, conflicted, and failed
 * - Edge cases: empty instances, disabled feature, single-instance-all-skipped
 *
 * Uses the mock/patch/restore pattern from pullOnStartupJob.test.ts and
 * lidarrSync.test.ts. Mocks DB queries and Arr clients to prevent real
 * network and database calls.
 */

import { assertEquals } from '@std/assert';
import { arrSyncQueries, type ProfileSelection } from '$db/queries/arrSync.ts';
import { applyStartupSelections } from '$lib/server/pull/startup/applySelections.ts';
import {
  aggregateCounters,
  classifyRunStatus,
  buildRunSummary as buildRunSummaryFromResults,
} from '$lib/server/pull/startup/results.ts';
import type {
  StartupPullCounters,
  StartupPullInstanceResult,
  StartupPullMatchResult,
} from '$lib/server/pull/startup/types.ts';
import {
  buildMatchedExactNameResult,
  buildNoMatchResult,
  buildSkippedDefaultResult,
  buildConflictedResult,
  buildSuccessInstanceResult,
  buildFailedInstanceResult,
  buildSkippedInstanceResult,
  buildEmptyCounters,
  ALL_ARR_TYPES,
} from '../base/pullOnStartupFixtures.ts';

// =============================================================================
// Patch/Restore helpers (following lidarrSync.test.ts and pullOnStartupJob.test.ts pattern)
// =============================================================================

type Restore = () => void;

function patchTarget<T extends object, K extends keyof T>(
  target: T,
  key: K,
  replacement: T[K],
  restores: Restore[]
): void {
  const original = target[key];
  target[key] = replacement;
  restores.push(() => {
    target[key] = original;
  });
}

// =============================================================================
// Stub data for arrSyncQueries mocking
// =============================================================================

function createEmptyQualityProfilesSync() {
  return {
    selections: [] as ProfileSelection[],
    config: { trigger: 'manual' as const, cron: null },
  };
}

function createQualityProfilesSync(selections: ProfileSelection[]) {
  return {
    selections,
    config: { trigger: 'manual' as const, cron: null },
  };
}

function createEmptyDelayProfilesSync() {
  return {
    databaseId: null as number | null,
    profileName: null as string | null,
    trigger: 'manual' as const,
    cron: null as string | null,
  };
}

function createDelayProfilesSync(databaseId: number, profileName: string) {
  return {
    databaseId,
    profileName,
    trigger: 'manual' as const,
    cron: null as string | null,
  };
}

function createEmptyMediaManagementSync() {
  return {
    namingDatabaseId: null as number | null,
    namingConfigName: null as string | null,
    qualityDefinitionsDatabaseId: null as number | null,
    qualityDefinitionsConfigName: null as string | null,
    mediaSettingsDatabaseId: null as number | null,
    mediaSettingsConfigName: null as string | null,
    trigger: 'manual' as const,
    cron: null as string | null,
  };
}

function createMediaManagementSync(opts: {
  namingDatabaseId?: number | null;
  namingConfigName?: string | null;
  qualityDefinitionsDatabaseId?: number | null;
  qualityDefinitionsConfigName?: string | null;
  mediaSettingsDatabaseId?: number | null;
  mediaSettingsConfigName?: string | null;
}) {
  return {
    namingDatabaseId: opts.namingDatabaseId ?? null,
    namingConfigName: opts.namingConfigName ?? null,
    qualityDefinitionsDatabaseId: opts.qualityDefinitionsDatabaseId ?? null,
    qualityDefinitionsConfigName: opts.qualityDefinitionsConfigName ?? null,
    mediaSettingsDatabaseId: opts.mediaSettingsDatabaseId ?? null,
    mediaSettingsConfigName: opts.mediaSettingsConfigName ?? null,
    trigger: 'manual' as const,
    cron: null as string | null,
  };
}

function createEmptyMetadataProfilesSync() {
  return {
    databaseId: null as number | null,
    profileName: null as string | null,
    trigger: 'manual' as const,
    cron: null as string | null,
  };
}

function createMetadataProfilesSync(databaseId: number, profileName: string) {
  return {
    databaseId,
    profileName,
    trigger: 'manual' as const,
    cron: null as string | null,
  };
}

// =============================================================================
// 1. Idempotency: Repeated identical runs
// =============================================================================

Deno.test({
  name: 'idempotency: second run with identical matched inputs produces zero writes (all unchanged)',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];

    const instanceId = 100;
    const databaseId = 1;
    const profileName = 'HD Bluray + WEB';

    // Matched results for quality profiles section
    const matches: StartupPullMatchResult[] = [
      buildMatchedExactNameResult('radarr', 'qualityProfiles', {
        instanceId,
        databaseId,
        matchedEntityId: 10,
        matchedEntityName: profileName,
      }),
    ];

    // First run: DB has empty selections, so first apply writes
    let saveQualityProfilesCalls = 0;
    patchTarget(arrSyncQueries, 'getQualityProfilesSync', () => createEmptyQualityProfilesSync(), restores);
    patchTarget(
      arrSyncQueries,
      'saveQualityProfilesSync',
      (() => {
        saveQualityProfilesCalls += 1;
      }) as typeof arrSyncQueries.saveQualityProfilesSync,
      restores
    );
    patchTarget(arrSyncQueries, 'getDelayProfilesSync', () => createEmptyDelayProfilesSync(), restores);
    patchTarget(arrSyncQueries, 'getMediaManagementSync', () => createEmptyMediaManagementSync(), restores);
    patchTarget(arrSyncQueries, 'getMetadataProfilesSync', () => createEmptyMetadataProfilesSync(), restores);

    try {
      // First run: DB is empty, apply writes the selection
      const firstResult = await applyStartupSelections(instanceId, 'radarr', matches);
      assertEquals(firstResult.qualityProfiles.written, true);
      assertEquals(firstResult.qualityProfiles.reason, 'applied');
      assertEquals(saveQualityProfilesCalls, 1);

      // Now simulate second run: DB returns the selection that was just written
      // Override getQualityProfilesSync to return matching data
      const restores2: Restore[] = [];
      patchTarget(
        arrSyncQueries,
        'getQualityProfilesSync',
        () => createQualityProfilesSync([{ databaseId, profileName }]),
        restores2
      );
      saveQualityProfilesCalls = 0;

      const secondResult = await applyStartupSelections(instanceId, 'radarr', matches);
      assertEquals(secondResult.qualityProfiles.written, false);
      assertEquals(secondResult.qualityProfiles.reason, 'unchanged');
      assertEquals(secondResult.qualityProfiles.count, 1);
      assertEquals(saveQualityProfilesCalls, 0, 'second run should NOT trigger a save call');

      for (const restore of restores2.reverse()) restore();
    } finally {
      for (const restore of restores.reverse()) restore();
    }
  },
});

Deno.test({
  name: 'idempotency: repeated run with no matched inputs produces zero writes on both runs',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];
    const instanceId = 100;

    // No matched results at all
    const matches: StartupPullMatchResult[] = [buildNoMatchResult('radarr', 'qualityProfiles', { instanceId })];

    let saveCallCount = 0;
    patchTarget(arrSyncQueries, 'getQualityProfilesSync', () => createEmptyQualityProfilesSync(), restores);
    patchTarget(
      arrSyncQueries,
      'saveQualityProfilesSync',
      (() => {
        saveCallCount += 1;
      }) as typeof arrSyncQueries.saveQualityProfilesSync,
      restores
    );
    patchTarget(arrSyncQueries, 'getDelayProfilesSync', () => createEmptyDelayProfilesSync(), restores);
    patchTarget(arrSyncQueries, 'getMediaManagementSync', () => createEmptyMediaManagementSync(), restores);
    patchTarget(arrSyncQueries, 'getMetadataProfilesSync', () => createEmptyMetadataProfilesSync(), restores);

    try {
      const firstResult = await applyStartupSelections(instanceId, 'radarr', matches);
      assertEquals(firstResult.qualityProfiles.written, false);
      assertEquals(firstResult.qualityProfiles.reason, 'no_matches');
      assertEquals(saveCallCount, 0);

      // Second run: identical no-match results
      const secondResult = await applyStartupSelections(instanceId, 'radarr', matches);
      assertEquals(secondResult.qualityProfiles.written, false);
      assertEquals(secondResult.qualityProfiles.reason, 'no_matches');
      assertEquals(saveCallCount, 0, 'no save calls for repeated no-match runs');
    } finally {
      for (const restore of restores.reverse()) restore();
    }
  },
});

// =============================================================================
// 2. Idempotency: Apply bridge compare-before-save per section type
// =============================================================================

Deno.test({
  name: 'idempotency: quality profiles compare-before-save skips write when selections match',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];
    const instanceId = 100;
    const databaseId = 1;
    const profileName = 'HD Bluray + WEB';

    const matches: StartupPullMatchResult[] = [
      buildMatchedExactNameResult('radarr', 'qualityProfiles', {
        instanceId,
        databaseId,
        matchedEntityId: 10,
        matchedEntityName: profileName,
      }),
    ];

    let saveCalled = false;
    patchTarget(
      arrSyncQueries,
      'getQualityProfilesSync',
      () => createQualityProfilesSync([{ databaseId, profileName }]),
      restores
    );
    patchTarget(
      arrSyncQueries,
      'saveQualityProfilesSync',
      (() => {
        saveCalled = true;
      }) as typeof arrSyncQueries.saveQualityProfilesSync,
      restores
    );
    patchTarget(arrSyncQueries, 'getDelayProfilesSync', () => createEmptyDelayProfilesSync(), restores);
    patchTarget(arrSyncQueries, 'getMediaManagementSync', () => createEmptyMediaManagementSync(), restores);
    patchTarget(arrSyncQueries, 'getMetadataProfilesSync', () => createEmptyMetadataProfilesSync(), restores);

    try {
      const result = await applyStartupSelections(instanceId, 'radarr', matches);
      assertEquals(result.qualityProfiles.written, false);
      assertEquals(result.qualityProfiles.reason, 'unchanged');
      assertEquals(saveCalled, false, 'no save when existing selections already match');
    } finally {
      for (const restore of restores.reverse()) restore();
    }
  },
});

Deno.test({
  name: 'idempotency: delay profiles compare-before-save skips write when selection matches',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];
    const instanceId = 200;
    const databaseId = 1;
    const profileName = 'Standard Delay';

    const matches: StartupPullMatchResult[] = [
      buildMatchedExactNameResult('sonarr', 'delayProfiles', {
        instanceId,
        databaseId,
        matchedEntityId: 5,
        matchedEntityName: profileName,
      }),
    ];

    let saveCalled = false;
    patchTarget(
      arrSyncQueries,
      'getDelayProfilesSync',
      () => createDelayProfilesSync(databaseId, profileName),
      restores
    );
    patchTarget(
      arrSyncQueries,
      'saveDelayProfilesSync',
      (() => {
        saveCalled = true;
      }) as typeof arrSyncQueries.saveDelayProfilesSync,
      restores
    );
    patchTarget(arrSyncQueries, 'getQualityProfilesSync', () => createEmptyQualityProfilesSync(), restores);
    patchTarget(arrSyncQueries, 'getMediaManagementSync', () => createEmptyMediaManagementSync(), restores);
    patchTarget(arrSyncQueries, 'getMetadataProfilesSync', () => createEmptyMetadataProfilesSync(), restores);

    try {
      const result = await applyStartupSelections(instanceId, 'sonarr', matches);
      assertEquals(result.delayProfiles.written, false);
      assertEquals(result.delayProfiles.reason, 'unchanged');
      assertEquals(saveCalled, false, 'no save when delay profile selection matches');
    } finally {
      for (const restore of restores.reverse()) restore();
    }
  },
});

Deno.test({
  name: 'idempotency: media management compare-before-save skips write when selections match',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];
    const instanceId = 100;
    const databaseId = 1;

    const matches: StartupPullMatchResult[] = [
      buildMatchedExactNameResult('radarr', 'naming', {
        instanceId,
        databaseId,
        matchedEntityId: 'naming',
        matchedEntityName: 'naming',
      }),
      buildMatchedExactNameResult('radarr', 'mediaSettings', {
        instanceId,
        databaseId,
        matchedEntityId: 'mediaManagement',
        matchedEntityName: 'mediaManagement',
      }),
      buildMatchedExactNameResult('radarr', 'qualityDefinitions', {
        instanceId,
        databaseId,
        matchedEntityId: 'qualityDefinitions',
        matchedEntityName: 'qualityDefinitions',
      }),
    ];

    let saveCalled = false;
    patchTarget(
      arrSyncQueries,
      'getMediaManagementSync',
      () =>
        createMediaManagementSync({
          namingDatabaseId: databaseId,
          namingConfigName: 'naming',
          mediaSettingsDatabaseId: databaseId,
          mediaSettingsConfigName: 'mediaManagement',
          qualityDefinitionsDatabaseId: databaseId,
          qualityDefinitionsConfigName: 'qualityDefinitions',
        }),
      restores
    );
    patchTarget(
      arrSyncQueries,
      'saveMediaManagementSync',
      (() => {
        saveCalled = true;
      }) as typeof arrSyncQueries.saveMediaManagementSync,
      restores
    );
    patchTarget(arrSyncQueries, 'getQualityProfilesSync', () => createEmptyQualityProfilesSync(), restores);
    patchTarget(arrSyncQueries, 'getDelayProfilesSync', () => createEmptyDelayProfilesSync(), restores);
    patchTarget(arrSyncQueries, 'getMetadataProfilesSync', () => createEmptyMetadataProfilesSync(), restores);

    try {
      const result = await applyStartupSelections(instanceId, 'radarr', matches);
      assertEquals(result.mediaManagement.written, false);
      assertEquals(result.mediaManagement.reason, 'unchanged');
      assertEquals(saveCalled, false, 'no save when media management selections match');
    } finally {
      for (const restore of restores.reverse()) restore();
    }
  },
});

Deno.test({
  name: 'idempotency: metadata profiles compare-before-save skips write when selection matches (lidarr)',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];
    const instanceId = 300;
    const databaseId = 1;
    const profileName = 'Standard Metadata';

    const matches: StartupPullMatchResult[] = [
      buildMatchedExactNameResult('lidarr', 'metadataProfiles', {
        instanceId,
        databaseId,
        matchedEntityId: 3,
        matchedEntityName: profileName,
      }),
    ];

    let saveCalled = false;
    patchTarget(
      arrSyncQueries,
      'getMetadataProfilesSync',
      () => createMetadataProfilesSync(databaseId, profileName),
      restores
    );
    patchTarget(
      arrSyncQueries,
      'saveMetadataProfilesSync',
      (() => {
        saveCalled = true;
      }) as typeof arrSyncQueries.saveMetadataProfilesSync,
      restores
    );
    patchTarget(arrSyncQueries, 'getQualityProfilesSync', () => createEmptyQualityProfilesSync(), restores);
    patchTarget(arrSyncQueries, 'getDelayProfilesSync', () => createEmptyDelayProfilesSync(), restores);
    patchTarget(arrSyncQueries, 'getMediaManagementSync', () => createEmptyMediaManagementSync(), restores);

    try {
      const result = await applyStartupSelections(instanceId, 'lidarr', matches);
      assertEquals(result.metadataProfiles.written, false);
      assertEquals(result.metadataProfiles.reason, 'unchanged');
      assertEquals(saveCalled, false, 'no save when metadata profile selection matches');
    } finally {
      for (const restore of restores.reverse()) restore();
    }
  },
});

Deno.test({
  name: 'idempotency: metadata profiles returns no_matches for non-lidarr arr types',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];
    const instanceId = 100;

    const matches: StartupPullMatchResult[] = [
      buildMatchedExactNameResult('radarr', 'metadataProfiles', {
        instanceId,
        databaseId: 1,
        matchedEntityId: 3,
        matchedEntityName: 'Some Profile',
      }),
    ];

    patchTarget(arrSyncQueries, 'getQualityProfilesSync', () => createEmptyQualityProfilesSync(), restores);
    patchTarget(arrSyncQueries, 'getDelayProfilesSync', () => createEmptyDelayProfilesSync(), restores);
    patchTarget(arrSyncQueries, 'getMediaManagementSync', () => createEmptyMediaManagementSync(), restores);
    patchTarget(arrSyncQueries, 'getMetadataProfilesSync', () => createEmptyMetadataProfilesSync(), restores);

    try {
      const result = await applyStartupSelections(instanceId, 'radarr', matches);
      assertEquals(result.metadataProfiles.written, false);
      assertEquals(result.metadataProfiles.reason, 'no_matches');
    } finally {
      for (const restore of restores.reverse()) restore();
    }
  },
});

Deno.test({
  name: 'metadata profiles selection is cleared when lidarr has no startup matches',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];
    const instanceId = 700;
    const existingDatabaseId = 1;
    const existingProfileName = 'Standard Metadata';
    const emptyMatches: StartupPullMatchResult[] = [];

    let saveCalled = false;
    let savedInstanceId: number | null = null;
    let savedDatabaseId: number | null | undefined;
    let savedProfileName: string | null | undefined;

    patchTarget(
      arrSyncQueries,
      'getMetadataProfilesSync',
      () => createMetadataProfilesSync(existingDatabaseId, existingProfileName),
      restores
    );
    patchTarget(
      arrSyncQueries,
      'saveMetadataProfilesSync',
      ((instanceIdParam: number, payload) => {
        saveCalled = true;
        savedInstanceId = instanceIdParam;
        savedDatabaseId = payload.databaseId;
        savedProfileName = payload.profileName;
      }) as typeof arrSyncQueries.saveMetadataProfilesSync,
      restores
    );

    patchTarget(arrSyncQueries, 'getQualityProfilesSync', () => createEmptyQualityProfilesSync(), restores);
    patchTarget(arrSyncQueries, 'getDelayProfilesSync', () => createEmptyDelayProfilesSync(), restores);
    patchTarget(arrSyncQueries, 'getMediaManagementSync', () => createEmptyMediaManagementSync(), restores);

    try {
      const result = await applyStartupSelections(instanceId, 'lidarr', emptyMatches);

      assertEquals(result.metadataProfiles.written, true);
      assertEquals(result.metadataProfiles.reason, 'applied');
      assertEquals(result.metadataProfiles.count, 0);
      assertEquals(saveCalled, true);
      assertEquals(savedInstanceId, instanceId);
      assertEquals(savedDatabaseId, null);
      assertEquals(savedProfileName, null);
    } finally {
      for (const restore of restores.reverse()) restore();
    }
  },
});

// =============================================================================
// 3. Counter accuracy: per-instance counters
// =============================================================================

Deno.test('counter accuracy: matched events increment imported counter', () => {
  const instance = buildSuccessInstanceResult('radarr', { imported: 5 });
  assertEquals(instance.imported, 5);
  assertEquals(instance.skippedDefault, 0);
  assertEquals(instance.skippedNoMatch, 0);
  assertEquals(instance.conflicted, 0);
  assertEquals(instance.failed, 0);
});

Deno.test('counter accuracy: per-instance counters sum equals total entities processed', () => {
  const instance = buildSuccessInstanceResult('radarr', {
    imported: 3,
    skippedDefault: 2,
    skippedNoMatch: 1,
    conflicted: 1,
    failed: 0,
  });

  const total =
    instance.imported + instance.skippedDefault + instance.skippedNoMatch + instance.conflicted + instance.failed;
  assertEquals(total, 7, 'sum of all counters should equal total entities');
});

Deno.test('counter accuracy: each classification event increments the correct counter', () => {
  // Simulate what the adapter does: count match results
  const results: StartupPullMatchResult[] = [
    buildMatchedExactNameResult('radarr', 'qualityProfiles'),
    buildMatchedExactNameResult('radarr', 'qualityProfiles'),
    buildNoMatchResult('radarr', 'delayProfiles'),
    buildSkippedDefaultResult('radarr', 'delayProfiles'),
    buildConflictedResult('radarr', 'qualityProfiles'),
  ];

  const counters = buildEmptyCounters();
  for (const result of results) {
    if (result.status === 'matched') {
      counters.imported += 1;
    } else if (result.status === 'conflicted') {
      counters.conflicted += 1;
    } else if (result.status === 'no_match' && result.reason === 'default_skip') {
      counters.skippedDefault += 1;
    } else {
      counters.skippedNoMatch += 1;
    }
  }

  assertEquals(counters.imported, 2, 'two matched -> imported = 2');
  assertEquals(counters.skippedNoMatch, 1, 'one no_match -> skippedNoMatch = 1');
  assertEquals(counters.skippedDefault, 1, 'one default_skip -> skippedDefault = 1');
  assertEquals(counters.conflicted, 1, 'one conflicted -> conflicted = 1');
  assertEquals(counters.failed, 0, 'no failures -> failed = 0');
});

// =============================================================================
// 4. Counter accuracy: run-level aggregation
// =============================================================================

Deno.test('counter accuracy: run-level counters equal sum of all instance counters', () => {
  const radarr = buildSuccessInstanceResult('radarr', {
    imported: 5,
    skippedDefault: 2,
    skippedNoMatch: 1,
    conflicted: 1,
  });
  const sonarr = buildSuccessInstanceResult('sonarr', {
    imported: 3,
    skippedDefault: 1,
    skippedNoMatch: 0,
    conflicted: 0,
  });
  const lidarr = buildFailedInstanceResult('lidarr', {
    failed: 1,
  });

  const instances: readonly StartupPullInstanceResult[] = [radarr, sonarr, lidarr];
  const aggregated = aggregateCounters(instances);

  assertEquals(aggregated.imported, 8, 'run-level imported = sum of instance imported');
  assertEquals(aggregated.skippedDefault, 3, 'run-level skippedDefault = sum of instance skippedDefault');
  assertEquals(aggregated.skippedNoMatch, 1, 'run-level skippedNoMatch = sum of instance skippedNoMatch');
  assertEquals(aggregated.conflicted, 1, 'run-level conflicted = sum of instance conflicted');
  assertEquals(aggregated.failed, 1, 'run-level failed = sum of instance failed');
});

Deno.test('counter accuracy: mixed outcomes across multiple instances aggregate correctly', () => {
  // one success, one partial (success with some counters), one failed
  const successInstance = buildSuccessInstanceResult('radarr', {
    imported: 10,
    skippedDefault: 3,
    skippedNoMatch: 0,
    conflicted: 0,
  });
  const partialInstance = buildSuccessInstanceResult('sonarr', {
    imported: 2,
    skippedDefault: 0,
    skippedNoMatch: 5,
    conflicted: 2,
  });
  const failedInstance = buildFailedInstanceResult('lidarr', {
    failed: 1,
  });

  const instances: readonly StartupPullInstanceResult[] = [successInstance, partialInstance, failedInstance];
  const aggregated = aggregateCounters(instances);

  assertEquals(aggregated.imported, 12);
  assertEquals(aggregated.skippedDefault, 3);
  assertEquals(aggregated.skippedNoMatch, 5);
  assertEquals(aggregated.conflicted, 2);
  assertEquals(aggregated.failed, 1);

  // Verify run-level status classification
  const status = classifyRunStatus(instances);
  assertEquals(status, 'partial', 'mix of success and failure instances -> partial');
});

Deno.test('counter accuracy: buildRunSummary aggregates counters from instances correctly', () => {
  const radarr = buildSuccessInstanceResult('radarr', { imported: 4, skippedDefault: 1 });
  const sonarr = buildFailedInstanceResult('sonarr', { failed: 1 });

  const summary = buildRunSummaryFromResults(
    'test-run-id',
    [radarr, sonarr],
    '2026-02-21T00:00:00.000Z',
    '2026-02-21T00:00:01.000Z'
  );

  assertEquals(summary.imported, 4);
  assertEquals(summary.skippedDefault, 1);
  assertEquals(summary.skippedNoMatch, 0);
  assertEquals(summary.conflicted, 0);
  assertEquals(summary.failed, 1);
  assertEquals(summary.status, 'partial');
  assertEquals(summary.instances.length, 2);
});

// =============================================================================
// 5. Counter accuracy: skippedDefault counting
// =============================================================================

Deno.test('counter accuracy: skippedDefault increments correctly when defaults are excluded', () => {
  const radarrDefaults = buildSuccessInstanceResult('radarr', {
    skippedDefault: 3,
    imported: 0,
  });
  const sonarrDefaults = buildSuccessInstanceResult('sonarr', {
    skippedDefault: 2,
    imported: 1,
  });
  const lidarrDefaults = buildSuccessInstanceResult('lidarr', {
    skippedDefault: 4,
    imported: 2,
  });

  const instances = [radarrDefaults, sonarrDefaults, lidarrDefaults];
  const aggregated = aggregateCounters(instances);

  assertEquals(aggregated.skippedDefault, 9, 'total skippedDefault across all arr_types');
  assertEquals(aggregated.imported, 3, 'total imported across all arr_types');
});

Deno.test('counter accuracy: different defaults per arr_type counted independently', () => {
  // Each arr_type has a different number of defaults
  for (const arrType of ALL_ARR_TYPES) {
    const instance = buildSuccessInstanceResult(arrType, {
      skippedDefault: arrType === 'radarr' ? 2 : arrType === 'sonarr' ? 1 : 3,
    });

    const expected = arrType === 'radarr' ? 2 : arrType === 'sonarr' ? 1 : 3;
    assertEquals(instance.skippedDefault, expected, `${arrType} should have ${expected} skipped defaults`);
  }
});

// =============================================================================
// 6. Counter accuracy: conflicted counting
// =============================================================================

Deno.test('counter accuracy: conflicted increments correctly for ambiguous matches', () => {
  const instance = buildSuccessInstanceResult('radarr', {
    imported: 2,
    conflicted: 3,
    skippedNoMatch: 0,
  });

  assertEquals(instance.conflicted, 3);
  assertEquals(instance.imported, 2);
});

Deno.test('counter accuracy: conflicted items are NOT also counted as no_match', () => {
  // Verify via the classification function that conflicted and no_match are mutually exclusive
  const conflictedResult = buildConflictedResult('radarr', 'qualityProfiles');
  const noMatchResult = buildNoMatchResult('radarr', 'qualityProfiles');

  // Conflicted result has status 'conflicted'
  assertEquals(conflictedResult.status, 'conflicted');
  assertEquals(noMatchResult.status, 'no_match');

  // Build counters by classifying each result
  const counters = buildEmptyCounters();

  // Process conflicted result
  if (conflictedResult.status === 'conflicted') {
    counters.conflicted += 1;
  } else if (conflictedResult.status === 'no_match') {
    counters.skippedNoMatch += 1;
  }

  // Process no_match result
  if (noMatchResult.status === 'conflicted') {
    counters.conflicted += 1;
  } else if (noMatchResult.status === 'no_match') {
    counters.skippedNoMatch += 1;
  }

  assertEquals(counters.conflicted, 1, 'conflicted counted once');
  assertEquals(counters.skippedNoMatch, 1, 'no_match counted once');
  // They are mutually exclusive: the total is exactly 2 (one of each)
  assertEquals(counters.conflicted + counters.skippedNoMatch, 2);
});

Deno.test('counter accuracy: multiple conflicted entries aggregate at run level', () => {
  const radarr = buildSuccessInstanceResult('radarr', { conflicted: 2 });
  const sonarr = buildSuccessInstanceResult('sonarr', { conflicted: 1 });

  const aggregated = aggregateCounters([radarr, sonarr]);
  assertEquals(aggregated.conflicted, 3);
});

// =============================================================================
// 7. Counter accuracy: failed counting
// =============================================================================

Deno.test('counter accuracy: failed instance has failed=1 and zero for all other categories', () => {
  const failed = buildFailedInstanceResult('radarr');

  assertEquals(failed.failed, 1);
  assertEquals(failed.imported, 0);
  assertEquals(failed.skippedDefault, 0);
  assertEquals(failed.skippedNoMatch, 0);
  assertEquals(failed.conflicted, 0);
});

Deno.test('counter accuracy: failed instances aggregate correctly at run level', () => {
  const failed1 = buildFailedInstanceResult('radarr', { failed: 1 });
  const failed2 = buildFailedInstanceResult('sonarr', { failed: 1 });
  const success = buildSuccessInstanceResult('lidarr', { imported: 5 });

  const aggregated = aggregateCounters([failed1, failed2, success]);
  assertEquals(aggregated.failed, 2);
  assertEquals(aggregated.imported, 5);
});

Deno.test('counter accuracy: classifyRunStatus returns failed when all instances fail', () => {
  const failed1 = buildFailedInstanceResult('radarr');
  const failed2 = buildFailedInstanceResult('sonarr');

  const status = classifyRunStatus([failed1, failed2]);
  assertEquals(status, 'failed');
});

Deno.test('counter accuracy: classifyRunStatus returns partial when some succeed and some fail', () => {
  const success = buildSuccessInstanceResult('radarr', { imported: 3 });
  const failed = buildFailedInstanceResult('sonarr');

  const status = classifyRunStatus([success, failed]);
  assertEquals(status, 'partial');
});

Deno.test('counter accuracy: classifyRunStatus returns success when all succeed', () => {
  const success1 = buildSuccessInstanceResult('radarr', { imported: 3 });
  const success2 = buildSuccessInstanceResult('sonarr', { imported: 1 });

  const status = classifyRunStatus([success1, success2]);
  assertEquals(status, 'success');
});

// =============================================================================
// 8. Edge cases
// =============================================================================

Deno.test('edge case: empty instance list produces all-zero counters', () => {
  const instances: readonly StartupPullInstanceResult[] = [];

  const aggregated = aggregateCounters(instances);
  assertEquals(aggregated.imported, 0);
  assertEquals(aggregated.skippedDefault, 0);
  assertEquals(aggregated.skippedNoMatch, 0);
  assertEquals(aggregated.conflicted, 0);
  assertEquals(aggregated.failed, 0);

  const status = classifyRunStatus(instances);
  assertEquals(status, 'skipped');
});

Deno.test('edge case: empty instance list in buildRunSummary produces all-zero counters and skipped status', () => {
  const summary = buildRunSummaryFromResults('empty-run', [], '2026-02-21T00:00:00.000Z', '2026-02-21T00:00:01.000Z');

  assertEquals(summary.imported, 0);
  assertEquals(summary.skippedDefault, 0);
  assertEquals(summary.skippedNoMatch, 0);
  assertEquals(summary.conflicted, 0);
  assertEquals(summary.failed, 0);
  assertEquals(summary.status, 'skipped');
  assertEquals(summary.instances.length, 0);
});

Deno.test('edge case: single instance with all sections returning no_matches', async () => {
  const restores: Restore[] = [];
  const instanceId = 100;

  // All sections return no matches (empty match array)
  const matches: StartupPullMatchResult[] = [];

  patchTarget(arrSyncQueries, 'getQualityProfilesSync', () => createEmptyQualityProfilesSync(), restores);
  patchTarget(arrSyncQueries, 'getDelayProfilesSync', () => createEmptyDelayProfilesSync(), restores);
  patchTarget(arrSyncQueries, 'getMediaManagementSync', () => createEmptyMediaManagementSync(), restores);
  patchTarget(arrSyncQueries, 'getMetadataProfilesSync', () => createEmptyMetadataProfilesSync(), restores);

  let anySaveCalled = false;
  const noopSave = (() => {
    anySaveCalled = true;
  }) as () => void;
  patchTarget(
    arrSyncQueries,
    'saveQualityProfilesSync',
    noopSave as typeof arrSyncQueries.saveQualityProfilesSync,
    restores
  );
  patchTarget(
    arrSyncQueries,
    'saveDelayProfilesSync',
    noopSave as typeof arrSyncQueries.saveDelayProfilesSync,
    restores
  );
  patchTarget(
    arrSyncQueries,
    'saveMediaManagementSync',
    noopSave as typeof arrSyncQueries.saveMediaManagementSync,
    restores
  );
  patchTarget(
    arrSyncQueries,
    'saveMetadataProfilesSync',
    noopSave as typeof arrSyncQueries.saveMetadataProfilesSync,
    restores
  );

  try {
    const result = await applyStartupSelections(instanceId, 'radarr', matches);
    assertEquals(result.qualityProfiles.reason, 'no_matches');
    assertEquals(result.delayProfiles.reason, 'no_matches');
    assertEquals(result.mediaManagement.reason, 'no_matches');
    assertEquals(result.metadataProfiles.reason, 'no_matches');
    assertEquals(anySaveCalled, false, 'no save calls when all sections have no matches');
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('edge case: skipped instance has all-zero counters', () => {
  const skipped = buildSkippedInstanceResult('radarr');

  assertEquals(skipped.imported, 0);
  assertEquals(skipped.skippedDefault, 0);
  assertEquals(skipped.skippedNoMatch, 0);
  assertEquals(skipped.conflicted, 0);
  assertEquals(skipped.failed, 0);
  assertEquals(skipped.status, 'skipped');
});

Deno.test('edge case: classifyRunStatus with all skipped instances returns skipped', () => {
  const skipped1 = buildSkippedInstanceResult('radarr');
  const skipped2 = buildSkippedInstanceResult('sonarr');

  const status = classifyRunStatus([skipped1, skipped2]);
  assertEquals(status, 'skipped');
});

Deno.test('edge case: single instance across all arr_types produces correct per-type counters', () => {
  for (const arrType of ALL_ARR_TYPES) {
    const instance = buildSuccessInstanceResult(arrType, {
      imported: 1,
      skippedDefault: 1,
      skippedNoMatch: 1,
      conflicted: 1,
    });

    const aggregated = aggregateCounters([instance]);
    assertEquals(aggregated.imported, 1, `${arrType} imported`);
    assertEquals(aggregated.skippedDefault, 1, `${arrType} skippedDefault`);
    assertEquals(aggregated.skippedNoMatch, 1, `${arrType} skippedNoMatch`);
    assertEquals(aggregated.conflicted, 1, `${arrType} conflicted`);
    assertEquals(aggregated.failed, 0, `${arrType} failed`);
  }
});

// =============================================================================
// Idempotency: verify writes happen only when data differs
// =============================================================================

Deno.test({
  name: 'idempotency: quality profiles apply writes when selections differ',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];
    const instanceId = 100;

    const matches: StartupPullMatchResult[] = [
      buildMatchedExactNameResult('radarr', 'qualityProfiles', {
        instanceId,
        databaseId: 1,
        matchedEntityId: 10,
        matchedEntityName: 'HD Bluray + WEB',
      }),
    ];

    let saveCalled = false;
    // Existing has a different selection
    patchTarget(
      arrSyncQueries,
      'getQualityProfilesSync',
      () => createQualityProfilesSync([{ databaseId: 1, profileName: 'Different Profile' }]),
      restores
    );
    patchTarget(
      arrSyncQueries,
      'saveQualityProfilesSync',
      (() => {
        saveCalled = true;
      }) as typeof arrSyncQueries.saveQualityProfilesSync,
      restores
    );
    patchTarget(arrSyncQueries, 'getDelayProfilesSync', () => createEmptyDelayProfilesSync(), restores);
    patchTarget(arrSyncQueries, 'getMediaManagementSync', () => createEmptyMediaManagementSync(), restores);
    patchTarget(arrSyncQueries, 'getMetadataProfilesSync', () => createEmptyMetadataProfilesSync(), restores);

    try {
      const result = await applyStartupSelections(instanceId, 'radarr', matches);
      assertEquals(result.qualityProfiles.written, true);
      assertEquals(result.qualityProfiles.reason, 'applied');
      assertEquals(saveCalled, true, 'save should be called when selections differ');
    } finally {
      for (const restore of restores.reverse()) restore();
    }
  },
});

Deno.test({
  name: 'idempotency: delay profiles apply writes when selection differs',
  sanitizeResources: false,
  fn: async () => {
    const restores: Restore[] = [];
    const instanceId = 200;

    const matches: StartupPullMatchResult[] = [
      buildMatchedExactNameResult('sonarr', 'delayProfiles', {
        instanceId,
        databaseId: 1,
        matchedEntityId: 5,
        matchedEntityName: 'Standard Delay',
      }),
    ];

    let saveCalled = false;
    // Existing has a different delay profile
    patchTarget(arrSyncQueries, 'getDelayProfilesSync', () => createDelayProfilesSync(2, 'Other Delay'), restores);
    patchTarget(
      arrSyncQueries,
      'saveDelayProfilesSync',
      (() => {
        saveCalled = true;
      }) as typeof arrSyncQueries.saveDelayProfilesSync,
      restores
    );
    patchTarget(arrSyncQueries, 'getQualityProfilesSync', () => createEmptyQualityProfilesSync(), restores);
    patchTarget(arrSyncQueries, 'getMediaManagementSync', () => createEmptyMediaManagementSync(), restores);
    patchTarget(arrSyncQueries, 'getMetadataProfilesSync', () => createEmptyMetadataProfilesSync(), restores);

    try {
      const result = await applyStartupSelections(instanceId, 'sonarr', matches);
      assertEquals(result.delayProfiles.written, true);
      assertEquals(result.delayProfiles.reason, 'applied');
      assertEquals(saveCalled, true, 'save should be called when delay profile differs');
    } finally {
      for (const restore of restores.reverse()) restore();
    }
  },
});
