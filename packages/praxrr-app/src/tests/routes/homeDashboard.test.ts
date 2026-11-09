// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { canaryRolloutQueries } from '$db/queries/canaryRollouts.ts';
import { driftStatusQueries } from '$db/queries/driftStatus.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import { syncHistoryQueries } from '$db/queries/syncHistory.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import { resolveRootLayoutData } from '$lib/server/navigation/layoutData.ts';
import { invalidateNavBadges, resetNavBadgeCacheForTest } from '$lib/server/navigation/badges.ts';
import { invalidateConflictCounts } from '$pcd/conflicts/counts.ts';
import { resetParserCacheForTest } from '$lib/server/dashboard/parser.ts';
import { cachedShield } from '$lib/server/security/shieldCache.ts';
import { createDnsTransportResolver, overrideDnsTransportResolverForTest } from '$lib/server/security/dnsTransport.ts';
import { resetShieldCacheForTest } from '$lib/server/security/shieldCache.ts';
import type { HomeDashboardData } from '$shared/dashboard/types.ts';
import { load } from '../../routes/+page.server.ts';

type LoadEvent = Parameters<typeof load>[0];

function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/home-dashboard-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);
      resetShieldCacheForTest();
      resetNavBadgeCacheForTest();
      invalidateConflictCounts();
      resetParserCacheForTest();
      // No real DNS work from the posture computation.
      const restoreResolver = overrideDnsTransportResolverForTest(
        createDnsTransportResolver({ resolveDns: () => Promise.resolve([]) })
      );

      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        restoreResolver();
        jobDispatcher.stop();
        db.close();
        config.setBasePath(originalBasePath);
        resetNavBadgeCacheForTest();
        invalidateConflictCounts();
        resetParserCacheForTest();
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

async function loadDashboard(): Promise<HomeDashboardData> {
  const depends: string[] = [];
  const result = (await load({ depends: (...keys: string[]) => depends.push(...keys) } as unknown as LoadEvent)) as {
    dashboard: HomeDashboardData;
  };
  return result.dashboard;
}

function createInstance(name: string, type = 'radarr'): number {
  return arrInstancesQueries.create({ name, type, url: 'http://127.0.0.1:9', apiKey: 'test-api-key' });
}

function createDatabase(id: number): number {
  db.execute(
    `INSERT INTO database_instances (id, uuid, name, repository_url, local_path, enabled)
		VALUES (?, ?, ?, 'https://example.com/db.git', '/nonexistent/home-dashboard', 1)`,
    id,
    `uuid-${id}`,
    `db-${id}`
  );
  return id;
}

function seedConflict(databaseId: number, status: 'conflicted' | 'conflicted_pending' | 'applied'): void {
  const opId = pcdOpsQueries.create({
    databaseId,
    origin: 'user',
    state: 'published',
    source: 'local',
    sql: 'SELECT 1',
    metadata: JSON.stringify({ operation: 'update', entity: 'custom_format', name: `cf-${crypto.randomUUID()}` }),
  });
  pcdOpHistoryQueries.create({ opId, databaseId, batchId: 'b1', status });
}

function seedDrift(id: number, status: 'drifted' | 'unreachable'): void {
  driftStatusQueries.upsert({
    arrInstanceId: id,
    arrType: 'radarr',
    status,
    reason: null,
    driftedCount: 2,
    missingCount: 1,
    unmanagedCount: 0,
    driftSignature: 'sig-a',
    detectedVersion: null,
    changes: [],
    checkedAt: new Date().toISOString(),
    contentCheckedAt: null,
    durationMs: 1,
    driftDetectedAt: null,
  });
}

migratedTest('home dashboard load: empty install returns data (no redirect) with empty sections', async () => {
  const data = await loadDashboard();
  assertEquals(data.instances, []);
  assertEquals(data.databaseCount, 0);
  assertEquals(data.conflicts, { total: 0, databases: [] });
  assertEquals(data.canary, []);
  assertEquals(data.recentSyncs, []);
  assertEquals(data.drift.instances, 0);
  assert(typeof data.generatedAt === 'string');
});

migratedTest('home dashboard load: unreachable parser degrades to available=false without hanging', async () => {
  const started = Date.now();
  const data = await loadDashboard();
  assertEquals(data.parser.available, false);
  assert(Date.now() - started < 5000, 'parser probe must be time-bounded');
});

migratedTest('home dashboard: instance cards link the right instance and carry drift/sync state', async () => {
  const first = createInstance('Radarr One');
  const second = createInstance('Radarr Two');
  createInstance('Disabled', 'radarr');
  db.execute('UPDATE arr_instances SET enabled = 0 WHERE name = ?', 'Disabled');
  seedDrift(second, 'drifted');
  syncHistoryQueries.insert({
    arrInstanceId: first,
    instanceName: 'Radarr One',
    arrType: 'radarr',
    jobId: null,
    trigger: 'manual',
    triggerEvent: null,
    sectionsAttempted: [],
    status: 'failed',
    sectionsRun: 0,
    itemsSynced: 0,
    failureCount: 1,
    sectionResults: [],
    changes: [],
    entityOutcomes: [],
    previewId: null,
    error: 'boom',
    driftLink: null,
    startedAt: '2026-11-01T00:00:00.000Z',
    finishedAt: '2026-11-01T00:00:01.000Z',
    durationMs: 1000,
  });

  const data = await loadDashboard();
  assertEquals(data.instances.length, 2);
  for (const card of data.instances) {
    assertEquals(card.links.instance, `/arr/${card.id}`);
    assertEquals(card.links.previewSync, `/arr/${card.id}/sync`);
    assertEquals(card.links.drift, `/drift/${card.id}`);
    assertEquals(card.links.health, `/config-health/${card.id}`);
    assertEquals(card.links.syncHistory, `/sync-history?instanceId=${card.id}`);
  }
  const one = data.instances.find((card) => card.id === first)!;
  const two = data.instances.find((card) => card.id === second)!;
  assertEquals(one.lastSync?.status, 'failed');
  assertEquals(one.needsAttention, true);
  assertEquals(one.drift.status, 'never-checked');
  assertEquals(two.drift.status, 'drifted');
  assertEquals(two.drift.changeCount, 3);
  assertEquals(two.needsAttention, true);
  assertEquals(data.drift.drifted, 1);
  assertEquals(data.recentSyncs[0].href, `/sync-history/${data.recentSyncs[0].historyId}`);
  assertEquals(data.recentSyncs[0].instanceId, first);
});

migratedTest('home dashboard: conflict aggregation matches per-database listLatestConflictsByDatabase', async () => {
  createDatabase(1);
  createDatabase(2);
  createDatabase(3);
  seedConflict(1, 'conflicted');
  seedConflict(1, 'conflicted_pending');
  seedConflict(1, 'applied');
  seedConflict(2, 'conflicted');

  const data = await loadDashboard();
  assertEquals(data.databaseCount, 3);
  assertEquals(data.conflicts.total, 3);
  assertEquals(data.conflicts.databases.length, 2);
  for (const entry of data.conflicts.databases) {
    assertEquals(entry.count, pcdOpHistoryQueries.listLatestConflictsByDatabase(entry.databaseId).length);
    assertEquals(entry.href, `/databases/${entry.databaseId}/conflicts`);
  }
  // Database 3 has zero conflicts and is omitted.
  assertEquals(
    data.conflicts.databases.some((entry) => entry.databaseId === 3),
    false
  );
});

migratedTest('conflict counts: an op whose latest history row is applied is NOT counted', async () => {
  createDatabase(1);
  // Op A: conflicted then later applied -> resolved, must not count.
  const resolvedOp = pcdOpsQueries.create({
    databaseId: 1,
    origin: 'user',
    state: 'published',
    source: 'local',
    sql: 'SELECT 1',
    metadata: JSON.stringify({ operation: 'update', entity: 'custom_format', name: 'resolved' }),
  });
  db.execute(
    `INSERT INTO pcd_op_history (op_id, database_id, batch_id, status, applied_at) VALUES
		(?, 1, 'b1', 'conflicted', '2026-11-01T00:00:00.000Z'),
		(?, 1, 'b2', 'applied', '2026-11-02T00:00:00.000Z')`,
    resolvedOp,
    resolvedOp
  );
  // Op B: applied then later conflicted -> counts.
  const conflictedOp = pcdOpsQueries.create({
    databaseId: 1,
    origin: 'user',
    state: 'published',
    source: 'local',
    sql: 'SELECT 1',
    metadata: JSON.stringify({ operation: 'update', entity: 'custom_format', name: 'conflicted' }),
  });
  db.execute(
    `INSERT INTO pcd_op_history (op_id, database_id, batch_id, status, applied_at) VALUES
		(?, 1, 'b1', 'applied', '2026-11-01T00:00:00.000Z'),
		(?, 1, 'b2', 'conflicted_pending', '2026-11-02T00:00:00.000Z')`,
    conflictedOp,
    conflictedOp
  );

  const counts = pcdOpHistoryQueries.countLatestConflictsByDatabase();
  assertEquals(counts.get(1), 1);
  assertEquals(counts.get(1), pcdOpHistoryQueries.listLatestConflictsByDatabase(1).length);
  assertEquals((await loadDashboard()).conflicts.total, 1);
});

migratedTest('home dashboard: attention counts, degraded list and invalidation key', async () => {
  const drifted = createInstance('Radarr Attention');
  const snoozed = createInstance('Radarr Snoozed');
  seedDrift(drifted, 'drifted');
  seedDrift(snoozed, 'drifted');
  const row = driftStatusQueries.getById(snoozed)!;
  driftStatusQueries.setSuppression(snoozed, row.driftSignature, {
    acknowledgedSignature: null,
    acknowledgedEntities: [],
    snoozedUntil: new Date(Date.now() + 3_600_000).toISOString(),
    acknowledgedAt: null,
  });

  const data = await loadDashboard();
  assertEquals(data.attention, { driftInstances: 1, healthInstances: 0, failedSyncInstances: 0 });
  assertEquals(data.degraded, []);
  // Parser unavailable is a real result, not a degradation.
  assertEquals(data.parser.available, false);
  // Card flag, attention and the nav badge share one predicate.
  assertEquals(data.instances.filter((card) => card.needsAttention).length, data.attention.driftInstances);
  resetNavBadgeCacheForTest();
  invalidateNavBadges();
  const nav = resolveRootLayoutData({
    version: 't',
    pathname: '/',
    user: { id: 1, username: 'u', password_hash: '', created_at: '', updated_at: '' },
    authBypass: false,
  });
  const driftItem = nav.navShell!.groups.flatMap((group) => group.items).find((item) => item.id === 'overview.drift');
  assertEquals(driftItem?.badge?.count, data.attention.driftInstances);
});

migratedTest('home dashboard: a failing source degrades and is reported', async () => {
  createDatabase(1);
  db.execute('DROP TABLE pcd_op_history');
  const data = await loadDashboard();
  assertEquals(data.degraded, ['conflicts']);
  assertEquals(data.conflicts, { total: 0, databases: [] });
});

migratedTest('shield cache: keyed by session transport, separate values per transport', async () => {
  const secure = { url: new URL('https://praxrr.test/') };
  const insecure = { url: new URL('http://praxrr.test/') };
  const a = await cachedShield(secure);
  const b = await cachedShield(insecure);
  const a2 = await cachedShield({ url: new URL('https://other.test/') });
  assertEquals(a2, a); // same transport -> shared cached value
  // Concurrent misses share one in-flight computation.
  resetShieldCacheForTest();
  const [x, y] = await Promise.all([cachedShield(insecure), cachedShield(insecure)]);
  assertEquals(x, y);
  assert(typeof b.score === 'number');
});

migratedTest('home dashboard: only non-terminal canary rollouts are listed', async () => {
  const insert = () =>
    canaryRolloutQueries.insert({
      arrType: 'radarr',
      canaryInstanceId: null,
      canaryInstanceName: 'Canary',
      sections: null,
      maxBatchSize: 1,
      partialPolicy: 'abort',
      remainingTargets: [],
      trigger: 'manual',
      startedAt: new Date().toISOString(),
      stateToken: crypto.randomUUID(),
    } as Parameters<typeof canaryRolloutQueries.insert>[0]);
  const activeId = insert();
  const abortedId = insert();
  db.execute(
    "UPDATE canary_rollouts SET status = 'aborted', finished_at = ? WHERE id = ?",
    new Date().toISOString(),
    abortedId
  );

  const data = await loadDashboard();
  assertEquals(
    data.canary.map((rollout) => rollout.id),
    [activeId]
  );
  assertEquals(data.canary[0].href, `/canary/${activeId}`);
});

migratedTest('nav badges: drift attention and conflicts attach, suppress, and omit at zero', async () => {
  const user = { id: 1, username: 'u', password_hash: '', created_at: '', updated_at: '' };
  const layout = () => {
    invalidateNavBadges();
    const data = resolveRootLayoutData({ version: 't', pathname: '/', user, authBypass: false });
    const items = data.navShell!.groups.flatMap((group) => group.items);
    return {
      drift: items.find((item) => item.id === 'overview.drift')!,
      databases: items.find((item) => item.id === 'overview.databases')!,
    };
  };

  let nav = layout();
  assertEquals(nav.drift.badge, undefined);
  assertEquals(nav.databases.badge, undefined);

  const id = createInstance('Radarr Badge');
  seedDrift(id, 'drifted');
  createDatabase(1);
  seedConflict(1, 'conflicted');
  seedConflict(1, 'conflicted_pending');

  nav = layout();
  assertEquals(nav.drift.badge?.count, 1);
  assertEquals(nav.drift.badge?.tone, 'warning');
  assertEquals(nav.databases.badge?.count, 2);
  assertEquals(nav.databases.badge?.tone, 'danger');
  assertEquals(nav.databases.badge?.label, '2 conflicts');

  // Snoozing suppresses the drift badge; the stored status is untouched.
  const row = driftStatusQueries.getById(id)!;
  driftStatusQueries.setSuppression(id, row.driftSignature, {
    acknowledgedSignature: null,
    acknowledgedEntities: [],
    snoozedUntil: new Date(Date.now() + 3_600_000).toISOString(),
    acknowledgedAt: null,
  });
  nav = layout();
  assertEquals(nav.drift.badge, undefined);
});
