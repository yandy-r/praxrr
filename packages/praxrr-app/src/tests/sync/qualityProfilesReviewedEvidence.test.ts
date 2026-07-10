import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import type { BaseArrClient } from '$arr/base.ts';
import type { ArrCustomFormat, ArrQualityProfilePayload } from '$arr/types.ts';
import type { SyncArrType } from '$sync/mappings.ts';
import type { SyncPreviewPreparedExecutionContext } from '$sync/preview/types.ts';
import { QualityProfileSyncer } from '$sync/qualityProfiles/syncer.ts';

interface RecordedWrite {
  type: 'customFormat' | 'qualityProfile';
  payload: ArrCustomFormat | ArrQualityProfilePayload;
}

function buildContext(arrType: SyncArrType): SyncPreviewPreparedExecutionContext {
  const suffix = '\u200B';
  return {
    section: 'qualityProfiles',
    config: {
      selections: [{ databaseId: 41, profileName: '  Reviewed Profile  ' }],
    },
    desired: {
      batches: [
        {
          sourceKind: 'pcd',
          sourceLabel: 'Reviewed DB',
          databaseId: 41,
          suffix,
          customFormats: [
            {
              pcdName: 'Second CF',
              payload: { id: -1, name: `Second CF${suffix}`, specifications: [] },
            },
            {
              pcdName: 'First CF',
              payload: { id: -2, name: `First CF${suffix}`, specifications: [] },
            },
          ],
          qualityProfiles: [
            {
              pcdName: '  Reviewed Profile  ',
              payload: {
                name: `  Reviewed Profile  ${suffix}`,
                items: [
                  { quality: { id: 2, name: 'Second' }, items: [], allowed: true },
                  { quality: { id: 1, name: 'First' }, items: [], allowed: false },
                ],
                ...(arrType === 'radarr' ? { language: { id: 1, name: 'Original' } } : {}),
                upgradeAllowed: true,
                cutoff: 2,
                minFormatScore: 0,
                cutoffFormatScore: 100,
                minUpgradeFormatScore: 1,
                formatItems: [
                  { format: -2, name: 'First CF', score: 10 },
                  { format: -1, name: 'Second CF', score: 20 },
                  { format: 55, name: 'Existing CF', score: 0 },
                ],
              },
              remoteId: null,
            },
          ],
        },
      ],
    },
    materialPlan: {
      arrType,
      batchOrder: [`pcd:41:Reviewed DB:${suffix}`],
    },
    currentGuards: {
      customFormats: [{ id: 55, name: 'Existing CF', specifications: [] }],
      qualityProfiles: [],
    },
  };
}

function makeWriteOnlyClient(writes: RecordedWrite[]): BaseArrClient {
  let nextCustomFormatId = 101;
  return {
    getCustomFormats: () => Promise.reject(new Error('reviewed write reread custom formats')),
    getQualityProfiles: () => Promise.reject(new Error('reviewed write reread quality profiles')),
    createCustomFormat: async (payload: ArrCustomFormat) => {
      writes.push({ type: 'customFormat', payload: structuredClone(payload) });
      return { ...payload, id: nextCustomFormatId++ };
    },
    updateCustomFormat: () => Promise.reject(new Error('unexpected custom-format update')),
    createQualityProfile: async (payload: ArrQualityProfilePayload) => {
      writes.push({ type: 'qualityProfile', payload: structuredClone(payload) });
      return { ...payload, id: 201 };
    },
    updateQualityProfile: () => Promise.reject(new Error('unexpected quality-profile update')),
  } as unknown as BaseArrClient;
}

for (const arrType of ['radarr', 'sonarr', 'lidarr'] as const) {
  Deno.test(`reviewed quality-profile write uses frozen ${arrType} payload without sibling fallback`, async () => {
    const writes: RecordedWrite[] = [];
    const context = buildContext(arrType);
    const syncer = new QualityProfileSyncer(makeWriteOnlyClient(writes), 7, 'Reviewed', arrType);
    syncer.setPreparedExecutionContext(context);

    const mutable = context as {
      config: { selections: { profileName: string }[] };
      desired: {
        batches: {
          customFormats: { pcdName: string; payload: ArrCustomFormat }[];
          qualityProfiles: { pcdName: string; payload: ArrQualityProfilePayload }[];
        }[];
      };
      materialPlan: { batchOrder: string[] };
      currentGuards: { customFormats: ArrCustomFormat[] };
    };
    mutable.config.selections[0].profileName = 'Mutated Config';
    mutable.desired.batches[0].customFormats.reverse();
    mutable.desired.batches[0].customFormats[0].payload.name = 'Mutated CF';
    mutable.desired.batches[0].qualityProfiles[0].pcdName = 'Mutated Profile';
    mutable.desired.batches[0].qualityProfiles[0].payload.name = 'Mutated Payload';
    mutable.desired.batches[0].qualityProfiles[0].payload.items.reverse();
    mutable.desired.batches[0].qualityProfiles[0].payload.formatItems.reverse();
    mutable.materialPlan.batchOrder[0] = 'mutated';
    mutable.currentGuards.customFormats[0].id = 999;

    const result = await syncer.sync();

    assertEquals(result.success, true);
    assertEquals(
      writes.map((write) => write.type),
      ['customFormat', 'customFormat', 'qualityProfile']
    );
    assertEquals((writes[0].payload as ArrCustomFormat).name, 'Second CF\u200B');
    assertEquals((writes[1].payload as ArrCustomFormat).name, 'First CF\u200B');
    const profile = writes[2].payload as ArrQualityProfilePayload;
    assertEquals(profile.name, '  Reviewed Profile  \u200B');
    assertEquals(
      profile.items.map((item) => item.quality?.name),
      ['Second', 'First']
    );
    assertEquals(profile.formatItems, [
      { format: 102, name: 'First CF', score: 10 },
      { format: 101, name: 'Second CF', score: 20 },
      { format: 55, name: 'Existing CF', score: 0 },
    ]);
    assertEquals(profile.language, arrType === 'radarr' ? { id: 1, name: 'Original' } : undefined);
    assertEquals(
      result.outcomes.map((outcome) => outcome.arrType),
      [arrType, arrType, arrType]
    );
    assertEquals(result.outcomes[2].name, '  Reviewed Profile  ');
    assertEquals(result.itemsSynced, 1);
    assertEquals(
      result.outcomes.map((outcome) => outcome.status),
      ['success', 'success', 'success']
    );
  });
}

for (const failure of ['missing-id', 'throw'] as const) {
  Deno.test(`reviewed quality-profile ${failure} failure matches ordinary accounting`, async () => {
    const writes: RecordedWrite[] = [];
    const client = makeWriteOnlyClient(writes) as unknown as {
      createQualityProfile: (payload: ArrQualityProfilePayload) => Promise<unknown>;
    };
    client.createQualityProfile = (payload) => {
      writes.push({ type: 'qualityProfile', payload: structuredClone(payload) });
      if (failure === 'throw') return Promise.reject(new Error('reviewed profile write failed'));
      return Promise.resolve({ ...payload });
    };
    const syncer = new QualityProfileSyncer(client as unknown as BaseArrClient, 7, 'Reviewed', 'radarr');
    syncer.setPreparedExecutionContext(buildContext('radarr'));

    const result = await syncer.sync();
    assertEquals(result.success, false);
    assertEquals(result.itemsSynced, 0);
    assertEquals(result.failedProfiles, ['  Reviewed Profile  ']);
    assertEquals(
      result.outcomes.map((outcome) => outcome.status),
      ['success', 'success', 'failed']
    );
    assertEquals(result.outcomes[2].remoteId, null);
  });
}

Deno.test('reviewed quality-profile write rejects cross-Arr prepared context before any write', async () => {
  const writes: RecordedWrite[] = [];
  const syncer = new QualityProfileSyncer(makeWriteOnlyClient(writes), 7, 'Reviewed', 'sonarr');
  syncer.setPreparedExecutionContext(buildContext('radarr'));

  const result = await syncer.sync();

  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'targets radarr, not sonarr');
  assertEquals(writes, []);
});

Deno.test('reviewed quality-profile config preserves exact names and never falls back when malformed', async () => {
  const syncer = new QualityProfileSyncer(makeWriteOnlyClient([]), 7, 'Reviewed', 'radarr');
  syncer.setPreviewConfig({
    selections: [{ databaseId: 41, profileName: '  Exact Config Name  ' }],
  });
  const getConfig = (
    syncer as unknown as {
      getQualityProfilesSyncConfig(): { selections: { databaseId: number; profileName: string }[] };
    }
  ).getQualityProfilesSyncConfig;

  assertEquals(getConfig.call(syncer), {
    selections: [{ databaseId: 41, profileName: '  Exact Config Name  ' }],
  });

  syncer.setPreviewConfig({ selections: 'not-an-array-or-map' });
  await assertRejects(() => syncer.generatePreview(), Error, 'Invalid reviewed quality profile configuration');
});
