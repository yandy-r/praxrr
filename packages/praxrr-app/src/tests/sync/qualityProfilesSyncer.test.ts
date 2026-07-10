import { assertEquals } from '@std/assert';
import { QualityProfileSyncer } from '$sync/qualityProfiles/syncer.ts';
import type { PcdQualityProfile } from '$sync/qualityProfiles/transformer.ts';

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

Deno.test('quality profile sync returns success false and failedProfiles when any profile fails to sync', async () => {
  let createCalls = 0;
  const client = {
    getCustomFormats: () => Promise.resolve([]),
    getQualityProfiles: () => Promise.resolve([]),
    updateQualityProfile: () => Promise.resolve({}),
    createQualityProfile: () => {
      createCalls += 1;
      if (createCalls === 1) {
        throw new Error('mock create failed');
      }

      return Promise.resolve({ id: createCalls * 10, name: 'ok', cutoff: 0, qualityProfile: {} });
    },
  };

  const syncer = new QualityProfileSyncer(client as never, 10, 'Test', 'radarr');
  const syncerAny = syncer as unknown as {
    fetchSyncBatches: () => Promise<
      Array<{
        sourceKind: 'pcd';
        sourceLabel: string;
        databaseId: number;
        suffix: string;
        profiles: Array<{ pcdProfile: PcdQualityProfile; referencedFormatNames: string[] }>;
        customFormats: Map<string, never>;
        pcdFormatIdMap: Map<string, number>;
      }>
    >;
    getQualityMappings: (batches: unknown[]) => Promise<Map<string, string>>;
  };
  syncerAny.fetchSyncBatches = () => Promise.resolve([createBatch(1, '-x', ['failing-profile', 'passing-profile'])]);
  syncerAny.getQualityMappings = () => Promise.resolve(new Map());

  const result = await syncer.sync();

  assertEquals(result.success, false);
  assertEquals(result.itemsSynced, 1);
  assertEquals(result.failedProfiles, ['failing-profile']);
  assertEquals(result.error, 'Failed to sync 1 quality profile(s)');
  assertEquals(
    result.outcomes.map((outcome) => outcome.status),
    ['failed', 'success']
  );
});

Deno.test('quality profile sync returns success true when all quality profiles sync', async () => {
  const client = {
    getCustomFormats: () => Promise.resolve([]),
    getQualityProfiles: () => Promise.resolve([]),
    updateQualityProfile: () => Promise.resolve({}),
    createQualityProfile: () => Promise.resolve({ id: 42, name: 'ok', cutoff: 0, qualityProfile: {} }),
  };

  const syncer = new QualityProfileSyncer(client as never, 11, 'Test', 'radarr');
  const syncerAny = syncer as unknown as {
    fetchSyncBatches: () => Promise<
      Array<{
        sourceKind: 'pcd';
        sourceLabel: string;
        databaseId: number;
        suffix: string;
        profiles: Array<{ pcdProfile: PcdQualityProfile; referencedFormatNames: string[] }>;
        customFormats: Map<string, never>;
        pcdFormatIdMap: Map<string, number>;
      }>
    >;
    getQualityMappings: (batches: unknown[]) => Promise<Map<string, string>>;
  };
  syncerAny.fetchSyncBatches = () => Promise.resolve([createBatch(1, '-x', ['good-1', 'good-2'])]);
  syncerAny.getQualityMappings = () => Promise.resolve(new Map());

  const result = await syncer.sync();

  assertEquals(result.success, true);
  assertEquals(result.itemsSynced, 2);
  assertEquals(
    result.outcomes.map((outcome) => outcome.status),
    ['success', 'success']
  );
  assertEquals(result.failedProfiles, undefined);
  assertEquals(result.error, undefined);
});

Deno.test('ordinary quality profile sync treats a missing create response id as a failed write', async () => {
  const client = {
    getCustomFormats: () => Promise.resolve([]),
    getQualityProfiles: () => Promise.resolve([]),
    updateQualityProfile: () => Promise.resolve({}),
    createQualityProfile: () => Promise.resolve({}),
  };
  const syncer = new QualityProfileSyncer(client as never, 12, 'Test', 'radarr');
  const syncerAny = syncer as unknown as {
    fetchSyncBatches: () => Promise<ReturnType<typeof createBatch>[]>;
    getQualityMappings: () => Promise<Map<string, string>>;
  };
  syncerAny.fetchSyncBatches = () => Promise.resolve([createBatch(1, '-x', ['missing-id'])]);
  syncerAny.getQualityMappings = () => Promise.resolve(new Map());

  const result = await syncer.sync();
  assertEquals(result.success, false);
  assertEquals(result.itemsSynced, 0);
  assertEquals(result.failedProfiles, ['missing-id']);
  assertEquals(result.outcomes.length, 1);
  assertEquals(result.outcomes[0].status, 'failed');
  assertEquals(result.outcomes[0].remoteId, null);
});
