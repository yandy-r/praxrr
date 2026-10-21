/**
 * Reviewed (preview → apply) quality-profile sync must resolve formatItems by the planned
 * custom-format id, never by bare name (YAN-445 / GitHub #343).
 */
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import type { BaseArrClient } from '$arr/base.ts';
import type { ArrCustomFormat, ArrQualityProfilePayload, QualityProfileFormatItem } from '$arr/types.ts';
import type { PcdCustomFormat } from '$sync/customFormats/transformer.ts';
import type { PcdQualityProfile } from '$sync/qualityProfiles/transformer.ts';
import { QualityProfileSyncer } from '$sync/qualityProfiles/syncer.ts';

const SUFFIX_A = '\u200B';
const SUFFIX_B = '\u200C';

interface BatchSpec {
  readonly databaseId: number;
  readonly suffix: string;
  readonly customFormats: readonly string[];
  readonly profiles: readonly { readonly name: string; readonly scores: Readonly<Record<string, number>> }[];
}

interface Recorded {
  readonly customFormatCreates: ArrCustomFormat[];
  readonly customFormatUpdates: ArrCustomFormat[];
  readonly profileWrites: ArrQualityProfilePayload[];
}

function pcdProfile(name: string, scores: Readonly<Record<string, number>>, id: number): PcdQualityProfile {
  return {
    id,
    name,
    upgradesAllowed: true,
    minimumCustomFormatScore: 0,
    upgradeUntilScore: 100,
    upgradeScoreIncrement: 1,
    qualities: [],
    language: null,
    customFormats: Object.entries(scores).map(([formatName, score], index) => ({
      formatId: index + 1,
      formatName,
      score,
    })),
  };
}

function makeClient(
  arrCustomFormats: readonly ArrCustomFormat[],
  recorded: Recorded,
  failCreateFor: ReadonlySet<string> = new Set()
): BaseArrClient {
  let nextCustomFormatId = 101;
  let nextProfileId = 201;
  return {
    getCustomFormats: () => Promise.resolve(structuredClone([...arrCustomFormats])),
    getQualityProfiles: () => Promise.resolve([]),
    createCustomFormat: (payload: ArrCustomFormat) => {
      if (failCreateFor.has(payload.name)) return Promise.reject(new Error('custom format create failed'));
      recorded.customFormatCreates.push(structuredClone(payload));
      return Promise.resolve({ ...payload, id: nextCustomFormatId++ });
    },
    updateCustomFormat: (_id: number, payload: ArrCustomFormat) => {
      recorded.customFormatUpdates.push(structuredClone(payload));
      return Promise.resolve(payload);
    },
    createQualityProfile: (payload: ArrQualityProfilePayload) => {
      recorded.profileWrites.push(structuredClone(payload));
      return Promise.resolve({ ...payload, id: nextProfileId++ });
    },
    updateQualityProfile: () => Promise.reject(new Error('unexpected quality-profile update')),
  } as unknown as BaseArrClient;
}

/** Build a syncer whose PCD batch resolution is stubbed; preview and apply logic run for real. */
function makeSyncer(client: BaseArrClient, specs: readonly BatchSpec[]): QualityProfileSyncer {
  const syncer = new QualityProfileSyncer(client, 7, 'Reviewed', 'radarr');
  syncer.setPreviewConfig({
    selections: specs.flatMap((spec) =>
      spec.profiles.map((profile) => ({ databaseId: spec.databaseId, profileName: profile.name }))
    ),
  });
  let pcdId = 1;
  const batches = specs.map((spec) => ({
    sourceKind: 'pcd' as const,
    sourceLabel: `DB ${spec.databaseId}`,
    databaseId: spec.databaseId,
    suffix: spec.suffix,
    profiles: spec.profiles.map((profile) => ({
      pcdProfile: pcdProfile(profile.name, profile.scores, pcdId++),
      referencedFormatNames: Object.keys(profile.scores),
    })),
    customFormats: new Map<string, PcdCustomFormat>(
      spec.customFormats.map((name) => [name, { id: pcdId++, name, includeInRename: false, conditions: [] }])
    ),
    pcdFormatIdMap: new Map<string, number>(),
  }));
  const stubbed = syncer as unknown as {
    fetchSyncBatches: () => Promise<unknown[]>;
    getQualityMappings: () => Promise<Map<string, string>>;
  };
  stubbed.fetchSyncBatches = () => Promise.resolve(structuredClone(batches));
  stubbed.getQualityMappings = () => Promise.resolve(new Map());
  return syncer;
}

function emptyRecorded(): Recorded {
  return { customFormatCreates: [], customFormatUpdates: [], profileWrites: [] };
}

function assertUniqueFormatIds(items: readonly QualityProfileFormatItem[]): void {
  const ids = items.map((item) => item.format);
  assertEquals(new Set(ids).size, ids.length, `duplicate format ids: ${JSON.stringify(ids)}`);
  for (const id of ids) assert(id > 0, `non-positive format id ${id} sent to Arr`);
}

function scoreOf(items: readonly QualityProfileFormatItem[], id: number): number[] {
  return items.filter((item) => item.format === id).map((item) => item.score);
}

Deno.test('reviewed QP apply keeps an unmanaged same-name CF distinct from the managed CF', async () => {
  const recorded = emptyRecorded();
  const client = makeClient(
    [
      { id: 4, name: 'x265', specifications: [] },
      { id: 9, name: `x265${SUFFIX_A}`, specifications: [] },
    ],
    recorded
  );
  const syncer = makeSyncer(client, [
    { databaseId: 41, suffix: SUFFIX_A, customFormats: ['x265'], profiles: [{ name: 'HD', scores: { x265: 50 } }] },
  ]);

  await syncer.generatePreview();
  const result = await syncer.sync();

  assertEquals(result.success, true, result.error);
  assertEquals(recorded.profileWrites.length, 1);
  const items = recorded.profileWrites[0].formatItems;
  assertUniqueFormatIds(items);
  assertEquals(scoreOf(items, 9), [50]);
  assertEquals(scoreOf(items, 4), [0]);
});

Deno.test('reviewed QP apply resolves a planned synthetic CF id to the created remote id', async () => {
  const recorded = emptyRecorded();
  const client = makeClient([{ id: 4, name: 'Existing', specifications: [] }], recorded);
  const syncer = makeSyncer(client, [
    {
      databaseId: 41,
      suffix: SUFFIX_A,
      customFormats: ['New CF'],
      profiles: [{ name: 'HD', scores: { 'New CF': 30 } }],
    },
  ]);

  await syncer.generatePreview();
  const result = await syncer.sync();

  assertEquals(result.success, true, result.error);
  assertEquals(
    recorded.customFormatCreates.map((format) => format.name),
    [`New CF${SUFFIX_A}`]
  );
  const items = recorded.profileWrites[0].formatItems;
  assertUniqueFormatIds(items);
  assertEquals(scoreOf(items, 101), [30]);
  assertEquals(scoreOf(items, 4), [0]);
});

Deno.test('reviewed QP apply keeps synthetic ids unique across batches', async () => {
  const recorded = emptyRecorded();
  const client = makeClient([], recorded);
  const syncer = makeSyncer(client, [
    { databaseId: 41, suffix: SUFFIX_A, customFormats: ['Alpha'], profiles: [{ name: 'A', scores: { Alpha: 10 } }] },
    { databaseId: 42, suffix: SUFFIX_B, customFormats: ['Beta'], profiles: [{ name: 'B', scores: { Beta: 20 } }] },
  ]);

  await syncer.generatePreview();
  const result = await syncer.sync();

  assertEquals(result.success, true, result.error);
  const createdIds = new Map(recorded.customFormatCreates.map((format, index) => [format.name, 101 + index] as const));
  const alphaId = createdIds.get(`Alpha${SUFFIX_A}`)!;
  const betaId = createdIds.get(`Beta${SUFFIX_B}`)!;
  assertEquals(recorded.profileWrites.length, 2);
  const [profileA, profileB] = recorded.profileWrites;
  for (const profile of [profileA, profileB]) {
    assertUniqueFormatIds(profile.formatItems);
    assertEquals(profile.formatItems.map((item) => item.format).sort(), [alphaId, betaId].sort());
  }
  assertEquals(scoreOf(profileA.formatItems, alphaId), [10]);
  assertEquals(scoreOf(profileA.formatItems, betaId), [0]);
  assertEquals(scoreOf(profileB.formatItems, betaId), [20]);
  assertEquals(scoreOf(profileB.formatItems, alphaId), [0]);
});

Deno.test('reviewed QP apply fails only the profile that scores a CF whose create failed', async () => {
  const recorded = emptyRecorded();
  const client = makeClient([], recorded, new Set([`Broken${SUFFIX_A}`]));
  const syncer = makeSyncer(client, [
    {
      databaseId: 41,
      suffix: SUFFIX_A,
      customFormats: ['Broken', 'Fine'],
      profiles: [
        { name: 'Scores Broken', scores: { Broken: 40, Fine: 5 } },
        { name: 'Ignores Broken', scores: { Fine: 15 } },
      ],
    },
  ]);

  await syncer.generatePreview();
  const result = await syncer.sync();

  assertEquals(result.success, false);
  assertEquals(result.failedProfiles, ['Scores Broken']);
  assertEquals(result.itemsSynced, 1);
  assertEquals(
    recorded.profileWrites.map((profile) => profile.name),
    [`Ignores Broken${SUFFIX_A}`]
  );
  const written = recorded.profileWrites[0].formatItems;
  assertUniqueFormatIds(written);
  assertEquals(written, [{ format: 101, name: 'Fine', score: 15 }]);

  const failed = result.outcomes.find(
    (outcome) => outcome.entityType === 'qualityProfile' && outcome.name === 'Scores Broken'
  );
  assert(failed);
  assertEquals(failed.status, 'failed');
  assertEquals(failed.action, 'create');
  assertEquals(failed.remoteId, null);
  assertStringIncludes(failed.reason ?? '', 'Custom format "Broken" was not created');
});
