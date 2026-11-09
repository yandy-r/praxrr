import { assert, assertEquals, assertFalse } from '@std/assert';
import type { RequestEvent } from '@sveltejs/kit';
import { POST as enablePost } from '../../../routes/api/v1/pcd/[databaseId]/enable/+server.ts';
import { actions as settingsActions } from '../../../routes/databases/[id]/settings/+page.server.ts';
import { db } from '$db/db.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { getPcdSyncDedupeKey } from '$jobs/helpers/pcdSyncDedupeKey.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { getCache, getCachedDatabaseIds } from '$pcd/database/registry.ts';
import { compile, invalidate } from '$pcd/database/compiler.ts';
import { withDatabaseOverrideLock } from '$pcd/conflicts/override.ts';
import {
  __testOnly_resetCompile,
  __testOnly_resetReadMigrationEntitySources,
  __testOnly_setCompile,
  __testOnly_setReadMigrationEntitySources,
} from '$pcd/ops/importBaseOps.ts';
import type { MigrationEntityCandidate } from '$pcd/migration/reader.ts';
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

/** Whether the instance row currently has `enabled = 1`. */
function isEnabled(databaseId: number): boolean {
  return databaseInstancesQueries.getById(databaseId)?.enabled === 1;
}

/** Invoke the enable route handler directly with the given `databaseId` path param. */
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
  // Strict id parsing: parseInt would accept '1abc' as 1.
  assertEquals(((await run('1abc')) as { status: number }).status, 400);
});

/** A repo-import candidate that makes `importBaseOps` take the import + compile path. */
function probeCandidate(deserialize: () => Promise<{ success: boolean; error?: string }>): MigrationEntityCandidate {
  return {
    sourcePath: '/tmp/regular-expressions/probe.yaml',
    relativePath: 'regular-expressions/probe.yaml',
    entityType: 'regular_expression',
    migration: { source: 'entities/regular-expressions/probe.yaml', format: 'yaml', version: 1 },
    portable: { name: 'Rx Probe' },
    entityName: 'Rx Probe',
    identity: { kind: 'identity', key: 'migration:regular_expression', value: 'Rx Probe' },
    stableIdentity: { key: 'regular_expression_name', value: 'Rx Probe', kind: 'stable' },
    deserialize,
  } as unknown as MigrationEntityCandidate;
}

bundleTest('reenable: a stale registered cache is not served when the rebuild fails', async () => {
  const databaseId = await createPcd();
  // Auto-disable leaves the previously registered cache in place; it must not survive a failed re-enable.
  assert(databaseInstancesQueries.disable(databaseId));
  assert(getCache(databaseId) !== undefined);
  await breakSchema(databaseId);

  let error: unknown;
  try {
    await pcdManager.reenable(databaseId);
  } catch (e) {
    error = e;
  }

  assert(error instanceof ReenableError);
  assertFalse(isEnabled(databaseId));
  assertEquals(getCache(databaseId), undefined);
});

bundleTest('reenable: a failing repo import rolls back and ends disabled with no cache', async () => {
  const databaseId = await createPcd();
  simulateAutoDisable(databaseId);
  __testOnly_setReadMigrationEntitySources(() =>
    Promise.resolve({
      candidates: [probeCandidate(() => Promise.resolve({ success: false, error: 'boom: secret detail' }))],
      issues: [],
    })
  );
  try {
    let error: unknown;
    try {
      await pcdManager.reenable(databaseId);
    } catch (e) {
      error = e;
    }
    assert(error instanceof ReenableError);
    assertFalse((error as ReenableError).message.includes('secret detail'));
    assertFalse(isEnabled(databaseId));
    assertEquals(getCache(databaseId), undefined);
  } finally {
    __testOnly_resetReadMigrationEntitySources();
  }
});

bundleTest('reenable: the instance stays disabled during import and compile and is enabled only after', async () => {
  const databaseId = await createPcd();
  simulateAutoDisable(databaseId);
  const observed: Record<string, boolean> = {};
  __testOnly_setReadMigrationEntitySources(() =>
    Promise.resolve({
      candidates: [
        probeCandidate(() => {
          observed.duringImport = isEnabled(databaseId);
          return Promise.resolve({ success: true });
        }),
      ],
      issues: [],
    })
  );
  __testOnly_setCompile(async (pcdPath, id) => {
    observed.duringCompile = isEnabled(databaseId);
    return await compile(pcdPath, id);
  });
  try {
    assertEquals(await pcdManager.reenable(databaseId), { status: 'enabled' });
  } finally {
    __testOnly_resetCompile();
    __testOnly_resetReadMigrationEntitySources();
  }

  assertEquals(observed, { duringImport: false, duringCompile: false });
  assert(isEnabled(databaseId));
  assert(getCache(databaseId) !== undefined);
});

bundleTest('reenable: waits for the per-database override lock before touching the instance', async () => {
  const databaseId = await createPcd();
  simulateAutoDisable(databaseId);

  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const enteredLock = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const holder = withDatabaseOverrideLock(databaseId, async () => {
    entered();
    await held;
  });
  await enteredLock;

  let settled = false;
  const pending = pcdManager.reenable(databaseId).finally(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assertFalse(settled);
  assertFalse(isEnabled(databaseId));
  assertEquals(getCache(databaseId), undefined);

  release();
  await holder;
  assertEquals(await pending, { status: 'enabled' });
  assert(isEnabled(databaseId));
});

bundleTest('enable route: reschedules pcd.sync only when it actually re-enabled the database', async () => {
  const databaseId = await createPcd();
  db.execute('UPDATE database_instances SET sync_strategy = 60 WHERE id = ?', databaseId);
  const dedupeKey = getPcdSyncDedupeKey(databaseId);
  simulateAutoDisable(databaseId);
  assertEquals(jobQueueQueries.getByDedupeKey(dedupeKey), undefined);

  assertEquals((await postEnable(String(databaseId))).status, 200);
  assert(jobQueueQueries.getByDedupeKey(dedupeKey) !== undefined);

  // already_enabled is a pure no-op: it must not re-create a job that was removed.
  jobQueueQueries.unscheduleByDedupeKey(dedupeKey);
  assertEquals((await postEnable(String(databaseId))).status, 200);
  assertEquals(jobQueueQueries.getByDedupeKey(dedupeKey), undefined);
});

bundleTest('reenable: a failure after the enable flip (override resolution) is rolled back to disabled', async () => {
  const databaseId = await createPcd();
  simulateAutoDisable(databaseId);
  assertEquals(databaseInstancesQueries.getById(databaseId)?.conflict_strategy, 'override');

  // Resolution only runs once the instance is enabled, so this throws strictly after the flip.
  const original = pcdOpHistoryQueries.listLatestConflictsByDatabase;
  pcdOpHistoryQueries.listLatestConflictsByDatabase = () => {
    throw new Error('conflict listing exploded');
  };
  try {
    let error: unknown;
    try {
      await pcdManager.reenable(databaseId);
    } catch (e) {
      error = e;
    }
    assert(error instanceof ReenableError);
    assertEquals((error as ReenableError).code, 'recompile_failed');
    assertFalse((error as ReenableError).message.includes('exploded'));
    assertFalse(isEnabled(databaseId));
    assertEquals(getCache(databaseId), undefined);
  } finally {
    pcdOpHistoryQueries.listLatestConflictsByDatabase = original;
  }
});

bundleTest('reenable: override auto-resolution re-enters the held lock without deadlocking', async () => {
  const databaseId = await createPcd();
  const instance = databaseInstancesQueries.getById(databaseId)!;
  assertEquals(instance.conflict_strategy, 'override');

  // Published base regex plus a published user update whose value guard never matches: replaying
  // it conflicts, and re-enable's auto-resolution must override it while holding the re-enable lock.
  pcdOpsQueries.create({
    databaseId,
    origin: 'base',
    state: 'published',
    source: 'local',
    sql: "INSERT INTO regular_expressions (name, pattern) VALUES ('Rx Conflict', 'x264')",
  });
  const conflictedOpId = pcdOpsQueries.create({
    databaseId,
    origin: 'user',
    state: 'published',
    source: 'local',
    sql: "UPDATE regular_expressions SET pattern = 'new' WHERE name = 'Rx Conflict' AND pattern = 'never'",
    metadata: JSON.stringify({ operation: 'update', entity: 'regular_expression', name: 'Rx Conflict' }),
    desiredState: JSON.stringify({ pattern: { from: 'x264', to: 'new' } }),
  });
  // Compile while disabled: compile() skips auto-resolution then, so the conflict stays pending
  // until re-enable resolves it (an enabled compile would have overridden it already).
  assert(databaseInstancesQueries.disable(databaseId));
  await compile(instance.local_path, databaseId);
  assertEquals(
    pcdOpHistoryQueries.listLatestConflictsByDatabase(databaseId).map((c) => c.op.id),
    [conflictedOpId]
  );
  invalidate(databaseId);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('re-enable deadlocked on the override lock')), 15_000);
  });
  try {
    assertEquals(await Promise.race([pcdManager.reenable(databaseId), timeout]), { status: 'enabled' });
  } finally {
    clearTimeout(timer);
  }

  assert(isEnabled(databaseId));
  assert(getCache(databaseId) !== undefined);
  // The conflicting op was overridden (superseded by its replacement), so no published user conflict remains.
  assertEquals(pcdOpHistoryQueries.listLatestConflictsByDatabase(databaseId), []);
  assertEquals(pcdOpsQueries.getById(conflictedOpId)?.state, 'superseded');
  assertEquals(
    liveCache(databaseId).query<{ pattern: string }>(
      "SELECT pattern FROM regular_expressions WHERE name = 'Rx Conflict'"
    ),
    [{ pattern: 'new' }]
  );
});

/** Make `schedulePcdSyncForDatabase` throw (it unschedules via this query when sync is off). */
function breakScheduling(): () => void {
  const original = jobQueueQueries.unscheduleByDedupeKey;
  jobQueueQueries.unscheduleByDedupeKey = () => {
    throw new Error('queue exploded');
  };
  return () => {
    jobQueueQueries.unscheduleByDedupeKey = original;
  };
}

bundleTest('enable route: a scheduling failure after a successful re-enable still returns 200', async () => {
  const databaseId = await createPcd();
  simulateAutoDisable(databaseId);
  const restore = breakScheduling();
  try {
    const response = await postEnable(String(databaseId));
    assertEquals(response.status, 200);
    assertEquals(await response.json(), { status: 'enabled' });
    assert(isEnabled(databaseId));
  } finally {
    restore();
  }
});

bundleTest('settings enable action: a scheduling failure after a successful re-enable still succeeds', async () => {
  const databaseId = await createPcd();
  simulateAutoDisable(databaseId);
  const restore = breakScheduling();
  try {
    const result = await (settingsActions.enable as (event: unknown) => Promise<Record<string, unknown>>)({
      params: { id: String(databaseId) },
    });
    assertEquals(result, { enableSuccess: true, enableStatus: 'enabled' });
    assert(isEnabled(databaseId));
  } finally {
    restore();
  }
});
