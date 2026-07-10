import { assertEquals, assertExists } from '@std/assert';
import type { BaseArrClient } from '$arr/base.ts';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import type { ReviewedSyncClaim } from '$db/queries/arrSync.ts';
import { executeReviewedSyncJob, type ReviewedSyncExecutionDependencies } from '$jobs/handlers/arrSync.ts';
import type { SectionHandler, SectionType, SyncEntityOutcome } from '$sync/types.ts';
import type { GeneratePreviewResult } from '$sync/preview/orchestrator.ts';
import { buildSyncPreviewReviewBinding } from '$sync/preview/reviewBinding.ts';
import { syncPreviewReviewTarget } from '$sync/preview/reviewBinding.ts';
import type {
  SyncPreviewPreparedExecutionContext,
  SyncPreviewReviewBinding,
  SyncPreviewSection,
  SyncPreviewSectionMaterializedEvidence,
} from '$sync/preview/types.ts';

const NOW_MS = Date.parse('2026-07-10T12:00:00.000Z');
const EXPIRES_AT = new Date(NOW_MS + 60_000).toISOString();

function instance(overrides: Partial<ArrInstance> = {}): ArrInstance {
  return {
    id: 7,
    name: 'Reviewed Radarr',
    type: 'radarr',
    url: 'http://127.0.0.1:7878',
    external_url: null,
    api_key_fingerprint: 'credential-v1',
    api_key: 'test-key',
    tags: null,
    enabled: 1,
    detected_version: '5.14.0.9383',
    detected_at: '2026-07-10T11:00:00.000Z',
    created_at: '2026-07-10T10:00:00.000Z',
    updated_at: '2026-07-10T10:00:00.000Z',
    ...overrides,
  };
}

function evidence(
  section: SyncPreviewSection,
  values: { pcd?: unknown; arr?: unknown; plan?: unknown } = {}
): SyncPreviewSectionMaterializedEvidence {
  return {
    section,
    pcd: values.pcd ?? { revision: 1 },
    arr: values.arr ?? { revision: 1 },
    plan: values.plan ?? { section, action: 'update' },
  };
}

function prepared(
  section: SyncPreviewSection,
  desired: unknown = { name: `${section}-reviewed` },
  config: unknown = {}
): SyncPreviewPreparedExecutionContext {
  return Object.freeze({
    section,
    config: structuredClone(config),
    desired: structuredClone(desired),
    materialPlan: { section },
    currentGuards: { revision: 1 },
  });
}

function previewFor(
  sections: readonly SyncPreviewSection[],
  overrides: Partial<GeneratePreviewResult> = {}
): GeneratePreviewResult {
  return {
    instanceId: 7,
    instanceName: 'Reviewed Radarr',
    arrType: 'radarr',
    status: 'ready',
    createdAtMs: NOW_MS,
    sections: [...sections],
    sectionOutcomes: sections.map((section) => ({ section, failure: null, skipped: false })),
    qualityProfiles: null,
    delayProfiles: null,
    mediaManagement: null,
    metadataProfiles: null,
    summary: {
      totalCreates: 0,
      totalUpdates: 0,
      totalDeletes: 0,
      totalUnchanged: 0,
    },
    ...overrides,
  };
}

async function bindingFor(
  sections: readonly SyncPreviewSection[],
  materializedEvidence: readonly SyncPreviewSectionMaterializedEvidence[],
  sectionConfigs: Readonly<Partial<Record<SyncPreviewSection, unknown>>> = {}
): Promise<SyncPreviewReviewBinding> {
  return await buildSyncPreviewReviewBinding({
    instanceId: 7,
    arrType: 'radarr',
    target: syncPreviewReviewTarget(instance()),
    sections,
    sectionConfigs,
    evidence: materializedEvidence,
  });
}

interface HarnessOptions {
  binding: SyncPreviewReviewBinding;
  actualEvidence: readonly SyncPreviewSectionMaterializedEvidence[];
  contexts: Readonly<Partial<Record<SyncPreviewSection, SyncPreviewPreparedExecutionContext>>>;
  claim?: ReviewedSyncClaim | null;
  currentInstance?: ArrInstance;
  preview?: GeneratePreviewResult;
  onMaterialize?: () => void;
  onAcquireReviewClient?: () => void;
  sync?: (
    context: SyncPreviewPreparedExecutionContext,
    section: SyncPreviewSection
  ) => Promise<{
    success: boolean;
    itemsSynced: number;
    outcomes: SyncEntityOutcome[];
    error?: string;
  }>;
}

function harness(options: HarnessOptions) {
  const calls = {
    snapshots: 0,
    history: 0,
    writes: 0,
    release: 0,
    complete: 0,
    fail: 0,
    clients: 0,
    materializations: 0,
    capturedHistory: null as Record<string, unknown> | null,
  };
  const claim =
    options.claim === undefined
      ? (Object.freeze({ instanceId: 7, sections: Object.freeze([...options.binding.sections]) }) as ReviewedSyncClaim)
      : options.claim;
  let activeContext: SyncPreviewPreparedExecutionContext | null = null;
  const client = { close: () => undefined } as unknown as BaseArrClient;
  const handler = (section: SyncPreviewSection): SectionHandler => ({
    type: section,
    setShouldSync: () => undefined,
    setNextRunAt: () => undefined,
    claimSync: () => false,
    completeSync: () => undefined,
    failSync: () => undefined,
    setStatusPending: () => undefined,
    getPendingInstanceIds: () => [],
    getScheduledConfigs: () => [],
    hasConfig: () => true,
    createSyncer: (syncClient) => {
      assertEquals(syncClient, client);
      return {
        setPreparedExecutionContext: (context: SyncPreviewPreparedExecutionContext) => {
          activeContext = structuredClone(context);
        },
        clearPreparedExecutionContext: () => {
          activeContext = null;
        },
        setPreviewConfig: () => undefined,
        clearPreviewConfig: () => undefined,
        generatePreview: () => Promise.reject(new Error('not used')),
        sync: async () => {
          assertExists(activeContext);
          calls.writes += 1;
          return options.sync
            ? await options.sync(activeContext, section)
            : { success: true, itemsSynced: 0, outcomes: [] };
        },
      } as never;
    },
  });

  const dependencies = {
    now: () => NOW_MS,
    getInstance: () => options.currentInstance ?? instance(),
    getReviewClient: () => {
      calls.clients += 1;
      options.onAcquireReviewClient?.();
      const targetInstance = options.currentInstance ?? instance();
      return Promise.resolve({
        client,
        credentialIdentity: {
          fingerprint: targetInstance.api_key_fingerprint!,
          keyVersion: 'legacy',
          revision: targetInstance.updated_at,
        },
      });
    },
    detectVersion: () => Promise.resolve(null),
    claimSections: () => claim,
    releaseSections: () => {
      calls.release += 1;
      return true;
    },
    completeSections: () => {
      calls.complete += 1;
      return true;
    },
    failSections: () => {
      calls.fail += 1;
      return true;
    },
    materializeReview: (
      _instance: ArrInstance,
      _sections: readonly SectionType[],
      _configs: Readonly<Partial<Record<SyncPreviewSection, unknown>>>,
      materializeClient: BaseArrClient
    ) => {
      assertEquals(materializeClient, client);
      calls.materializations += 1;
      options.onMaterialize?.();
      return Promise.resolve({
        preview: options.preview ?? previewFor(options.binding.sections),
        reviewContext: {
          sectionConfigs: options.binding.sectionConfigs,
          evidence: options.actualEvidence,
          preparedExecutionContexts: options.contexts,
        },
      });
    },
    createSnapshot: () => {
      calls.snapshots += 1;
      return Promise.resolve(null);
    },
    recordHistory: (input: Record<string, unknown>) => {
      calls.history += 1;
      calls.capturedHistory = input;
      return 91;
    },
    getSectionHandler: handler,
  } as unknown as ReviewedSyncExecutionDependencies;

  return { calls, dependencies };
}

Deno.test('reviewed executor validates every selected section before any write-side evidence', async () => {
  const sections = ['qualityProfiles', 'delayProfiles'] as const;
  const reviewedEvidence = sections.map((section) => evidence(section));
  const binding = await bindingFor(sections, reviewedEvidence);
  const actualEvidence = [evidence('qualityProfiles'), evidence('delayProfiles', { arr: { revision: 2 } })];
  const { calls, dependencies } = harness({
    binding,
    actualEvidence,
    contexts: {
      qualityProfiles: prepared('qualityProfiles'),
      delayProfiles: prepared('delayProfiles'),
    },
  });

  const result = await executeReviewedSyncJob({
    binding,
    sections,
    previewId: 'preview-drift',
    expiresAt: EXPIRES_AT,
    dependencies,
  });

  assertEquals(result.kind, 'invalidated');
  if (result.kind === 'invalidated') {
    assertEquals(result.reason, 'arr_drift');
    assertEquals(result.changedEvidence, ['arr']);
    assertEquals(result.changedSections, ['delayProfiles']);
    assertEquals(result.outcomes, []);
    assertEquals(result.syncHistoryId, null);
  }
  assertEquals(calls, {
    snapshots: 0,
    history: 0,
    writes: 0,
    release: 1,
    complete: 0,
    fail: 0,
    clients: 1,
    materializations: 1,
    capturedHistory: null,
  });
});

Deno.test('pre-write invalidation exactly restores an initially pending ordinary signal', async () => {
  const sections = ['qualityProfiles'] as const;
  const reviewedEvidence = [evidence('qualityProfiles')];
  const binding = await bindingFor(sections, reviewedEvidence);
  const { calls, dependencies: baseDependencies } = harness({
    binding,
    actualEvidence: [evidence('qualityProfiles', { pcd: { revision: 2 } })],
    contexts: { qualityProfiles: prepared('qualityProfiles') },
  });
  let queueState = { status: 'pending', shouldSync: 1 };
  const dependencies = {
    ...baseDependencies,
    claimSections: (instanceId: number, selectedSections: readonly SectionType[]) => {
      assertEquals(queueState, { status: 'pending', shouldSync: 1 });
      queueState = { status: 'in_progress', shouldSync: 0 };
      return baseDependencies.claimSections(instanceId, selectedSections);
    },
    releaseSections: (claim: ReviewedSyncClaim) => {
      const released = baseDependencies.releaseSections(claim);
      queueState = { status: 'pending', shouldSync: 1 };
      return released;
    },
    failSections: (claim: ReviewedSyncClaim, error: string) => {
      queueState = { status: 'failed', shouldSync: 0 };
      return baseDependencies.failSections(claim, error);
    },
  } satisfies ReviewedSyncExecutionDependencies;

  const result = await executeReviewedSyncJob({
    binding,
    sections,
    previewId: 'preview-initially-pending-invalidated',
    expiresAt: EXPIRES_AT,
    dependencies,
  });

  assertEquals(result.kind, 'invalidated');
  assertEquals(queueState, { status: 'pending', shouldSync: 1 });
  assertEquals(calls.release, 1);
  assertEquals(calls.fail, 0);
  assertEquals(calls.snapshots, 0);
  assertEquals(calls.history, 0);
  assertEquals(calls.writes, 0);
});

Deno.test('reviewed executor rejects a reordered reviewed subset before claim or materialization', async () => {
  const reviewedSections = ['qualityProfiles', 'delayProfiles', 'mediaManagement'] as const;
  const reviewedEvidence = reviewedSections.map((section) => evidence(section));
  const binding = await bindingFor(reviewedSections, reviewedEvidence);
  const { calls, dependencies } = harness({
    binding,
    actualEvidence: reviewedEvidence,
    contexts: {
      qualityProfiles: prepared('qualityProfiles'),
      delayProfiles: prepared('delayProfiles'),
      mediaManagement: prepared('mediaManagement'),
    },
  });

  const result = await executeReviewedSyncJob({
    binding,
    sections: ['mediaManagement', 'qualityProfiles'],
    previewId: 'preview-reordered-subset',
    expiresAt: EXPIRES_AT,
    dependencies,
  });

  assertEquals(result, {
    kind: 'invalidated',
    reason: 'scope_drift',
    changedEvidence: [],
    changedSections: ['mediaManagement', 'qualityProfiles'],
    outcomes: [],
    syncHistoryId: null,
  });
  assertEquals(calls.clients, 0);
  assertEquals(calls.materializations, 0);
  assertEquals(calls.snapshots, 0);
  assertEquals(calls.history, 0);
  assertEquals(calls.writes, 0);
});

Deno.test('reviewed executor expires after materialization without starting any side effect', async () => {
  const sections = ['qualityProfiles'] as const;
  const reviewedEvidence = [evidence('qualityProfiles')];
  const binding = await bindingFor(sections, reviewedEvidence);
  let clockMs = NOW_MS;
  const { calls, dependencies: baseDependencies } = harness({
    binding,
    actualEvidence: reviewedEvidence,
    contexts: { qualityProfiles: prepared('qualityProfiles') },
    onMaterialize: () => {
      clockMs = Date.parse(EXPIRES_AT);
    },
  });
  const dependencies = {
    ...baseDependencies,
    now: () => clockMs,
  } satisfies ReviewedSyncExecutionDependencies;

  const result = await executeReviewedSyncJob({
    binding,
    sections,
    previewId: 'preview-expired-after-materialization',
    expiresAt: EXPIRES_AT,
    dependencies,
  });

  assertEquals(result, { kind: 'expired', outcomes: [], syncHistoryId: null });
  assertEquals(calls.snapshots, 0);
  assertEquals(calls.history, 0);
  assertEquals(calls.writes, 0);
  assertEquals(calls.release, 1);
  assertEquals(calls.complete, 0);
  assertEquals(calls.fail, 0);
  assertEquals(calls.materializations, 1);
});

Deno.test('reviewed executor rejects same-type target retarget before materialization or writing', async () => {
  const sections = ['qualityProfiles'] as const;
  const reviewedEvidence = [evidence('qualityProfiles')];
  const binding = await bindingFor(sections, reviewedEvidence);
  const { calls, dependencies } = harness({
    binding,
    actualEvidence: reviewedEvidence,
    contexts: { qualityProfiles: prepared('qualityProfiles') },
    currentInstance: instance({ url: 'http://127.0.0.1:8787' }),
  });

  const result = await executeReviewedSyncJob({
    binding,
    sections,
    previewId: 'preview-retarget',
    expiresAt: EXPIRES_AT,
    dependencies,
  });

  assertEquals(result.kind, 'invalidated');
  assertEquals(result.kind === 'invalidated' ? result.reason : null, 'scope_drift');
  assertEquals(calls.clients, 1);
  assertEquals(calls.writes, 0);
  assertEquals(calls.history, 0);
});

Deno.test('reviewed executor rejects credential rotation before materialization or writing', async () => {
  const sections = ['qualityProfiles'] as const;
  const reviewedEvidence = [evidence('qualityProfiles')];
  const binding = await bindingFor(sections, reviewedEvidence);
  const { calls, dependencies } = harness({
    binding,
    actualEvidence: reviewedEvidence,
    contexts: { qualityProfiles: prepared('qualityProfiles') },
    currentInstance: instance({ api_key_fingerprint: 'credential-v2' }),
  });

  const result = await executeReviewedSyncJob({
    binding,
    sections,
    previewId: 'preview-credential-rotation',
    expiresAt: EXPIRES_AT,
    dependencies,
  });

  assertEquals(result.kind, 'invalidated');
  assertEquals(result.kind === 'invalidated' ? result.reason : null, 'scope_drift');
  assertEquals(calls.clients, 1);
  assertEquals(calls.writes, 0);
  assertEquals(calls.history, 0);
});

Deno.test('reviewed executor cannot switch credentials between target hashing and client acquisition', async () => {
  const sections = ['qualityProfiles'] as const;
  const reviewedEvidence = [evidence('qualityProfiles')];
  const binding = await bindingFor(sections, reviewedEvidence);
  let authoritativeCredential = 'credential-v1';
  const { calls, dependencies } = harness({
    binding,
    actualEvidence: reviewedEvidence,
    contexts: { qualityProfiles: prepared('qualityProfiles') },
    onAcquireReviewClient: () => {
      // Rotation happens after the atomic lease snapshot. The leased client and identity remain v1.
      authoritativeCredential = 'credential-v2';
    },
  });

  const result = await executeReviewedSyncJob({
    binding,
    sections,
    previewId: 'preview-credential-lease-race',
    expiresAt: EXPIRES_AT,
    beforeWrite: () => assertEquals(authoritativeCredential, 'credential-v2'),
    dependencies,
  });

  assertEquals(result.kind, 'executed');
  assertEquals(calls.clients, 1);
  assertEquals(calls.materializations, 1);
  assertEquals(calls.writes, 1);
});

Deno.test('reviewed executor writes frozen prepared values after an adversarial post-validation mutation', async () => {
  const sections = ['qualityProfiles'] as const;
  const pcdState = { name: 'Reviewed payload', revision: 1 };
  const reviewedEvidence = [evidence('qualityProfiles', { pcd: structuredClone(pcdState) })];
  const sectionConfigs = { qualityProfiles: { selections: [{ databaseId: 33, profileName: 'HD' }] } };
  const binding = await bindingFor(sections, reviewedEvidence, sectionConfigs);
  const frozenDesired = structuredClone(pcdState);
  const written: unknown[] = [];
  const outcome: SyncEntityOutcome = {
    section: 'qualityProfiles',
    arrType: 'radarr',
    entityType: 'qualityProfile',
    name: 'Reviewed payload',
    action: 'update',
    status: 'success',
    remoteId: '12',
    reason: null,
  };
  const { calls, dependencies } = harness({
    binding,
    actualEvidence: [evidence('qualityProfiles', { pcd: structuredClone(pcdState) })],
    contexts: {
      qualityProfiles: prepared('qualityProfiles', frozenDesired, sectionConfigs.qualityProfiles),
    },
    sync: (context) => {
      written.push(structuredClone(context.desired));
      return Promise.resolve({ success: true, itemsSynced: 1, outcomes: [outcome] });
    },
  });

  const result = await executeReviewedSyncJob({
    binding,
    sections,
    previewId: 'preview-frozen',
    expiresAt: EXPIRES_AT,
    beforeWrite: () => {
      pcdState.name = 'Unreviewed mutation';
      pcdState.revision = 2;
    },
    dependencies,
  });

  assertEquals(result, {
    kind: 'executed',
    result: {
      status: 'success',
      output: 'qualityProfiles: 1 item(s)',
      outcomes: [outcome],
      syncHistoryId: 91,
    },
  });
  assertEquals(written, [{ name: 'Reviewed payload', revision: 1 }]);
  assertEquals(calls.snapshots, 1);
  assertEquals(calls.history, 1);
  assertEquals(calls.complete, 1);
  assertEquals(calls.fail, 0);
  assertEquals(calls.capturedHistory?.previewId, 'preview-frozen');
  assertEquals(calls.capturedHistory?.entityOutcomes, [outcome]);
});

Deno.test('reviewed executor records the revalidated materialized diff without a second preview read', async () => {
  const sections = ['qualityProfiles'] as const;
  const reviewedEvidence = [evidence('qualityProfiles')];
  const binding = await bindingFor(sections, reviewedEvidence, {
    qualityProfiles: { selections: [{ databaseId: 33, profileName: 'HD' }] },
  });
  const reviewedChange = {
    entityType: 'qualityProfile',
    name: 'Reviewed HD',
    action: 'update' as const,
    remoteId: 12,
    fields: [{ field: 'cutoff', type: 'changed' as const, current: 1, desired: 2 }],
  };
  const unchanged = {
    entityType: 'customFormat',
    name: 'Already aligned',
    action: 'unchanged' as const,
    remoteId: 8,
    fields: [],
  };
  const materializedPreview = previewFor(sections, {
    qualityProfiles: {
      section: 'qualityProfiles',
      customFormats: [unchanged],
      qualityProfiles: [reviewedChange],
    },
    summary: {
      totalCreates: 0,
      totalUpdates: 1,
      totalDeletes: 0,
      totalUnchanged: 1,
    },
  });
  const { calls, dependencies } = harness({
    binding,
    actualEvidence: reviewedEvidence,
    contexts: {
      qualityProfiles: prepared('qualityProfiles', { name: 'Reviewed HD' }, binding.sectionConfigs.qualityProfiles),
    },
    preview: materializedPreview,
  });

  const result = await executeReviewedSyncJob({
    binding,
    sections,
    previewId: 'preview-history-from-reviewed-materialization',
    expiresAt: EXPIRES_AT,
    dependencies,
  });

  assertEquals(result.kind, 'executed');
  assertEquals(calls.materializations, 1);
  assertEquals(calls.history, 1);
  assertEquals(calls.capturedHistory?.changes, [
    {
      ...reviewedChange,
      section: 'qualityProfiles',
      category: 'qualityProfiles',
    },
  ]);
});

Deno.test('reviewed executor preserves both normal/reviewed concurrency interleavings', async () => {
  const sections = ['qualityProfiles'] as const;
  const reviewedEvidence = [evidence('qualityProfiles')];
  const binding = await bindingFor(sections, reviewedEvidence);

  const reviewedAfterNormal = harness({
    binding,
    actualEvidence: reviewedEvidence,
    contexts: { qualityProfiles: prepared('qualityProfiles') },
    claim: null,
  });
  const conflict = await executeReviewedSyncJob({
    binding,
    sections,
    previewId: 'preview-conflict',
    expiresAt: EXPIRES_AT,
    dependencies: reviewedAfterNormal.dependencies,
  });
  assertEquals(conflict.kind, 'claim_conflict');
  assertEquals(reviewedAfterNormal.calls.writes, 0);
  assertEquals(reviewedAfterNormal.calls.history, 0);

  let owner: 'idle' | 'reviewed' | 'normal' = 'idle';
  let normalClaimed = false;
  const normalAfterReviewed = harness({
    binding,
    actualEvidence: reviewedEvidence,
    contexts: { qualityProfiles: prepared('qualityProfiles') },
    sync: () => {
      assertEquals(owner, 'reviewed');
      return Promise.resolve({ success: true, itemsSynced: 0, outcomes: [] });
    },
  });
  const base = normalAfterReviewed.dependencies;
  const dependencies = {
    ...base,
    claimSections: () => {
      assertEquals(owner, 'idle');
      owner = 'reviewed';
      return Object.freeze({ instanceId: 7, sections }) as ReviewedSyncClaim;
    },
    completeSections: () => {
      assertEquals(owner, 'reviewed');
      owner = 'idle';
      return true;
    },
  } satisfies ReviewedSyncExecutionDependencies;

  const executed = await executeReviewedSyncJob({
    binding,
    sections,
    previewId: 'preview-owned',
    expiresAt: EXPIRES_AT,
    beforeWrite: () => {
      if (owner === 'idle') {
        owner = 'normal';
        normalClaimed = true;
      }
    },
    dependencies,
  });
  assertEquals(executed.kind, 'executed');
  assertEquals(normalClaimed, false);
  assertEquals(owner, 'idle');
  assertEquals(normalAfterReviewed.calls.writes, 1);
});
