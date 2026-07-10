import { assert, assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { syncHistoryQueries } from '$db/queries/syncHistory.ts';
import { HttpError } from '$http/types.ts';
import { sanitizeArrWriteError } from '$sync/sanitizeArrWriteError.ts';
import { deriveSyncHistoryStatus } from '$sync/syncHistory/record.ts';
import { QualityProfileSyncer } from '$sync/qualityProfiles/syncer.ts';
import type { PcdQualityProfile } from '$sync/qualityProfiles/transformer.ts';
import type { SyncEntityOutcome } from '$sync/types.ts';
import type { SyncHistoryInput, SyncPreviewArrType, SyncSectionResult } from '$sync/syncHistory/types.ts';

// =============================================================================
// sanitizeArrWriteError — user-facing reason is NEVER the raw Arr body (D9)
// =============================================================================

Deno.test('sanitizeArrWriteError classifies HTTP status without leaking the raw message', () => {
  const rawBody = 'SECRET: apiKey=abcd1234 rejected value "movieFormat"';

  const server = sanitizeArrWriteError(new HttpError(rawBody, 500));
  assertEquals(server.reason, 'The Arr instance returned an error (HTTP 500).');
  assert(!server.reason.includes(rawBody), 'reason must not embed the raw Arr body');
  assert(!server.reason.includes('apiKey'), 'reason must not leak credentials from the body');
  // Diagnostics are preserved for protected logs only.
  assertEquals(server.protectedDetails.status, 500);
  assertEquals(server.protectedDetails.error, rawBody);

  assertEquals(sanitizeArrWriteError(new HttpError('x', 400)).reason, 'The Arr instance rejected the request (HTTP 400).');
  assertEquals(sanitizeArrWriteError(new HttpError('x', 408)).reason, 'The Arr instance timed out.');
  assertEquals(sanitizeArrWriteError(new HttpError('x', 0)).reason, 'Could not reach the Arr instance.');
  // Non-HTTP errors get a stable generic reason (never the message text).
  assertEquals(sanitizeArrWriteError(new Error('mock create failed')).reason, 'Sync write failed.');
  assertEquals(sanitizeArrWriteError('boom').reason, 'Sync write failed.');
});

// =============================================================================
// deriveSyncHistoryStatus — outcome-aware, never collapses to success (Gap 1)
// =============================================================================

const sectionSuccess: SyncSectionResult = { section: 'qualityProfiles', status: 'success', itemsSynced: 3, error: null };
const sectionFailed: SyncSectionResult = { section: 'delayProfiles', status: 'failed', itemsSynced: 0, error: 'boom' };

function outcome(status: SyncEntityOutcome['status']): SyncEntityOutcome {
  return {
    section: 'qualityProfiles',
    arrType: 'radarr',
    entityType: 'customFormat',
    name: 'HDR10',
    action: 'create',
    status,
    remoteId: null,
    reason: status === 'success' ? null : 'The Arr instance rejected the request (HTTP 400).'
  };
}

Deno.test('deriveSyncHistoryStatus pulls a run to partial when a single entity outcome failed', () => {
  // Section reports success (its own writes succeeded) but one entity write inside it failed.
  const status = deriveSyncHistoryStatus(1, 0, [sectionSuccess], [outcome('success'), outcome('failed')]);
  assertEquals(status, 'partial');
});

Deno.test('deriveSyncHistoryStatus stays success only when nothing failed', () => {
  assertEquals(deriveSyncHistoryStatus(1, 0, [sectionSuccess], [outcome('success'), outcome('skipped')]), 'success');
  assertEquals(deriveSyncHistoryStatus(1, 0, [sectionSuccess], []), 'success');
});

Deno.test('deriveSyncHistoryStatus reports failed only when nothing succeeded, skipped when nothing ran', () => {
  assertEquals(deriveSyncHistoryStatus(1, 1, [sectionFailed], [outcome('failed')]), 'failed');
  assertEquals(deriveSyncHistoryStatus(0, 0, [], []), 'skipped');
  // Mixed section success + section failure is still partial.
  assertEquals(deriveSyncHistoryStatus(2, 1, [sectionSuccess, sectionFailed], []), 'partial');
});

// =============================================================================
// Quality Profile syncer — confirmed outcomes come from the WRITE, not intent
// (mandated partial-QP-failure + "EntityChange never used as confirmation")
// =============================================================================

function createProfile(name: string): PcdQualityProfile {
  return {
    id: 1,
    name,
    upgradesAllowed: true,
    minimumCustomFormatScore: 0,
    upgradeUntilScore: 0,
    upgradeScoreIncrement: 1,
    qualities: [],
    language: null,
    customFormats: []
  };
}

function createBatch(databaseId: number, suffix: string, profileNames: string[]) {
  return {
    sourceKind: 'pcd' as const,
    sourceLabel: `source-${databaseId}`,
    databaseId,
    suffix,
    profiles: profileNames.map((profileName) => ({
      pcdProfile: createProfile(profileName),
      referencedFormatNames: []
    })),
    customFormats: new Map<string, never>(),
    pcdFormatIdMap: new Map<string, number>()
  };
}

type BatchOverride = {
  fetchSyncBatches: () => Promise<ReturnType<typeof createBatch>[]>;
  getQualityMappings: (batches: unknown[]) => Promise<Map<string, string>>;
};

Deno.test('quality profile sync emits one terminal outcome per profile sourced from the write result', async () => {
  // Preview intent would say "create" for all three; the SECOND create throws. The outcome status
  // must track the actual write (failed), never the planned action — proving EntityChange is never
  // used as confirmation.
  let createCalls = 0;
  const client = {
    getCustomFormats: () => Promise.resolve([]),
    getQualityProfiles: () => Promise.resolve([]),
    updateQualityProfile: () => Promise.resolve({}),
    createQualityProfile: () => {
      createCalls += 1;
      if (createCalls === 2) {
        throw new HttpError('SECRET arr body: rejected value', 400);
      }
      return Promise.resolve({ id: createCalls * 10, name: 'ok', cutoff: 0, qualityProfile: {} });
    }
  };

  const syncer = new QualityProfileSyncer(client as never, 10, 'Test', 'radarr');
  const syncerAny = syncer as unknown as BatchOverride;
  syncerAny.fetchSyncBatches = () => Promise.resolve([createBatch(1, '-x', ['first', 'second', 'third'])]);
  syncerAny.getQualityMappings = () => Promise.resolve(new Map());

  const result = await syncer.sync();

  // One outcome per attempted entity, in order.
  assertEquals(result.outcomes.length, 3);
  const [first, second, third] = result.outcomes;

  assertEquals(first.status, 'success');
  assertEquals(first.action, 'create');
  assertEquals(first.name, 'first');
  assertEquals(first.arrType, 'radarr');
  assertEquals(first.entityType, 'qualityProfile');
  assertEquals(first.remoteId, '10');
  assertEquals(first.reason, null);

  assertEquals(second.status, 'failed');
  assertEquals(second.name, 'second');
  // The user-facing reason is sanitized — never the raw Arr body.
  assertEquals(second.reason, 'The Arr instance rejected the request (HTTP 400).');
  assert(!(second.reason ?? '').includes('SECRET'), 'sanitized reason must not leak the raw Arr body');

  assertEquals(third.status, 'success');
  assertEquals(third.name, 'third');
  assertEquals(third.remoteId, '30');

  // Back-compat aggregate still reflects the failure.
  assertEquals(result.success, false);
  assertEquals(result.failedProfiles, ['second']);
});

// =============================================================================
// Persistence + parity — outcomes round-trip per arr_type and correlate to a preview
// =============================================================================

function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/sync-entity-outcomes-${crypto.randomUUID()}`;
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
    }
  });
}

function seedInstance(type: SyncPreviewArrType): number {
  const port = type === 'radarr' ? 7878 : type === 'sonarr' ? 8989 : 8686;
  return arrInstancesQueries.create({
    name: `${type}-${crypto.randomUUID()}`,
    type,
    url: `http://localhost:${port}`,
    apiKey: 'test-api-key'
  });
}

function baseInput(instanceId: number, arrType: SyncPreviewArrType, overrides: Partial<SyncHistoryInput>): SyncHistoryInput {
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
    itemsSynced: 1,
    failureCount: 0,
    sectionResults: [],
    changes: [],
    entityOutcomes: [],
    previewId: null,
    error: null,
    startedAt: '2026-07-10T10:00:00.000Z',
    finishedAt: '2026-07-10T10:00:01.000Z',
    durationMs: 1000,
    ...overrides
  };
}

// Per-arr supported (section, entityType) outcome shapes — the parity matrix. metadataProfiles is
// Lidarr-only; every arr supports qualityProfiles/delayProfiles/mediaManagement.
const OUTCOME_MATRIX: Record<SyncPreviewArrType, SyncEntityOutcome[]> = {
  radarr: [
    { section: 'qualityProfiles', arrType: 'radarr', entityType: 'customFormat', name: 'HDR10', action: 'create', status: 'success', remoteId: '5', reason: null },
    { section: 'qualityProfiles', arrType: 'radarr', entityType: 'qualityProfile', name: 'HD', action: 'update', status: 'success', remoteId: '1', reason: null },
    { section: 'delayProfiles', arrType: 'radarr', entityType: 'delayProfile', name: 'Default', action: 'update', status: 'success', remoteId: '1', reason: null },
    { section: 'mediaManagement', arrType: 'radarr', entityType: 'qualityDefinitions', name: 'sizes', action: 'update', status: 'skipped', remoteId: null, reason: 'No quality definitions matched between the source config and this instance.' }
  ],
  sonarr: [
    { section: 'qualityProfiles', arrType: 'sonarr', entityType: 'qualityProfile', name: 'WEB-1080p', action: 'create', status: 'success', remoteId: '2', reason: null },
    { section: 'delayProfiles', arrType: 'sonarr', entityType: 'delayProfile', name: 'Default', action: 'update', status: 'failed', remoteId: '1', reason: 'The Arr instance returned an error (HTTP 500).' },
    { section: 'mediaManagement', arrType: 'sonarr', entityType: 'naming', name: 'Standard', action: 'update', status: 'success', remoteId: '1', reason: null }
  ],
  lidarr: [
    { section: 'qualityProfiles', arrType: 'lidarr', entityType: 'customFormat', name: 'Lossless', action: 'create', status: 'skipped', remoteId: null, reason: 'No custom format conditions are supported on Lidarr.' },
    { section: 'metadataProfiles', arrType: 'lidarr', entityType: 'metadataProfile', name: 'Standard', action: 'update', status: 'success', remoteId: '3', reason: null },
    { section: 'mediaManagement', arrType: 'lidarr', entityType: 'mediaSettings', name: 'settings', action: 'update', status: 'skipped', remoteId: null, reason: 'Field is not represented by the Lidarr API config payload and is skipped during sync' }
  ]
};

migratedTest('entity outcomes round-trip through insert/getById for every supported arr_type', () => {
  for (const arrType of ['radarr', 'sonarr', 'lidarr'] as const) {
    const instanceId = seedInstance(arrType);
    const outcomes = OUTCOME_MATRIX[arrType];
    const previewId = `preview-${arrType}-${crypto.randomUUID()}`;

    const id = syncHistoryQueries.insert(
      baseInput(instanceId, arrType, {
        entityOutcomes: outcomes,
        previewId,
        status: outcomes.some((o) => o.status === 'failed') ? 'partial' : 'success'
      })
    );

    const detail = syncHistoryQueries.getById(id);
    assertExists(detail);
    // The confirmed outcomes survive the JSON blob round-trip exactly.
    assertEquals(detail.entityOutcomes, outcomes);
    assertEquals(detail.entityOutcomeCount, outcomes.length);
    // Correlation to the reviewed preview is persisted and queryable.
    assertEquals(detail.previewId, previewId);
    // Confirmed outcomes stay distinct from planned changes (which were empty here).
    assertEquals(detail.changes, []);
  }
});

migratedTest('summary rows carry the outcome count and preview correlation without decoding the blob', () => {
  const instanceId = seedInstance('radarr');
  const outcomes = OUTCOME_MATRIX.radarr;
  const previewId = `preview-summary-${crypto.randomUUID()}`;
  syncHistoryQueries.insert(baseInput(instanceId, 'radarr', { entityOutcomes: outcomes, previewId }));

  const summaries = syncHistoryQueries.search({ instanceId }, { limit: 10, offset: 0 });
  assertEquals(summaries.length, 1);
  assertEquals(summaries[0].entityOutcomeCount, outcomes.length);
  assertEquals(summaries[0].previewId, previewId);
});
