import { assert, assertEquals, assertNotEquals, assertStringIncludes } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { arrManagedEntitiesQueries } from '$db/queries/arrManagedEntities.ts';
import { syncHistorySettingsQueries } from '$db/queries/syncHistorySettings.ts';
import { logger } from '$logger/logger.ts';
import { RadarrClient } from '$arr/clients/radarr.ts';
import type { BaseArrClient } from '$arr/base.ts';
import type { ArrCustomFormat } from '$arr/types.ts';
import type {
  EntityChange,
  QualityProfilesPreview,
  SyncPreviewEvidenceRecorder,
  SyncPreviewPreparedExecutionContext,
  SyncPreviewSection,
  SyncPreviewEvidenceClass,
} from '$sync/preview/types.ts';
import { qualityProfilesHandler } from '$sync/qualityProfiles/handler.ts';
import { QualityProfileSyncer } from '$sync/qualityProfiles/syncer.ts';
import type { PcdQualityProfile } from '$sync/qualityProfiles/transformer.ts';
import type { PcdCondition, PcdCustomFormat } from '$sync/customFormats/transformer.ts';
import { buildSyncPreviewReviewBinding } from '$sync/preview/reviewBinding.ts';

const SUFFIX = '\u200B';
const OLD_CF = { id: 10, name: `Old CF${SUFFIX}`, specifications: [] } as ArrCustomFormat;
const HAND_CF = { id: 11, name: 'Hand Made CF', specifications: [] } as ArrCustomFormat;

function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/ownership-prune-apply-${crypto.randomUUID()}`;
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

function seedInstance(pruneRemovedManaged: boolean): number {
  const id = arrInstancesQueries.create({
    name: `radarr-${crypto.randomUUID()}`,
    type: 'radarr',
    url: 'http://localhost:7878',
    apiKey: 'test-api-key',
  });
  if (pruneRemovedManaged) arrInstancesQueries.update(id, { pruneRemovedManaged: true });
  return id;
}

function seedLedger(instanceId: number, entityType: 'customFormat' | 'qualityProfile', remoteId: number, name: string) {
  arrManagedEntitiesQueries.recordCreated({
    instanceId,
    section: 'qualityProfiles',
    entityType,
    remoteId,
    arrName: `${name}${SUFFIX}`,
    pcdName: name,
    databaseId: 3,
    sourceKind: 'pcd',
    at: '2026-01-01T00:00:00.000Z',
  });
}

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

interface StubBatch {
  sourceKind: 'pcd';
  sourceLabel: string;
  databaseId: number;
  suffix: string;
  profiles: { pcdProfile: PcdQualityProfile; referencedFormatNames: string[] }[];
  customFormats: Map<string, PcdCustomFormat>;
  pcdFormatIdMap: Map<string, number>;
}

function profileBatch(names: string[]): StubBatch {
  return {
    sourceKind: 'pcd' as const,
    sourceLabel: 'source-3',
    databaseId: 3,
    suffix: SUFFIX,
    profiles: names.map((name) => ({ pcdProfile: createProfile(name), referencedFormatNames: [] })),
    customFormats: new Map<string, never>(),
    pcdFormatIdMap: new Map<string, number>(),
  };
}

interface FakeClientState {
  deletedCustomFormats: number[];
  deletedQualityProfiles: number[];
  writes: string[];
}

function makeClient(
  state: FakeClientState,
  options: { liveCustomFormats?: ArrCustomFormat[]; failCustomFormatCreate?: boolean } = {}
): BaseArrClient {
  return {
    getCustomFormats: () => Promise.resolve(options.liveCustomFormats ?? [OLD_CF, HAND_CF]),
    getQualityProfiles: () => Promise.resolve([]),
    getCustomFormat: (id: number) =>
      Promise.resolve((options.liveCustomFormats ?? [OLD_CF, HAND_CF]).find((format) => format.id === id)),
    getQualityProfile: () => Promise.reject(new Error('unexpected profile lookup')),
    createCustomFormat: (payload: ArrCustomFormat) => {
      state.writes.push(`createCustomFormat:${payload.name}`);
      if (options.failCustomFormatCreate) return Promise.reject(new Error('create failed'));
      return Promise.resolve({ ...payload, id: 500 });
    },
    updateCustomFormat: () => Promise.reject(new Error('unexpected update')),
    createQualityProfile: (payload: { name: string }) => {
      state.writes.push(`createQualityProfile:${payload.name}`);
      return Promise.resolve({ ...payload, id: 600 });
    },
    updateQualityProfile: () => Promise.reject(new Error('unexpected update')),
    deleteCustomFormat: (id: number) => {
      state.deletedCustomFormats.push(id);
      return Promise.resolve();
    },
    deleteQualityProfile: (id: number) => {
      state.deletedQualityProfiles.push(id);
      return Promise.resolve();
    },
  } as unknown as BaseArrClient;
}

function newState(): FakeClientState {
  return { deletedCustomFormats: [], deletedQualityProfiles: [], writes: [] };
}

interface Captured {
  evidence: Map<string, unknown>;
  prepared: SyncPreviewPreparedExecutionContext | null;
}

function captureRecorder(): { recorder: SyncPreviewEvidenceRecorder; captured: Captured } {
  const captured: Captured = { evidence: new Map(), prepared: null };
  return {
    captured,
    recorder: {
      record(_section: SyncPreviewSection, source: SyncPreviewEvidenceClass, key: string, value: unknown) {
        captured.evidence.set(`${source}.${key}`, value);
      },
      prepare(context: SyncPreviewPreparedExecutionContext) {
        captured.prepared = context;
      },
    },
  };
}

function stubBatches(syncer: QualityProfileSyncer, batches: StubBatch[]): void {
  const syncerAny = syncer as unknown as {
    fetchSyncBatches: () => Promise<unknown>;
    getQualityMappings: () => Promise<Map<string, string>>;
  };
  syncerAny.fetchSyncBatches = () => Promise.resolve(batches);
  syncerAny.getQualityMappings = () => Promise.resolve(new Map());
}

async function previewWithContext(instanceId: number, client: BaseArrClient, batches: StubBatch[]) {
  const syncer = new QualityProfileSyncer(client, instanceId, 'Prune', 'radarr');
  stubBatches(syncer, batches);
  const { recorder, captured } = captureRecorder();
  syncer.setPreviewEvidenceRecorder(recorder);
  const preview = (await syncer.generatePreview()) as QualityProfilesPreview;
  assert(captured.prepared, 'preview must prepare an execution context');
  return { preview, captured, context: captured.prepared as SyncPreviewPreparedExecutionContext };
}

interface PlannedPrune {
  remoteId: number;
}

/** Test seam: the prepared qualityProfiles material plan is private, so read it through one named cast. */
function plannedPrunes(context: SyncPreviewPreparedExecutionContext): PlannedPrune[] {
  const materialPlan = context.materialPlan as { prunes: PlannedPrune[] };
  return materialPlan.prunes;
}

function deletes(changes: readonly EntityChange[]): EntityChange[] {
  return changes.filter((change) => change.action === 'delete');
}

migratedTest('AC1: policy on previews a managed delete and reviewed apply deletes exactly that id', async () => {
  const instanceId = seedInstance(true);
  seedLedger(instanceId, 'customFormat', 10, 'Old CF');
  const state = newState();
  const client = makeClient(state);

  const { preview, captured, context } = await previewWithContext(instanceId, client, [profileBatch(['P'])]);

  const cfDeletes = deletes(preview.customFormats);
  assertEquals(cfDeletes.map((change) => change.remoteId).sort(), [10, 11]);
  assertEquals(
    cfDeletes.filter((change) => change.managed === true).map((change) => change.remoteId),
    [10]
  );
  assertEquals(captured.evidence.get('pcd.pruneEnabled'), true);
  assert(captured.evidence.has('pcd.managedLedger'));
  assert(captured.evidence.has('arr.customFormats'));
  assert(captured.evidence.has('arr.qualityProfiles'));
  assertEquals(preview.blockedPrunes, undefined);
  assertEquals(plannedPrunes(context).length, 1);

  // Reviewed apply: a fresh syncer consumes the frozen context.
  const applySyncer = new QualityProfileSyncer(client, instanceId, 'Prune', 'radarr');
  applySyncer.setPreparedExecutionContext(context);
  const result = await applySyncer.sync();

  assertEquals(result.success, true);
  assertEquals(state.deletedCustomFormats, [10]);
  assertEquals(state.deletedQualityProfiles, []);
  const deleteOutcomes = result.outcomes.filter((outcome) => outcome.action === 'delete');
  assertEquals(deleteOutcomes.length, 1);
  assertEquals(deleteOutcomes[0].status, 'success');
  assertEquals(deleteOutcomes[0].remoteId, '10');
  assertEquals(deleteOutcomes[0].entityType, 'customFormat');
  assertEquals(result.itemsSynced, 1); // the created profile only; deletes are not counted
  assertEquals(arrManagedEntitiesQueries.listRemoteIds(instanceId, 'customFormat').has(10), false);
});

migratedTest('policy off: no managed flags, no pruneEnabled ledger evidence, no DELETE', async () => {
  const instanceId = seedInstance(false);
  seedLedger(instanceId, 'customFormat', 10, 'Old CF');
  const state = newState();
  const client = makeClient(state);

  const { preview, captured, context } = await previewWithContext(instanceId, client, [profileBatch(['P'])]);

  assertEquals(captured.evidence.get('pcd.pruneEnabled'), false);
  assertEquals(captured.evidence.has('pcd.managedLedger'), false);
  assert(deletes(preview.customFormats).length === 2);
  assertEquals(
    preview.customFormats.some((change) => change.managed !== undefined),
    false
  );
  assertEquals(plannedPrunes(context), []);

  const applySyncer = new QualityProfileSyncer(client, instanceId, 'Prune', 'radarr');
  applySyncer.setPreparedExecutionContext(context);
  const result = await applySyncer.sync();
  assertEquals(result.success, true);
  assertEquals(state.deletedCustomFormats, []);
  assertEquals(
    result.outcomes.some((outcome) => outcome.action === 'delete'),
    false
  );
  assertEquals(arrManagedEntitiesQueries.listRemoteIds(instanceId, 'customFormat').has(10), true);
});

migratedTest('AC2: a hand-made CF without a ledger row stays an unmanaged delete and is never deleted', async () => {
  const instanceId = seedInstance(true);
  seedLedger(instanceId, 'customFormat', 10, 'Old CF');
  const state = newState();
  const client = makeClient(state);

  const { preview, context } = await previewWithContext(instanceId, client, [profileBatch(['P'])]);
  const hand = deletes(preview.customFormats).find((change) => change.remoteId === 11);
  assert(hand, 'hand-made CF still appears as a delete row');
  assertEquals(hand.managed, undefined);

  const applySyncer = new QualityProfileSyncer(client, instanceId, 'Prune', 'radarr');
  applySyncer.setPreparedExecutionContext(context);
  await applySyncer.sync();
  assertEquals(state.deletedCustomFormats.includes(11), false);
  assertEquals(state.deletedCustomFormats, [10]);
});

migratedTest('unreviewed sync never deletes even with policy on and a ledger-owned stale CF', async () => {
  const instanceId = seedInstance(true);
  seedLedger(instanceId, 'customFormat', 10, 'Old CF');
  const state = newState();
  const client = makeClient(state);

  const withProfile = new QualityProfileSyncer(client, instanceId, 'Prune', 'radarr');
  stubBatches(withProfile, [profileBatch(['P'])]);
  const withProfileResult = await withProfile.sync();
  assertEquals(withProfileResult.success, true);

  const empty = new QualityProfileSyncer(client, instanceId, 'Prune', 'radarr');
  stubBatches(empty, []);
  const emptyResult = await empty.sync();
  assertEquals(emptyResult.success, true);
  assertEquals(emptyResult.outcomes, []);

  assertEquals(state.deletedCustomFormats, []);
  assertEquals(state.deletedQualityProfiles, []);
  assertEquals(arrManagedEntitiesQueries.listRemoteIds(instanceId, 'customFormat').has(10), true);
});

migratedTest('last profile deselected with ledger rows and policy on still plans prunes', async () => {
  const instanceId = seedInstance(true);
  seedLedger(instanceId, 'customFormat', 10, 'Old CF');
  seedLedger(instanceId, 'qualityProfile', 20, 'Old Profile');
  const state = newState();
  const client = {
    ...(makeClient(state) as unknown as Record<string, unknown>),
    getQualityProfiles: () => Promise.resolve([{ id: 20, name: `Old Profile${SUFFIX}`, formatItems: [] }]),
  } as unknown as BaseArrClient;

  const { preview, captured, context } = await previewWithContext(instanceId, client, []);

  assertEquals(captured.evidence.get('pcd.pruneEnabled'), true);
  assert(captured.evidence.has('arr.customFormats'));
  assert(captured.evidence.has('arr.qualityProfiles'));
  assertEquals(
    deletes(preview.customFormats)
      .filter((change) => change.managed)
      .map((change) => change.remoteId),
    [10]
  );
  // The fake client is not a RadarrClient, so the in-use check cannot verify and fails closed.
  assertEquals(
    deletes(preview.qualityProfiles)
      .filter((change) => change.managed)
      .map((change) => change.remoteId),
    []
  );
  assertEquals(
    preview.blockedPrunes?.map((blocked) => [blocked.entityType, blocked.remoteId]),
    [['qualityProfile', 20]]
  );
  assertEquals(
    plannedPrunes(context).map((prune) => prune.remoteId),
    [10]
  );

  const applySyncer = new QualityProfileSyncer(client, instanceId, 'Prune', 'radarr');
  applySyncer.setPreparedExecutionContext(context);
  const result = await applySyncer.sync();
  assertEquals(result.success, true);
  assertEquals(state.deletedCustomFormats, [10]);
  assertEquals(state.deletedQualityProfiles, []);
});

migratedTest('a CF write failure in the reviewed run skips prunes', async () => {
  const instanceId = seedInstance(true);
  seedLedger(instanceId, 'customFormat', 10, 'Old CF');
  const state = newState();
  const client = makeClient(state, { failCustomFormatCreate: true });

  const context = {
    section: 'qualityProfiles',
    config: { selections: [] },
    desired: {
      batches: [
        {
          sourceKind: 'pcd',
          sourceLabel: 'source-3',
          databaseId: 3,
          suffix: SUFFIX,
          customFormats: [{ pcdName: 'New CF', payload: { id: -1, name: `New CF${SUFFIX}`, specifications: [] } }],
          qualityProfiles: [],
        },
      ],
    },
    materialPlan: {
      arrType: 'radarr',
      batchOrder: [`pcd:3:source-3:${SUFFIX}`],
      prunes: [
        {
          entityType: 'customFormat',
          remoteId: 10,
          arrName: OLD_CF.name,
          pcdName: 'Old CF',
          sourceKind: 'pcd',
          databaseId: 3,
        },
      ],
    },
    currentGuards: { customFormats: [OLD_CF, HAND_CF], qualityProfiles: [] },
  } satisfies SyncPreviewPreparedExecutionContext;

  const syncer = new QualityProfileSyncer(client, instanceId, 'Prune', 'radarr');
  syncer.setPreparedExecutionContext(context);
  const result = await syncer.sync();

  assertEquals(
    result.outcomes.map((outcome) => [outcome.action, outcome.status]),
    [
      ['create', 'failed'],
      ['delete', 'skipped'],
    ]
  );
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'Skipped 1 reviewed deletion(s) because a write failed');
  assertEquals(state.deletedCustomFormats, []);
  assertEquals(arrManagedEntitiesQueries.listRemoteIds(instanceId, 'customFormat').has(10), true);
});

migratedTest('a failed prune delete fails the run without counting it as synced', async () => {
  const instanceId = seedInstance(true);
  seedLedger(instanceId, 'customFormat', 10, 'Old CF');
  const state = newState();
  const client = {
    ...(makeClient(state) as unknown as Record<string, unknown>),
    deleteCustomFormat: () => Promise.reject(new Error('delete refused')),
  } as unknown as BaseArrClient;

  const { context } = await previewWithContext(instanceId, client, [profileBatch(['P'])]);
  const syncer = new QualityProfileSyncer(client, instanceId, 'Prune', 'radarr');
  syncer.setPreparedExecutionContext(context);
  const result = await syncer.sync();

  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'delete');
  assertEquals(result.itemsSynced, 1);
  const failed = result.outcomes.filter((outcome) => outcome.action === 'delete');
  assertEquals(
    failed.map((outcome) => outcome.status),
    ['failed']
  );
  assertEquals(arrManagedEntitiesQueries.listRemoteIds(instanceId, 'customFormat').has(10), true);
});

migratedTest('prune guard mismatch aborts the run before any DELETE', async () => {
  const instanceId = seedInstance(true);
  seedLedger(instanceId, 'customFormat', 10, 'Old CF');
  const state = newState();
  const client = makeClient(state);
  const { context } = await previewWithContext(instanceId, client, [profileBatch(['P'])]);

  const tampered = structuredClone(context) as unknown as {
    currentGuards: { customFormats: { id: number; name: string }[] };
  };
  tampered.currentGuards.customFormats = tampered.currentGuards.customFormats.filter((f) => f.id !== 10);
  const syncer = new QualityProfileSyncer(client, instanceId, 'Prune', 'radarr');
  syncer.setPreparedExecutionContext(tampered as unknown as SyncPreviewPreparedExecutionContext);
  const result = await syncer.sync();

  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'Prune guard mismatch');
  assertEquals(state.deletedCustomFormats, []);
});

migratedTest('hasConfig: policy on with a ledger row keeps the section reviewable with empty selections', () => {
  const off = seedInstance(false);
  seedLedger(off, 'customFormat', 10, 'Old CF');
  assertEquals(qualityProfilesHandler.hasConfig(off), false);

  const emptyLedger = seedInstance(true);
  assertEquals(qualityProfilesHandler.hasConfig(emptyLedger), false);

  const on = seedInstance(true);
  seedLedger(on, 'customFormat', 10, 'Old CF');
  assertEquals(qualityProfilesHandler.hasConfig(on), true);
});

Deno.test('prepared context without materialPlan.prunes is rejected', async () => {
  const syncer = new QualityProfileSyncer(makeClient(newState()), 99, 'Prune', 'radarr');
  syncer.setPreparedExecutionContext({
    section: 'qualityProfiles',
    config: { selections: [] },
    desired: { batches: [] },
    materialPlan: { arrType: 'radarr', batchOrder: [] },
    currentGuards: { customFormats: [], qualityProfiles: [] },
  });
  const result = await syncer.sync();
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'Invalid reviewed quality profile execution context');
});

migratedTest('unreviewed drift-style preview never fetches media; reviewed previews consistently do', async () => {
  const instanceId = seedInstance(true);
  seedLedger(instanceId, 'qualityProfile', 20, 'Old Profile');
  let mediaReads = 0;
  const client = Object.assign(new RadarrClient('http://localhost:7878', 'key'), {
    getCustomFormats: async () => [],
    getQualityProfiles: async () => [{ id: 20, name: `Old Profile${SUFFIX}`, formatItems: [] }],
    getMovies: async () => {
      mediaReads++;
      return [];
    },
  });
  const drift = new QualityProfileSyncer(client, instanceId, 'Prune', 'radarr');
  stubBatches(drift, []);
  const preview = (await drift.generatePreview()) as QualityProfilesPreview;
  assertEquals(mediaReads, 0);
  assertEquals(preview.blockedPrunes?.length, 1);
  for (let review = 0; review < 2; review++) {
    const { context } = await previewWithContext(instanceId, client, []);
    assertEquals(
      plannedPrunes(context).map(({ remoteId }) => remoteId),
      [20]
    );
  }
  assertEquals(mediaReads, 2);
});

migratedTest('reviewed apply keeps formats scored by a profile whose deletion fails', async () => {
  const instanceId = seedInstance(true);
  seedLedger(instanceId, 'qualityProfile', 20, 'Old Profile');
  seedLedger(instanceId, 'customFormat', 10, 'Old CF');
  const state = newState();
  const profile = { id: 20, name: `Old Profile${SUFFIX}`, formatItems: [{ format: 10, name: OLD_CF.name, score: 50 }] };
  const client = Object.assign(new RadarrClient('http://localhost:7878', 'key'), makeClient(state), {
    getQualityProfiles: async () => [profile],
    getQualityProfile: async () => profile,
    getMovies: async () => [],
    deleteQualityProfile: async () => {
      throw new Error('profile in use by import list');
    },
  });
  const { context } = await previewWithContext(instanceId, client, []);
  assertEquals(
    plannedPrunes(context).map(({ remoteId }) => remoteId),
    [20, 10]
  );
  const apply = new QualityProfileSyncer(client, instanceId, 'Prune', 'radarr');
  apply.setPreparedExecutionContext(context);
  const result = await apply.sync();
  assertEquals(result.success, false);
  assertEquals(
    result.outcomes.map(({ action, status }) => [action, status]),
    [
      ['delete', 'failed'],
      ['delete', 'skipped'],
    ]
  );
  assertEquals(state.deletedCustomFormats, []);
  assertEquals(arrManagedEntitiesQueries.listForInstance(instanceId).length, 2);
});

migratedTest('reviewed apply warns when sync history is disabled', async () => {
  const instanceId = seedInstance(true);
  seedLedger(instanceId, 'customFormat', 10, 'Old CF');
  syncHistorySettingsQueries.update({ enabled: false });
  const client = makeClient(newState());
  const { context } = await previewWithContext(instanceId, client, []);
  const warnings: string[] = [];
  const originalWarn = logger.warn;
  logger.warn = async (message) => {
    warnings.push(message);
  };
  try {
    const apply = new QualityProfileSyncer(client, instanceId, 'Prune', 'radarr');
    apply.setPreparedExecutionContext(context);
    const result = await apply.sync();
    assertEquals(result.success, true);
    assert(warnings.some((message) => message.includes('no sync history record')));
  } finally {
    logger.warn = originalWarn;
  }
});

migratedTest('reviewed create preview binds PCD condition evidence and applies CFs and profiles', async () => {
  const instanceId = seedInstance(false);
  const conditionData: Partial<PcdCondition>[] = [
    { type: 'release_title', patterns: [{ name: 'Title', pattern: 'example' }] },
    { type: 'release_group', patterns: [{ name: 'Group', pattern: 'group' }] },
    { type: 'edition', patterns: [{ name: 'Edition', pattern: 'edition' }] },
    { type: 'language', languages: [{ name: 'english', except: false }] },
    { type: 'source', sources: ['web_dl'] },
    { type: 'resolution', resolutions: ['1080p'] },
    { type: 'quality_modifier', qualityModifiers: ['remux'] },
    { type: 'release_type', releaseTypes: ['single_episode'] },
    { type: 'indexer_flag', indexerFlags: ['freeleech'] },
    { type: 'size', size: { minBytes: 0, maxBytes: null } },
    { type: 'year', years: { minYear: 2000, maxYear: null } },
  ];
  const format: PcdCustomFormat = {
    id: 1,
    name: 'Reviewed CF',
    includeInRename: false,
    // Match the PCD reader: every type-specific property exists, but only its own is set.
    conditions: conditionData.map((data, index) => ({
      name: `Condition ${index}`,
      type: '',
      arrType: 'all',
      negate: false,
      required: false,
      patterns: undefined,
      languages: undefined,
      sources: undefined,
      resolutions: undefined,
      qualityModifiers: undefined,
      releaseTypes: undefined,
      indexerFlags: undefined,
      size: undefined,
      years: undefined,
      ...data,
    })),
  };
  const batch = profileBatch(['Reviewed Profile']);
  batch.customFormats.set(format.name, format);
  batch.profiles[0].referencedFormatNames = [format.name];
  batch.profiles[0].pcdProfile.customFormats = [{ formatId: 1, formatName: format.name, score: 100 }];
  // TRaSH's profile projection also supplies undefined members on non-group qualities.
  batch.profiles[0].pcdProfile.qualities = [
    {
      type: 'quality',
      referenceId: 1,
      name: 'Bluray-1080p',
      position: 0,
      enabled: true,
      upgradeUntil: true,
      members: undefined,
    },
  ];
  const state = newState();
  const client = makeClient(state, { liveCustomFormats: [] });
  const materialize = async () => {
    const { preview, captured, context } = await previewWithContext(instanceId, client, [batch]);
    const sourceEvidence = (source: string) =>
      Object.fromEntries(
        [...captured.evidence]
          .filter(([key]) => key.startsWith(`${source}.`))
          .map(([key, value]) => [key.slice(source.length + 1), value])
      );
    const evidence = {
      section: 'qualityProfiles' as const,
      pcd: sourceEvidence('pcd'),
      arr: sourceEvidence('arr'),
      plan: { result: preview, outcome: { section: 'qualityProfiles', failure: null, skipped: false } },
    };
    const binding = await buildSyncPreviewReviewBinding({
      instanceId,
      arrType: 'radarr',
      target: {
        url: 'http://localhost:7878',
        credentialFingerprint: 'test-fingerprint',
        credentialKeyVersion: 'test-key-version',
        credentialRevision: 'test-revision',
      },
      sections: ['qualityProfiles'],
      sectionConfigs: { qualityProfiles: context.config },
      evidence: [evidence],
    });
    return { preview, binding, context };
  };
  const { preview, binding, context } = await materialize();
  assertEquals(
    preview.customFormats.map(({ action }) => action),
    ['create']
  );
  assertEquals(
    preview.qualityProfiles.map(({ action }) => action),
    ['create']
  );
  assertEquals(binding, (await materialize()).binding, 'rematerialization must hash identically');
  format.conditions[0].patterns![0].pattern = 'changed';
  assertNotEquals(
    binding.evidence.qualityProfiles?.pcdHash,
    (await materialize()).binding.evidence.qualityProfiles?.pcdHash
  );
  format.conditions[0].patterns![0].pattern = 'example';
  const apply = new QualityProfileSyncer(client, instanceId, 'Reviewed', 'radarr');
  apply.setPreparedExecutionContext(context);
  const result = await apply.sync();
  assertEquals(result.success, true);
  assertEquals(state.writes, [
    `createCustomFormat:${format.name}${SUFFIX}`,
    `createQualityProfile:Reviewed Profile${SUFFIX}`,
  ]);
  assertEquals(
    result.outcomes.map(({ status }) => status),
    ['success', 'success']
  );
});
