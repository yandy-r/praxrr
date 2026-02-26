import { assertEquals, assertRejects } from '@std/assert';
import { clearAllCaches, setCache } from '$pcd/database/registry.ts';
import { mergePreviewFormatIdMap } from '../../lib/server/sync/qualityProfiles/syncer.ts';
import { QualityProfileSyncer } from '../../lib/server/sync/qualityProfiles/syncer.ts';
import type { PCDCache } from '$pcd/index.ts';

function withFakeQualityApiMappingCache(): PCDCache {
  return {
    kb: {
      selectFrom: () => ({
        where: () => ({
          select: () => ({
            execute: async () => [{ quality_name: '1080p', api_name: '1080p' }],
          }),
        }),
      }),
    },
    close: () => {},
  } as unknown as PCDCache;
}

function makeSyncer() {
  const client = {} as never;
  return new QualityProfileSyncer(client, 1, 'test', 'radarr');
}

type GetQualityMappings = (batches: Array<unknown>) => Promise<Map<string, string>>;

Deno.test('getQualityMappings: returns empty map when only TRaSH batches exist', async () => {
  const syncer = makeSyncer();
  const getQualityMappings = (syncer as unknown as { getQualityMappings: GetQualityMappings }).getQualityMappings;

  const mappings = await getQualityMappings.call(syncer, [
    {
      sourceKind: 'trash',
      sourceLabel: 'trash-source',
      databaseId: -1,
      suffix: '-t',
      profiles: [],
      customFormats: new Map(),
      pcdFormatIdMap: new Map(),
    },
  ] as never);

  try {
    assertEquals(mappings.size, 0);
  } finally {
    clearAllCaches();
  }
});

Deno.test('getQualityMappings: throws when PCD batch exists but cache is missing', async () => {
  const syncer = makeSyncer();
  const getQualityMappings = (syncer as unknown as { getQualityMappings: GetQualityMappings }).getQualityMappings;

  await assertRejects(
    () =>
      getQualityMappings.call(syncer, [
        {
          sourceKind: 'pcd',
          sourceLabel: 'pcd-source',
          databaseId: 10,
          suffix: '-p',
          profiles: [],
          customFormats: new Map(),
          pcdFormatIdMap: new Map(),
        },
      ] as never),
    Error,
    'No PCD cache available for quality API mappings'
  );
});

Deno.test('getQualityMappings: returns mapped qualities from the first available PCD cache', async () => {
  setCache(10, withFakeQualityApiMappingCache());
  const syncer = makeSyncer();
  const getQualityMappings = (syncer as unknown as { getQualityMappings: GetQualityMappings }).getQualityMappings;

  try {
    const mappings = await getQualityMappings.call(syncer, [
      {
        sourceKind: 'pcd',
        sourceLabel: 'pcd-source',
        databaseId: 10,
        suffix: '-p',
        profiles: [],
        customFormats: new Map(),
        pcdFormatIdMap: new Map(),
      },
    ] as never);

    assertEquals(mappings.size, 1);
    assertEquals(mappings.get('1080p'), '1080p');
  } finally {
    clearAllCaches();
  }
});

Deno.test('mergePreviewFormatIdMap adds preview-created custom formats', () => {
  const existing = new Map<string, number>([
    ['Existing-A', 101],
    ['Existing-B', 102],
  ]);

  const merged = mergePreviewFormatIdMap(existing, [
    {
      arrFormat: {
        name: 'Preview-New',
        id: -1,
      },
    },
  ]);

  assertEquals(merged.get('Existing-A'), 101);
  assertEquals(merged.get('Existing-B'), 102);
  assertEquals(merged.get('Preview-New'), -1);
});

Deno.test('mergePreviewFormatIdMap ignores preview formats without ids', () => {
  const existing = new Map<string, number>([['Existing-A', 101]]);

  const merged = mergePreviewFormatIdMap(existing, [
    {
      arrFormat: {
        name: 'No-Id',
      },
    },
  ]);

  assertEquals(merged.get('Existing-A'), 101);
  assertEquals(merged.has('No-Id'), false);
});

Deno.test('mergePreviewFormatIdMap keeps newest id when names collide', () => {
  const existing = new Map<string, number>([['Colliding-Name', 101]]);

  const merged = mergePreviewFormatIdMap(existing, [
    {
      arrFormat: {
        name: 'Colliding-Name',
        id: -7,
      },
    },
  ]);

  assertEquals(merged.get('Colliding-Name'), -7);
});
