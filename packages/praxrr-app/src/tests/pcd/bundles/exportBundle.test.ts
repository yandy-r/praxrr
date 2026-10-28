import { assertEquals, assertRejects } from '@std/assert';
import { BundleExportLimitError, exportBundle } from '$pcd/bundles/index.ts';
import { BUNDLE_MAX_ENTITIES } from '$shared/pcd/bundle.ts';
import {
  bundleTest,
  createPcd,
  customFormatData,
  qualityProfileData,
  regexData,
  seedEntity,
} from './bundleTestHelpers.ts';

const names = (result: Awaited<ReturnType<typeof exportBundle>>) =>
  result.bundle.entities.map((entry) => `${entry.entityType}:${(entry.data as { name: string }).name}`);

bundleTest('exportBundle: includeDependencies adds referenced CFs and regexes', async () => {
  const databaseId = await createPcd();
  await seedEntity(databaseId, 'regular_expression', regexData('Rx One'));
  await seedEntity(databaseId, 'custom_format', customFormatData('CF One', 'Rx One'));
  await seedEntity(databaseId, 'quality_profile', qualityProfileData('QP One', ['CF One']));

  const withDeps = await exportBundle(databaseId, 'quality_profile', ['QP One'], true);
  assertEquals(withDeps.bundle.version, 1);
  assertEquals(names(withDeps), ['regular_expression:Rx One', 'custom_format:CF One', 'quality_profile:QP One']);

  const without = await exportBundle(databaseId, 'quality_profile', ['QP One'], false);
  assertEquals(names(without), ['quality_profile:QP One']);
});

bundleTest('exportBundle: repeated names export only the named entities; missing root is not found', async () => {
  const databaseId = await createPcd();
  await seedEntity(databaseId, 'regular_expression', regexData('Rx One'));
  await seedEntity(databaseId, 'regular_expression', regexData('Rx Two'));

  const bundle = await exportBundle(databaseId, 'regular_expression', ['Rx Two', 'Rx One', 'rx one'], false);
  assertEquals(names(bundle).sort(), ['regular_expression:Rx One', 'regular_expression:Rx Two']);

  await assertRejects(() => exportBundle(databaseId, 'regular_expression', ['Missing'], false), Error, 'not found');
});

bundleTest('exportBundle: more than the entity cap is rejected', async () => {
  const databaseId = await createPcd();
  const tooMany = Array.from({ length: BUNDLE_MAX_ENTITIES + 1 }, (_, i) => `Rx ${i}`);
  await assertRejects(() => exportBundle(databaseId, 'regular_expression', tooMany, false), BundleExportLimitError);
});
