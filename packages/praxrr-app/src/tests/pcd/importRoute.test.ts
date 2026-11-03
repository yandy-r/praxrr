import { assert, assertEquals, assertNotEquals } from '@std/assert';
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

  assertNotEquals(response.status, 200);
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

  assertNotEquals(response.status, 200);
  assertEquals(body.error, 'injected');
  assertEquals(snapshotOps(databaseId), before);
  assertEquals(namesIn(liveCache(databaseId), 'custom_formats'), []);
});
