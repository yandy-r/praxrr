import { assert, assertEquals } from '@std/assert';
import type { ConditionData } from '$shared/pcd/display.ts';
import type { RequestEvent } from '@sveltejs/kit';
import { POST as importPost } from '../../routes/api/v1/pcd/import/+server.ts';
import { withWriterScope } from '$pcd/bundles/writerRedirect.ts';
import type { WriteOptions, WriteResult } from '$pcd/core/types.ts';
import { writeOperation as persistOperation } from '$pcd/ops/writer.ts';
import type { PortableEntityData } from '$shared/pcd/portable.ts';
import {
  bundleTest,
  createPcd,
  customFormatData,
  liveCache,
  namesIn,
  qualityProfileData,
  scoredFormatNames,
  seedEntity,
  regexData,
  snapshotOps,
} from './bundles/bundleTestHelpers.ts';

async function postImport(databaseId: number, entityType: string, data: PortableEntityData): Promise<Response> {
  const request = new Request('http://localhost/api/v1/pcd/import', {
    method: 'POST',
    body: JSON.stringify({ databaseId, layer: 'user', entityType, data }),
  });
  return await importPost({ request } as unknown as RequestEvent);
}

bundleTest('pcd import: QP scoring a missing CF is a 400 naming the CF and persists nothing', async () => {
  const databaseId = await createPcd();
  await seedEntity(databaseId, 'regular_expression', regexData('Rx One'));
  await seedEntity(databaseId, 'custom_format', customFormatData('CF One', 'Rx One'));
  const before = snapshotOps(databaseId);

  const response = await postImport(
    databaseId,
    'quality_profile',
    qualityProfileData('QP One', ['CF One', 'CF Ghost'])
  );
  const body = await response.json();

  assertEquals(response.status, 400);
  assert(body.error.includes('CF Ghost'), body.error);
  assert(!body.error.includes('"CF One"'), body.error);
  assertEquals(snapshotOps(databaseId), before);
  assertEquals(namesIn(liveCache(databaseId), 'quality_profiles'), []);
});

bundleTest('pcd import: CF with a condition on a missing regex is a 400 naming it and persists nothing', async () => {
  const databaseId = await createPcd();
  const before = snapshotOps(databaseId);

  const response = await postImport(databaseId, 'custom_format', customFormatData('CF One', 'Rx Ghost'));
  const body = await response.json();

  assertEquals(response.status, 400);
  assert(body.error.includes('Rx Ghost'), body.error);
  assertEquals(snapshotOps(databaseId), before);
  assertEquals(namesIn(liveCache(databaseId), 'custom_formats'), []);
});

bundleTest('pcd import: QP with resolvable references still imports qualities and scores', async () => {
  const databaseId = await createPcd();
  await seedEntity(databaseId, 'regular_expression', regexData('Rx One'));
  await seedEntity(databaseId, 'custom_format', customFormatData('CF One', 'Rx One'));

  const response = await postImport(databaseId, 'quality_profile', qualityProfileData('QP One', ['CF One']));

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { success: true });
  assertEquals(scoredFormatNames(liveCache(databaseId), 'QP One'), ['CF One']);
});

/** A minimal language condition (the writer stores one language per condition). */
function languageCondition(language: string): ConditionData {
  return {
    name: 'lang',
    type: 'language',
    arrType: 'all',
    negate: false,
    required: true,
    languages: [{ name: language, except: false }],
  };
}

const missingReferenceCases: Array<{ name: string; entityType: string; data: PortableEntityData; missing: string }> = [
  {
    name: 'CF language condition on a missing language',
    entityType: 'custom_format',
    data: { ...customFormatData('CF Lang', 'unused'), conditions: [languageCondition('Klingon')] },
    missing: 'language "Klingon"',
  },
  {
    name: 'QP with a missing language',
    entityType: 'quality_profile',
    data: { ...qualityProfileData('QP Lang', []), language: 'Klingon' },
    missing: 'language "Klingon"',
  },
  {
    name: 'QP orderedItems naming a missing quality',
    entityType: 'quality_profile',
    data: {
      ...qualityProfileData('QP Quality', []),
      orderedItems: [{ type: 'quality', name: 'HoloDeck-8K', position: 1, enabled: true, upgradeUntil: true }],
    },
    missing: 'quality "HoloDeck-8K"',
  },
  {
    name: 'QP group naming a missing quality member',
    entityType: 'quality_profile',
    data: {
      ...qualityProfileData('QP Group', []),
      orderedItems: [
        {
          type: 'group',
          name: 'Future',
          position: 1,
          enabled: true,
          upgradeUntil: true,
          members: [{ name: 'Bluray-1080p' }, { name: 'HoloDeck-8K' }],
        },
      ],
    },
    missing: 'quality "HoloDeck-8K"',
  },
];

for (const testCase of missingReferenceCases) {
  bundleTest(`pcd import: ${testCase.name} is a 400 naming it and persists nothing`, async () => {
    const databaseId = await createPcd();
    const before = snapshotOps(databaseId);

    const response = await postImport(databaseId, testCase.entityType, testCase.data);
    const body = await response.json();

    assertEquals(response.status, 400);
    assert(body.error.includes(`missing ${testCase.missing}`), body.error);
    assertEquals(snapshotOps(databaseId), before);
  });
}

/** Persist every write normally except those whose description starts with `prefix`, which fail. */
function failingWrites(prefix: string) {
  return (options: WriteOptions): Promise<WriteResult> =>
    options.description.startsWith(prefix)
      ? Promise.resolve({ success: false, error: 'injected' })
      : persistOperation(options);
}

bundleTest('pcd import: a QP qualities write failing after create is reported and rolled back', async () => {
  const databaseId = await createPcd();
  const before = snapshotOps(databaseId);

  const response = await withWriterScope(failingWrites('update-quality-profile-qualities-'), () =>
    postImport(databaseId, 'quality_profile', qualityProfileData('QP One', []))
  );
  const body = await response.json();

  assertEquals(response.status, 500);
  assertEquals(body.error, 'injected');
  assertEquals(snapshotOps(databaseId), before);
  assertEquals(namesIn(liveCache(databaseId), 'quality_profiles'), []);
});

bundleTest('pcd import: a CF conditions write failing after create is reported and rolled back', async () => {
  const databaseId = await createPcd();
  await seedEntity(databaseId, 'regular_expression', regexData('Rx One'));
  const before = snapshotOps(databaseId);

  const response = await withWriterScope(failingWrites('add-condition-'), () =>
    postImport(databaseId, 'custom_format', customFormatData('CF One', 'Rx One'))
  );
  const body = await response.json();

  assertEquals(response.status, 500);
  assertEquals(body.error, 'injected');
  assertEquals(snapshotOps(databaseId), before);
  assertEquals(namesIn(liveCache(databaseId), 'custom_formats'), []);
});
