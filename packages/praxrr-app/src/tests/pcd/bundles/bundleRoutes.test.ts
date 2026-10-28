import { assert, assertEquals } from '@std/assert';
import type { RequestEvent } from '@sveltejs/kit';
import { GET as exportGet } from '../../../routes/api/v1/pcd/export/+server.ts';
import { POST as importPost } from '../../../routes/api/v1/pcd/import/+server.ts';
import { _bundleImportDependencies } from '$pcd/bundles/index.ts';
import { BUNDLE_MAX_ENTITIES } from '$shared/pcd/bundle.ts';
import {
  bundleOf,
  bundleTest,
  createPcd,
  customFormatData,
  liveCache,
  namesIn,
  qualityProfileData,
  regexData,
  scoredFormatNames,
  seedEntity,
  snapshotOps,
} from './bundleTestHelpers.ts';

async function post(body: unknown): Promise<Response> {
  const request = new Request('http://localhost/api/v1/pcd/import', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return await importPost({ request } as unknown as RequestEvent);
}

async function get(query: string): Promise<Response> {
  const url = new URL(`http://localhost/api/v1/pcd/export?${query}`);
  return await exportGet({ url, request: new Request(url) } as unknown as RequestEvent);
}

const fullBundle = () =>
  bundleOf(
    ['regular_expression', regexData('Rx One')],
    ['custom_format', customFormatData('CF One', 'Rx One')],
    ['quality_profile', qualityProfileData('QP One', ['CF One'])]
  );

bundleTest('bundle route: dry run returns the report and writes nothing', async () => {
  const databaseId = await createPcd();
  const before = snapshotOps(databaseId);
  const response = await post({
    databaseId,
    layer: 'user',
    bundle: fullBundle(),
    dryRun: true,
    collisions: { default: 'skip' },
  });
  const report = await response.json();

  assertEquals(response.status, 200);
  assertEquals(report.dryRun, true);
  assertEquals(report.applied, false);
  assertEquals(report.outcomes.length, 3);
  assertEquals(snapshotOps(databaseId), before);
  assertEquals(namesIn(liveCache(databaseId), 'custom_formats'), []);
});

bundleTest('bundle route: real apply returns 200 and the export round-trips into a second database', async () => {
  const source = await createPcd();
  await seedEntity(source, 'regular_expression', regexData('Rx One'));
  await seedEntity(source, 'custom_format', customFormatData('CF One', 'Rx One'));
  await seedEntity(source, 'quality_profile', qualityProfileData('QP One', ['CF One']));

  const exported = await get(`databaseId=${source}&entityType=quality_profile&name=QP%20One&includeDependencies=true`);
  assertEquals(exported.status, 200);
  const { bundle } = await exported.json();
  assertEquals(bundle.entities.length, 3);

  const target = await createPcd();
  const response = await post({ databaseId: target, layer: 'user', bundle, collisions: { default: 'skip' } });
  const report = await response.json();
  assertEquals(response.status, 200);
  assertEquals(report.applied, true);
  assertEquals(scoredFormatNames(liveCache(target), 'QP One'), ['CF One']);
});

bundleTest('bundle route: missing references on a real apply return 400 with the report and no writes', async () => {
  const databaseId = await createPcd();
  const before = snapshotOps(databaseId);
  const response = await post({
    databaseId,
    layer: 'user',
    bundle: bundleOf(['quality_profile', qualityProfileData('QP One', ['CF Ghost'])]),
    collisions: { default: 'skip' },
  });
  const body = await response.json();

  assertEquals(response.status, 400);
  assertEquals(body.missingReferences.length, 1);
  assertEquals(body.report.applied, false);
  assertEquals(snapshotOps(databaseId), before);
});

bundleTest('bundle route: mid-apply failure returns 500 with rolledBack and leaves no new ops', async () => {
  const databaseId = await createPcd();
  const before = snapshotOps(databaseId);
  _bundleImportDependencies.afterLiveEntity = (index) => {
    if (index === 1) throw new Error('injected');
  };
  try {
    const response = await post({ databaseId, layer: 'user', bundle: fullBundle(), collisions: { default: 'skip' } });
    const body = await response.json();
    assertEquals(response.status, 500);
    assertEquals(body.rolledBack, true);
    assertEquals(body.report.rolledBack, true);
  } finally {
    delete _bundleImportDependencies.afterLiveEntity;
  }
  assertEquals(snapshotOps(databaseId), before);
});

bundleTest('bundle route: base layer without write access is 403', async () => {
  const databaseId = await createPcd();
  const response = await post({ databaseId, layer: 'base', bundle: fullBundle(), dryRun: true });
  assertEquals(response.status, 403);
});

bundleTest('bundle route: entity cap and body size cap return 400', async () => {
  const databaseId = await createPcd();
  const tooMany = {
    version: 1,
    entities: Array.from({ length: BUNDLE_MAX_ENTITIES + 1 }, (_, i) => ({
      entityType: 'regular_expression',
      data: regexData(`Rx ${i}`),
    })),
  };
  const capResponse = await post({ databaseId, layer: 'user', bundle: tooMany, dryRun: true });
  assertEquals(capResponse.status, 400);

  const huge = bundleOf(['regular_expression', regexData('Rx Big', 'x'.repeat(5 * 1024 * 1024 + 1))]);
  const sizeResponse = await post({ databaseId, layer: 'user', bundle: huge, dryRun: true });
  assertEquals(sizeResponse.status, 400);
  assert((await sizeResponse.json()).error.includes('limit'));
});

bundleTest('bundle route: a legacy single-entity body still imports and returns { success: true }', async () => {
  const databaseId = await createPcd();
  const response = await post({
    databaseId,
    layer: 'user',
    entityType: 'regular_expression',
    data: regexData('Legacy Rx'),
  });
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { success: true });
  assertEquals(namesIn(liveCache(databaseId), 'regular_expressions'), ['Legacy Rx']);
});
