import { assert, assertEquals, assertRejects } from '@std/assert';
import { BUNDLE_MAX_ENTITIES } from '$shared/pcd/bundle.ts';
import { collectBundleClosure } from '$pcd/bundles/index.ts';
import {
  bundleTest,
  createPcd,
  customFormatData,
  liveCache,
  qualityProfileData,
  regexData,
  seedEntity,
  seedWideProfile,
} from './bundleTestHelpers.ts';

async function seedGraph(databaseId: number) {
  await seedEntity(databaseId, 'regular_expression', regexData('Rx One'));
  await seedEntity(databaseId, 'regular_expression', regexData('Rx Unused'));
  await seedEntity(databaseId, 'custom_format', customFormatData('CF One', 'Rx One'));
  await seedEntity(databaseId, 'custom_format', customFormatData('CF Shared', 'Rx One'));
  await seedEntity(databaseId, 'quality_profile', qualityProfileData('QP A', ['CF One', 'CF Shared']));
  await seedEntity(databaseId, 'quality_profile', qualityProfileData('QP B', ['CF Shared']));
}

const keys = (entries: Array<{ entityType: string; data: { name: string } }>) =>
  entries.map((entry) => `${entry.entityType}:${entry.data.name}`);

bundleTest('closure: a quality profile pulls its custom formats and regexes, dependency-first', async () => {
  const databaseId = await createPcd();
  await seedGraph(databaseId);
  const closure = await collectBundleClosure(liveCache(databaseId), [{ entityType: 'quality_profile', name: 'QP A' }]);

  assertEquals(keys(closure.entries as never), [
    'regular_expression:Rx One',
    'custom_format:CF One',
    'custom_format:CF Shared',
    'quality_profile:QP A',
  ]);
  assertEquals(closure.missing, []);
  assertEquals(closure.truncated, false);
});

bundleTest('closure: two profiles sharing a custom format do not duplicate entries', async () => {
  const databaseId = await createPcd();
  await seedGraph(databaseId);
  const closure = await collectBundleClosure(liveCache(databaseId), [
    { entityType: 'quality_profile', name: 'QP A' },
    { entityType: 'quality_profile', name: 'QP B' },
  ]);
  assertEquals(keys(closure.entries as never).filter((key) => key === 'custom_format:CF Shared').length, 1);
  assertEquals(closure.entries.length, 5);
});

bundleTest('closure: a custom format root pulls only its regexes; a leaf root exports alone', async () => {
  const databaseId = await createPcd();
  await seedGraph(databaseId);
  const cf = await collectBundleClosure(liveCache(databaseId), [{ entityType: 'custom_format', name: 'CF One' }]);
  assertEquals(keys(cf.entries as never), ['regular_expression:Rx One', 'custom_format:CF One']);

  const leaf = await collectBundleClosure(liveCache(databaseId), [
    { entityType: 'regular_expression', name: 'Rx Unused' },
  ]);
  assertEquals(keys(leaf.entries as never), ['regular_expression:Rx Unused']);
});

bundleTest('closure: a missing root throws a not-found error', async () => {
  const databaseId = await createPcd();
  await assertRejects(
    () => collectBundleClosure(liveCache(databaseId), [{ entityType: 'quality_profile', name: 'Nope' }]),
    Error,
    'not found'
  );
});

bundleTest('closure: the walk truncates at the entity cap instead of serializing partial CF chains', async () => {
  const databaseId = await createPcd();
  await seedWideProfile(databaseId, BUNDLE_MAX_ENTITIES + 5);

  const closure = await collectBundleClosure(liveCache(databaseId), [
    { entityType: 'quality_profile', name: 'QP Cap' },
  ]);
  assertEquals(closure.truncated, true);
  assert(closure.entries.length <= BUNDLE_MAX_ENTITIES);
});
