import { assert, assertEquals, assertFalse } from '@std/assert';
import type { RequestEvent } from '@sveltejs/kit';
import { POST as enablePost } from '../../../routes/api/v1/pcd/[databaseId]/enable/+server.ts';
import { actions as settingsActions } from '../../../routes/databases/[id]/settings/+page.server.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { getCache, getCachedDatabaseIds } from '$pcd/database/registry.ts';
import { invalidate } from '$pcd/database/compiler.ts';
import { pcdManager, ReenableError } from '$pcd/index.ts';
import { bundleTest, createPcd, liveCache, namesIn, regexData, seedEntity } from '../bundles/bundleTestHelpers.ts';

/**
 * YAN-748: `database_instances.enabled` was cleared on a failed cache build but nothing ever set
 * it back. Re-enable must recompile first and only then flip the flag; a still-broken database
 * stays disabled and is never served.
 */

/** Simulate the state `PCDCache.build()` leaves after a failure: disabled with no usable cache. */
function simulateAutoDisable(databaseId: number): void {
  assert(databaseInstancesQueries.disable(databaseId));
  invalidate(databaseId);
  assertEquals(getCache(databaseId), undefined);
}

/** Add a schema op that cannot execute so every compile of this database fails. */
async function breakSchema(databaseId: number): Promise<void> {
  const instance = databaseInstancesQueries.getById(databaseId)!;
  await Deno.writeTextFile(`${instance.local_path}/deps/schema/ops/9999.broken.sql`, 'THIS IS NOT VALID SQL;');
}

function isEnabled(databaseId: number): boolean {
  return databaseInstancesQueries.getById(databaseId)?.enabled === 1;
}

async function postEnable(databaseId: string): Promise<Response> {
  return await enablePost({
    params: { databaseId },
    request: new Request(`http://localhost/api/v1/pcd/${databaseId}/enable`, { method: 'POST' }),
  } as unknown as RequestEvent);
}

bundleTest('reenable: a disabled database with good ops is enabled and its cache registered', async () => {
  const databaseId = await createPcd();
  // A persisted user op must survive the recompile that re-enabling performs.
  await seedEntity(databaseId, 'regular_expression', regexData('Rx One'));
  simulateAutoDisable(databaseId);
  assertFalse(isEnabled(databaseId));

  const result = await pcdManager.reenable(databaseId);

  assertEquals(result, { status: 'enabled' });
  assert(isEnabled(databaseId));
  assert(getCachedDatabaseIds().includes(databaseId));
  assertEquals(namesIn(liveCache(databaseId), 'regular_expressions'), ['Rx One']);
});

bundleTest('reenable: a still-broken database stays disabled and no cache is registered', async () => {
  const databaseId = await createPcd();
  simulateAutoDisable(databaseId);
  await breakSchema(databaseId);

  let error: unknown;
  try {
    await pcdManager.reenable(databaseId);
  } catch (e) {
    error = e;
  }

  assert(error instanceof ReenableError);
  assertEquals((error as ReenableError).code, 'recompile_failed');
  assertFalse(isEnabled(databaseId));
  assertEquals(getCache(databaseId), undefined);
  assertFalse(getCachedDatabaseIds().includes(databaseId));
});

bundleTest('reenable: an already-enabled database is a no-op and keeps its cache', async () => {
  const databaseId = await createPcd();
  const cache = liveCache(databaseId);

  assertEquals(await pcdManager.reenable(databaseId), { status: 'already_enabled' });

  assert(isEnabled(databaseId));
  assert(getCache(databaseId) === cache);
});

bundleTest('reenable: an unknown database is a not_found ReenableError', async () => {
  let error: unknown;
  try {
    await pcdManager.reenable(9999);
  } catch (e) {
    error = e;
  }
  assert(error instanceof ReenableError);
  assertEquals((error as ReenableError).code, 'not_found');
});

bundleTest('reenable: concurrent calls share one run', async () => {
  const databaseId = await createPcd();
  simulateAutoDisable(databaseId);

  const [a, b] = await Promise.all([pcdManager.reenable(databaseId), pcdManager.reenable(databaseId)]);

  assertEquals(a, { status: 'enabled' });
  assertEquals(b, { status: 'enabled' });
  assert(isEnabled(databaseId));
});

bundleTest('enable route: 200 enabled, then 200 already_enabled', async () => {
  const databaseId = await createPcd();
  simulateAutoDisable(databaseId);

  const first = await postEnable(String(databaseId));
  assertEquals(first.status, 200);
  assertEquals(await first.json(), { status: 'enabled' });
  assert(isEnabled(databaseId));
  assert(getCache(databaseId) !== undefined);

  const second = await postEnable(String(databaseId));
  assertEquals(second.status, 200);
  assertEquals(await second.json(), { status: 'already_enabled' });
});

bundleTest('enable route: 422 with a generic message and no cache when recompile fails', async () => {
  const databaseId = await createPcd();
  simulateAutoDisable(databaseId);
  await breakSchema(databaseId);

  const response = await postEnable(String(databaseId));
  const body = await response.json();

  assertEquals(response.status, 422);
  assertFalse(isEnabled(databaseId));
  assertEquals(getCache(databaseId), undefined);
  // No raw exception text (SQL, file names, stack) in the body.
  assertFalse(body.error.includes('NOT VALID SQL'), body.error);
  assertFalse(body.error.includes('9999.broken.sql'), body.error);
  assertFalse(body.error.includes('Error:'), body.error);
});

bundleTest('enable route: 400 for a malformed id and 404 for an unknown database', async () => {
  assertEquals((await postEnable('abc')).status, 400);
  assertEquals((await postEnable('0')).status, 400);
  assertEquals((await postEnable('9999')).status, 404);
});

bundleTest('settings enable action: success, then failure keeps the database disabled', async () => {
  const databaseId = await createPcd();
  simulateAutoDisable(databaseId);
  const run = (id: string) =>
    (settingsActions.enable as (event: unknown) => Promise<Record<string, unknown>>)({ params: { id } });

  const ok = await run(String(databaseId));
  assertEquals(ok, { enableSuccess: true, enableStatus: 'enabled' });
  assert(isEnabled(databaseId));

  simulateAutoDisable(databaseId);
  await breakSchema(databaseId);
  const failed = (await run(String(databaseId))) as { status: number; data: { error: string } };
  assertEquals(failed.status, 422);
  assertFalse(failed.data.error.includes('NOT VALID SQL'));
  assertFalse(isEnabled(databaseId));
  assertEquals(getCache(databaseId), undefined);

  assertEquals(((await run('9999')) as { status: number }).status, 404);
});
