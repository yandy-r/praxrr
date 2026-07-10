import { assert, assertEquals, assertExists } from '@std/assert';
import type { BaseArrClient } from '$arr/base.ts';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries, type ArrInstance } from '$db/queries/arrInstances.ts';
import type { ReviewedSyncClaim } from '$db/queries/arrSync.ts';
import { syncHistoryQueries } from '$db/queries/syncHistory.ts';
import { HttpError } from '$http/types.ts';
import { executeReviewedSyncJob, type ReviewedSyncExecutionDependencies } from '$jobs/handlers/arrSync.ts';
import { sanitizeArrWriteError } from '$sync/sanitizeArrWriteError.ts';
import { deriveSyncHistoryStatus } from '$sync/syncHistory/record.ts';
import { QualityProfileSyncer } from '$sync/qualityProfiles/syncer.ts';
import { syncCustomFormats } from '$sync/customFormats/syncer.ts';
import type { PcdCustomFormat } from '$sync/customFormats/transformer.ts';
import type { PcdQualityProfile } from '$sync/qualityProfiles/transformer.ts';
import { buildSyncPreviewReviewBinding } from '$sync/preview/reviewBinding.ts';
import type { SyncEntityOutcome } from '$sync/types.ts';
import type {
  SyncEntityChange,
  SyncHistoryInput,
  SyncPreviewArrType,
  SyncSectionResult,
} from '$sync/syncHistory/types.ts';

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

  assertEquals(
    sanitizeArrWriteError(new HttpError('x', 400)).reason,
    'The Arr instance rejected the request (HTTP 400).'
  );
  assertEquals(sanitizeArrWriteError(new HttpError('x', 408)).reason, 'The Arr instance timed out.');
  assertEquals(sanitizeArrWriteError(new HttpError('x', 0)).reason, 'Could not reach the Arr instance.');
  // Non-HTTP errors get a stable generic reason (never the message text).
  assertEquals(sanitizeArrWriteError(new Error('mock create failed')).reason, 'Sync write failed.');
  assertEquals(sanitizeArrWriteError('boom').reason, 'Sync write failed.');
});

// =============================================================================
// deriveSyncHistoryStatus — outcome-aware, never collapses to success (Gap 1)
// =============================================================================

const sectionSuccess: SyncSectionResult = {
  section: 'qualityProfiles',
  status: 'success',
  itemsSynced: 3,
  error: null,
};
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
    reason: status === 'success' ? null : 'The Arr instance rejected the request (HTTP 400).',
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
    customFormats: [],
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
      referencedFormatNames: [],
    })),
    customFormats: new Map<string, never>(),
    pcdFormatIdMap: new Map<string, number>(),
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
    },
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
  assertEquals(result.itemsSynced, 2);
  assertEquals(result.failedProfiles, ['second']);
});

Deno.test('syncCustomFormats treats a missing create response id as a failed outcome', async () => {
  const client = {
    getCustomFormats: () => Promise.resolve([]),
    updateCustomFormat: () => Promise.resolve({}),
    createCustomFormat: () => Promise.resolve({}),
  };
  const { outcomes, pcdFormatIdMap } = await syncCustomFormats(
    client as never,
    10,
    'radarr',
    new Map([['cf-missing-id', pcdFormat('cf-missing-id')]]),
    '-x'
  );

  assertEquals(outcomes.length, 1);
  assertEquals(outcomes[0].status, 'failed');
  assertEquals(outcomes[0].action, 'create');
  assertEquals(outcomes[0].remoteId, null);
  assertEquals(pcdFormatIdMap.has('cf-missing-id'), false);
});

// =============================================================================
// Custom formats — the previously-swallowed failure is now a surfaced outcome, and
// a Lidarr no-supported-conditions format is a skip (not silently dropped)
// =============================================================================

function pcdFormat(name: string, conditions: PcdCustomFormat['conditions'] = []): PcdCustomFormat {
  return { id: 1, name, includeInRename: false, conditions };
}

Deno.test('syncCustomFormats surfaces a failed outcome for a thrown write with a sanitized reason', async () => {
  const client = {
    getCustomFormats: () => Promise.resolve([]),
    updateCustomFormat: () => Promise.resolve({}),
    createCustomFormat: (fmt: { name: string }) => {
      if (fmt.name.includes('cf-fail')) {
        throw new HttpError('SECRET arr body: apiKey leaked', 400);
      }
      return Promise.resolve({ id: 7 });
    },
  };

  const pcdFormats = new Map<string, PcdCustomFormat>([
    ['cf-ok', pcdFormat('cf-ok')],
    ['cf-fail', pcdFormat('cf-fail')],
  ]);

  const { outcomes, pcdFormatIdMap } = await syncCustomFormats(client as never, 10, 'radarr', pcdFormats, '-x');

  assertEquals(outcomes.length, 2);
  const ok = outcomes.find((o) => o.name === 'cf-ok');
  const failed = outcomes.find((o) => o.name === 'cf-fail');
  assertExists(ok);
  assertExists(failed);
  assertEquals(ok.status, 'success');
  assertEquals(ok.entityType, 'customFormat');
  assertEquals(ok.remoteId, '7');
  assertEquals(failed.status, 'failed');
  // The previously-swallowed error is now surfaced, with a sanitized (non-leaking) reason.
  assertEquals(failed.reason, 'The Arr instance rejected the request (HTTP 400).');
  assert(!(failed.reason ?? '').includes('SECRET'), 'sanitized reason must not leak the raw Arr body');
  // The successful format's id still resolves for quality-profile scoring.
  assertEquals(pcdFormatIdMap.get('cf-ok'), 7);
});

Deno.test('syncCustomFormats emits a skipped outcome for a Lidarr format with no supported conditions', async () => {
  const client = {
    getCustomFormats: () => Promise.resolve([]),
    updateCustomFormat: () => Promise.resolve({}),
    createCustomFormat: () => Promise.resolve({ id: 1 }),
  };

  // A `source` condition is not in LIDARR_SUPPORTED_CONDITION_TYPES, so it is dropped; with the
  // only condition dropped, the format has no supported conditions and is skipped (not written).
  const pcdFormats = new Map<string, PcdCustomFormat>([
    [
      'lidarr-cf',
      pcdFormat('lidarr-cf', [
        { name: 'src', type: 'source', arrType: 'all', negate: false, required: false, sources: ['bluray'] },
      ]),
    ],
  ]);

  const { outcomes } = await syncCustomFormats(client as never, 11, 'lidarr', pcdFormats, '-x');

  assertEquals(outcomes.length, 1);
  assertEquals(outcomes[0].status, 'skipped');
  assertEquals(outcomes[0].name, 'lidarr-cf');
  assertEquals(outcomes[0].arrType, 'lidarr');
  assert((outcomes[0].reason ?? '').length > 0, 'a skipped outcome must carry a reason');
});

// =============================================================================
// Reviewed-plan rejection — evidence is authorization, never a confirmed outcome
// =============================================================================

Deno.test('review evidence invalidation creates no confirmed outcome or Sync History row', async () => {
  const nowMs = Date.parse('2026-07-10T12:00:00.000Z');
  const reviewedEvidence = {
    section: 'qualityProfiles' as const,
    pcd: { revision: 1, desired: 'Reviewed HD' },
    arr: { revision: 1, remoteId: 7 },
    plan: { action: 'update', fields: ['cutoff'] },
  };
  const binding = await buildSyncPreviewReviewBinding({
    instanceId: 234,
    arrType: 'radarr',
    target: {
      url: 'http://127.0.0.1:7878',
      credentialFingerprint: 'credential-v1',
      credentialKeyVersion: 'legacy',
      credentialRevision: '2026-07-10T10:00:00.000Z',
    },
    sections: ['qualityProfiles'],
    sectionConfigs: { qualityProfiles: { selections: ['Reviewed HD'] } },
    evidence: [reviewedEvidence],
  });
  const instance: ArrInstance = {
    id: 234,
    name: 'Reviewed Radarr',
    type: 'radarr',
    url: 'http://127.0.0.1:7878',
    external_url: null,
    api_key_fingerprint: 'credential-v1',
    api_key: 'test-key',
    tags: null,
    enabled: 1,
    source: 'ui',
    detected_version: '5.14.0.9383',
    detected_at: '2026-07-10T11:00:00.000Z',
    created_at: '2026-07-10T10:00:00.000Z',
    updated_at: '2026-07-10T10:00:00.000Z',
  };
  const claim = Object.freeze({
    instanceId: instance.id,
    sections: Object.freeze(['qualityProfiles'] as const),
  }) as ReviewedSyncClaim;
  const calls = { snapshots: 0, history: 0, handlers: 0, failedClaim: 0 };
  const client = { close: () => undefined } as unknown as BaseArrClient;
  const dependencies = {
    now: () => nowMs,
    getInstance: () => instance,
    getReviewTarget: () => ({
      url: instance.url,
      credentialFingerprint: 'credential-v1',
      credentialKeyVersion: 'legacy',
      credentialRevision: instance.updated_at,
    }),
    getClient: () => Promise.resolve(client),
    detectVersion: () => Promise.resolve(null),
    claimSections: () => claim,
    releaseSections: () => true,
    completeSections: () => true,
    failSections: () => {
      calls.failedClaim += 1;
      return true;
    },
    materializeReview: () =>
      Promise.resolve({
        preview: { sections: ['qualityProfiles'] },
        reviewContext: {
          sectionConfigs: binding.sectionConfigs,
          evidence: [{ ...reviewedEvidence, pcd: { revision: 2, desired: 'Unreviewed UHD' } }],
          preparedExecutionContexts: {},
        },
      }),
    createSnapshot: () => {
      calls.snapshots += 1;
      return Promise.resolve(null);
    },
    recordHistory: () => {
      calls.history += 1;
      return 1;
    },
    getSectionHandler: () => {
      calls.handlers += 1;
      throw new Error('review invalidation must not reach a writer');
    },
  } as unknown as ReviewedSyncExecutionDependencies;

  const result = await executeReviewedSyncJob({
    binding,
    sections: ['qualityProfiles'],
    previewId: 'preview-invalidated-before-write',
    expiresAt: new Date(nowMs + 60_000).toISOString(),
    dependencies,
  });

  assertEquals(result, {
    kind: 'invalidated',
    reason: 'pcd_drift',
    changedEvidence: ['pcd'],
    changedSections: ['qualityProfiles'],
    outcomes: [],
    syncHistoryId: null,
  });
  assertEquals(calls, { snapshots: 0, history: 0, handlers: 0, failedClaim: 1 });
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
    },
  });
}

function seedInstance(type: SyncPreviewArrType): number {
  const port = type === 'radarr' ? 7878 : type === 'sonarr' ? 8989 : 8686;
  return arrInstancesQueries.create({
    name: `${type}-${crypto.randomUUID()}`,
    type,
    url: `http://localhost:${port}`,
    apiKey: 'test-api-key',
  });
}

function baseInput(
  instanceId: number,
  arrType: SyncPreviewArrType,
  overrides: Partial<SyncHistoryInput>
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
    ...overrides,
  };
}

// Per-arr supported (section, entityType) outcome shapes — the parity matrix. metadataProfiles is
// Lidarr-only; every arr supports qualityProfiles/delayProfiles/mediaManagement.
const OUTCOME_MATRIX: Record<SyncPreviewArrType, SyncEntityOutcome[]> = {
  radarr: [
    {
      section: 'qualityProfiles',
      arrType: 'radarr',
      entityType: 'customFormat',
      name: 'HDR10',
      action: 'create',
      status: 'success',
      remoteId: '5',
      reason: null,
    },
    {
      section: 'qualityProfiles',
      arrType: 'radarr',
      entityType: 'qualityProfile',
      name: 'HD',
      action: 'update',
      status: 'success',
      remoteId: '1',
      reason: null,
    },
    {
      section: 'delayProfiles',
      arrType: 'radarr',
      entityType: 'delayProfile',
      name: 'Default',
      action: 'update',
      status: 'success',
      remoteId: '1',
      reason: null,
    },
    {
      section: 'mediaManagement',
      arrType: 'radarr',
      entityType: 'qualityDefinitions',
      name: 'sizes',
      action: 'update',
      status: 'skipped',
      remoteId: null,
      reason: 'No quality definitions matched between the source config and this instance.',
    },
  ],
  sonarr: [
    {
      section: 'qualityProfiles',
      arrType: 'sonarr',
      entityType: 'qualityProfile',
      name: 'WEB-1080p',
      action: 'create',
      status: 'success',
      remoteId: '2',
      reason: null,
    },
    {
      section: 'delayProfiles',
      arrType: 'sonarr',
      entityType: 'delayProfile',
      name: 'Default',
      action: 'update',
      status: 'failed',
      remoteId: '1',
      reason: 'The Arr instance returned an error (HTTP 500).',
    },
    {
      section: 'mediaManagement',
      arrType: 'sonarr',
      entityType: 'naming',
      name: 'Standard',
      action: 'update',
      status: 'success',
      remoteId: '1',
      reason: null,
    },
  ],
  lidarr: [
    {
      section: 'qualityProfiles',
      arrType: 'lidarr',
      entityType: 'customFormat',
      name: 'Lossless',
      action: 'create',
      status: 'skipped',
      remoteId: null,
      reason: 'No custom format conditions are supported on Lidarr.',
    },
    {
      section: 'metadataProfiles',
      arrType: 'lidarr',
      entityType: 'metadataProfile',
      name: 'Standard',
      action: 'update',
      status: 'success',
      remoteId: '3',
      reason: null,
    },
    {
      section: 'mediaManagement',
      arrType: 'lidarr',
      entityType: 'mediaSettings',
      name: 'settings',
      action: 'update',
      status: 'skipped',
      remoteId: null,
      reason: 'Field is not represented by the Lidarr API config payload and is skipped during sync',
    },
  ],
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
        status: outcomes.some((o) => o.status === 'failed') ? 'partial' : 'success',
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

migratedTest('planned review changes and confirmed write outcomes remain separate persisted evidence', () => {
  const instanceId = seedInstance('radarr');
  const plannedChange: SyncEntityChange = {
    section: 'qualityProfiles',
    category: 'qualityProfiles',
    entityType: 'qualityProfile',
    name: 'Reviewed HD',
    action: 'update',
    remoteId: 7,
    fields: [{ field: 'cutoff', type: 'changed', current: 10, desired: 20 }],
  };
  const confirmedOutcome: SyncEntityOutcome = {
    section: 'qualityProfiles',
    arrType: 'radarr',
    entityType: 'qualityProfile',
    name: 'Reviewed HD',
    action: 'update',
    status: 'failed',
    remoteId: '7',
    reason: 'The Arr instance rejected the request (HTTP 400).',
  };

  const id = syncHistoryQueries.insert(
    baseInput(instanceId, 'radarr', {
      status: 'failed',
      changes: [plannedChange],
      entityOutcomes: [confirmedOutcome],
      previewId: 'preview-planned-versus-confirmed',
    })
  );
  const detail = syncHistoryQueries.getById(id);
  assertExists(detail);
  assertEquals(detail.changes, [plannedChange]);
  assertEquals(detail.entityOutcomes, [confirmedOutcome]);
  assertEquals(detail.changes[0].action, detail.entityOutcomes[0].action);
  assertEquals('status' in detail.changes[0], false);
  assertEquals('fields' in detail.entityOutcomes[0], false);
});
