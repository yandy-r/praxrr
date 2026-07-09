import { assert, assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { timelineFeedQueries } from '$db/queries/timelineFeed.ts';
import { timelineAnnotationQueries } from '$db/queries/timelineAnnotations.ts';
import type { TimelineFilters } from '$server/timeline/types.ts';

/**
 * Point the db singleton at a scratch SQLite file, run the full migration chain (so every source
 * table plus timeline_annotations exists in its real context), invoke the body, then tear down.
 * Mirrors syncHistoryQueries.test.ts.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/timeline-queries-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);

      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

type Bind = string | number | null;

function insertReturningId(sql: string, ...params: Bind[]): number {
  db.execute(sql, ...params);
  const row = db.queryFirst<{ id: number }>('SELECT last_insert_rowid() AS id');
  assertExists(row);
  return row.id;
}

function seedInstance(type: 'radarr' | 'sonarr' | 'lidarr' = 'radarr'): number {
  return arrInstancesQueries.create({
    name: `${type}-${crypto.randomUUID()}`,
    type,
    url: 'http://127.0.0.1:9',
    apiKey: 'test-api-key',
  });
}

function seedDatabase(name = `db-${crypto.randomUUID()}`): number {
  return databaseInstancesQueries.create({
    uuid: crypto.randomUUID(),
    name,
    repositoryUrl: '',
    localPath: `/tmp/praxrr-timeline-${crypto.randomUUID()}`,
  });
}

function seedSync(opts: {
  arrInstanceId: number | null;
  instanceName: string;
  arrType?: 'radarr' | 'sonarr' | 'lidarr';
  status?: 'success' | 'partial' | 'failed' | 'skipped';
  startedAt: string;
}): number {
  return insertReturningId(
    `INSERT INTO sync_history
       (arr_instance_id, instance_name, arr_type, trigger, status,
        sections_run, items_synced, failure_count, entity_change_count,
        started_at, finished_at, duration_ms)
     VALUES (?, ?, ?, 'manual', ?, 1, 3, 0, 2, ?, ?, 5000)`,
    opts.arrInstanceId,
    opts.instanceName,
    opts.arrType ?? 'radarr',
    opts.status ?? 'success',
    opts.startedAt,
    opts.startedAt
  );
}

function seedCanary(opts: {
  canaryInstanceId: number | null;
  canaryInstanceName: string;
  arrType?: 'radarr' | 'sonarr' | 'lidarr';
  status?: 'canary_running' | 'awaiting_confirmation' | 'rolling_out' | 'completed' | 'aborted' | 'failed';
  startedAt: string;
}): number {
  return insertReturningId(
    `INSERT INTO canary_rollouts
       (arr_type, status, canary_instance_id, canary_instance_name, canary_status,
        sections, max_batch_size, partial_policy, remaining_targets, batch_cursor,
        rollout_results, trigger, started_at, finished_at, state_token)
     VALUES (?, ?, ?, ?, 'success', '["qualityProfiles"]', 1, 'gate', '[]', 0, '[]', 'manual', ?, ?, ?)`,
    opts.arrType ?? 'radarr',
    opts.status ?? 'completed',
    opts.canaryInstanceId,
    opts.canaryInstanceName,
    opts.startedAt,
    opts.startedAt,
    `tok-${crypto.randomUUID()}`
  );
}

function seedSnapshot(opts: { databaseId: number; createdAt: string }): number {
  return insertReturningId(
    `INSERT INTO pcd_snapshots
       (database_id, type, "trigger", description, ops_sequence_max_id,
        ops_count_base, ops_count_user, cache_state_hash, created_at)
     VALUES (?, 'manual', 'manual', 'nightly', 42, 10, 2, 'statehash', ?)`,
    opts.databaseId,
    opts.createdAt
  );
}

function seedRollback(opts: { databaseId: number; status?: 'success' | 'failed'; createdAt: string }): number {
  return insertReturningId(
    `INSERT INTO pcd_rollbacks
       (database_id, snapshot_id, pre_rollback_snapshot_id, target_state_hash,
        ops_undone, ops_reactivated, status, error, created_at)
     VALUES (?, NULL, NULL, 'hash-abc', 3, 1, ?, NULL, ?)`,
    opts.databaseId,
    opts.status ?? 'success',
    opts.createdAt
  );
}

const ALL = (filters: TimelineFilters = {}) => timelineFeedQueries.search(filters, { limit: 100, offset: 0 });

// ---------------------------------------------------------------------------

migratedTest('timeline_annotations schema: columns, CHECKs, and index exist', () => {
  const cols = db.query<{ name: string; notnull: number }>('PRAGMA table_info(timeline_annotations)');
  const names = cols.map((c) => c.name).sort();
  assertEquals(names, [
    'author_name',
    'author_user_id',
    'body',
    'created_at',
    'event_id',
    'event_source',
    'id',
    'updated_at',
  ]);
  const ddl = db.queryFirst<{ sql: string }>(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'timeline_annotations'`
  );
  assertExists(ddl);
  assert(ddl.sql.includes("event_source IN ('sync', 'snapshot', 'rollback', 'canary')"));
  assert(ddl.sql.includes('LENGTH(TRIM(body)) > 0'));
  const idx = db.queryFirst<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_timeline_annotations_event'`
  );
  assertExists(idx);
});

migratedTest('mixed ISO/space-form timestamps sort into one chronological order', () => {
  const inst = seedInstance();
  const dbId = seedDatabase();
  seedSync({ arrInstanceId: inst, instanceName: 'Radarr', startedAt: '2026-07-09T11:00:00.000Z' });
  seedCanary({ canaryInstanceId: inst, canaryInstanceName: 'Radarr', startedAt: '2026-07-09T10:00:00.000Z' });
  seedSnapshot({ databaseId: dbId, createdAt: '2026-07-09 12:00:00' });
  seedRollback({ databaseId: dbId, createdAt: '2026-07-09 13:00:00' });

  const order = ALL().map((r) => r.source);
  assertEquals(order, ['rollback', 'snapshot', 'sync', 'canary']);
});

migratedTest('same-second cross-source tie breaks by source ASC, source_id DESC; page walk never dups/skips', () => {
  const inst = seedInstance();
  const dbId = seedDatabase();
  seedSync({ arrInstanceId: inst, instanceName: 'A', startedAt: '2026-07-09T10:00:00.000Z' });
  seedSync({ arrInstanceId: inst, instanceName: 'B', startedAt: '2026-07-09T10:00:00.000Z' });
  seedCanary({ canaryInstanceId: inst, canaryInstanceName: 'C', startedAt: '2026-07-09T10:00:00.000Z' });
  seedSnapshot({ databaseId: dbId, createdAt: '2026-07-09 10:00:00' });
  seedRollback({ databaseId: dbId, createdAt: '2026-07-09 10:00:00' });

  const full = ALL().map((r) => `${r.source}:${r.source_id}`);
  assertEquals(full.length, 5);
  // canary < rollback < snapshot < sync alphabetically; within sync, higher id first
  assertEquals(full[0], 'canary:1');
  assertEquals(full[full.length - 2], 'sync:2');
  assertEquals(full[full.length - 1], 'sync:1');

  for (const pageSize of [1, 2, 3]) {
    const walked: string[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const rows = timelineFeedQueries.search({}, { limit: pageSize, offset });
      if (rows.length === 0) break;
      walked.push(...rows.map((r) => `${r.source}:${r.source_id}`));
    }
    assertEquals(walked, full, `page walk pageSize=${pageSize} must equal full order`);
    assertEquals(new Set(walked).size, 5);
  }
});

migratedTest('count == full-drain length across filter combos; sourceCounts sums to count', () => {
  const inst = seedInstance('radarr');
  const inst2 = seedInstance('sonarr');
  const dbId = seedDatabase();
  seedSync({ arrInstanceId: inst, instanceName: 'r1', arrType: 'radarr', startedAt: '2026-07-09T09:00:00.000Z' });
  seedSync({
    arrInstanceId: inst,
    instanceName: 'r2',
    arrType: 'radarr',
    status: 'failed',
    startedAt: '2026-07-09T09:01:00.000Z',
  });
  seedSync({ arrInstanceId: inst2, instanceName: 's1', arrType: 'sonarr', startedAt: '2026-07-09T09:02:00.000Z' });
  seedCanary({
    canaryInstanceId: inst,
    canaryInstanceName: 'r1',
    arrType: 'radarr',
    startedAt: '2026-07-09T09:03:00.000Z',
  });
  seedCanary({
    canaryInstanceId: inst,
    canaryInstanceName: 'r1',
    arrType: 'radarr',
    startedAt: '2026-07-09T09:04:00.000Z',
  });
  seedSnapshot({ databaseId: dbId, createdAt: '2026-07-09 09:05:00' });
  seedSnapshot({ databaseId: dbId, createdAt: '2026-07-09 09:06:00' });
  seedRollback({ databaseId: dbId, createdAt: '2026-07-09 09:07:00' });

  const combos: TimelineFilters[] = [
    {},
    { source: ['sync', 'snapshot'] },
    { status: 'success' },
    { instanceId: inst },
    { databaseId: dbId },
    { arrType: 'radarr' },
  ];
  for (const f of combos) {
    const drained: string[] = [];
    for (let offset = 0; ; offset += 2) {
      const rows = timelineFeedQueries.search(f, { limit: 2, offset });
      if (rows.length === 0) break;
      drained.push(...rows.map((r) => `${r.source}:${r.source_id}`));
    }
    const total = timelineFeedQueries.count(f);
    assertEquals(drained.length, total, `count parity for ${JSON.stringify(f)}`);
    const counts = timelineFeedQueries.sourceCounts(f);
    const sum = Object.values(counts).reduce((a, b) => a + b, 0);
    assertEquals(sum, total, `sourceCounts sum for ${JSON.stringify(f)}`);
  }
});

migratedTest('scope gating: no scope includes all four sources', () => {
  const inst = seedInstance();
  const dbId = seedDatabase();
  seedSync({ arrInstanceId: inst, instanceName: 'x', startedAt: '2026-07-09T09:00:00.000Z' });
  seedCanary({ canaryInstanceId: inst, canaryInstanceName: 'x', startedAt: '2026-07-09T09:01:00.000Z' });
  seedSnapshot({ databaseId: dbId, createdAt: '2026-07-09 09:02:00' });
  seedRollback({ databaseId: dbId, createdAt: '2026-07-09 09:03:00' });
  const sources = new Set(ALL().map((r) => r.source));
  assertEquals(sources, new Set(['sync', 'canary', 'snapshot', 'rollback']));
});

migratedTest('scope gating: instanceId includes only sync + canary', () => {
  const inst = seedInstance();
  const dbId = seedDatabase();
  seedSync({ arrInstanceId: inst, instanceName: 'x', startedAt: '2026-07-09T09:00:00.000Z' });
  seedCanary({ canaryInstanceId: inst, canaryInstanceName: 'x', startedAt: '2026-07-09T09:01:00.000Z' });
  seedSnapshot({ databaseId: dbId, createdAt: '2026-07-09 09:02:00' });
  seedRollback({ databaseId: dbId, createdAt: '2026-07-09 09:03:00' });
  const rows = ALL({ instanceId: inst });
  assert(rows.every((r) => r.source === 'sync' || r.source === 'canary'));
  assert(rows.every((r) => r.scope_kind === 'arr-instance' && r.scope_id === inst));
});

migratedTest('scope gating: databaseId includes only snapshot + rollback', () => {
  const inst = seedInstance();
  const dbId = seedDatabase();
  seedSync({ arrInstanceId: inst, instanceName: 'x', startedAt: '2026-07-09T09:00:00.000Z' });
  seedSnapshot({ databaseId: dbId, createdAt: '2026-07-09 09:02:00' });
  seedRollback({ databaseId: dbId, createdAt: '2026-07-09 09:03:00' });
  const rows = ALL({ databaseId: dbId });
  assert(rows.every((r) => r.source === 'snapshot' || r.source === 'rollback'));
  assert(rows.every((r) => r.scope_kind === 'pcd-database' && r.scope_id === dbId));
});

migratedTest('scope gating: arrType includes only sync + canary, never infers snapshot/rollback', () => {
  const inst = seedInstance('radarr');
  const dbId = seedDatabase();
  seedSync({ arrInstanceId: inst, instanceName: 'x', arrType: 'radarr', startedAt: '2026-07-09T09:00:00.000Z' });
  seedCanary({
    canaryInstanceId: inst,
    canaryInstanceName: 'x',
    arrType: 'radarr',
    startedAt: '2026-07-09T09:01:00.000Z',
  });
  seedSnapshot({ databaseId: dbId, createdAt: '2026-07-09 09:02:00' });
  seedRollback({ databaseId: dbId, createdAt: '2026-07-09 09:03:00' });
  const rows = ALL({ arrType: 'radarr' });
  assert(rows.every((r) => r.source === 'sync' || r.source === 'canary'));
});

migratedTest('source CSV intersects the gated set', () => {
  const inst = seedInstance();
  const dbId = seedDatabase();
  seedSync({ arrInstanceId: inst, instanceName: 'x', startedAt: '2026-07-09T09:00:00.000Z' });
  seedCanary({ canaryInstanceId: inst, canaryInstanceName: 'x', startedAt: '2026-07-09T09:01:00.000Z' });
  seedSnapshot({ databaseId: dbId, createdAt: '2026-07-09 09:02:00' });
  // instanceId gating -> sync+canary; ∩ source=[sync,snapshot] -> sync only
  const rows = ALL({ instanceId: inst, source: ['sync', 'snapshot'] });
  assert(rows.length >= 1);
  assert(rows.every((r) => r.source === 'sync'));
});

migratedTest('status filter normalizes canary lifecycle; applies across included branches', () => {
  const inst = seedInstance();
  const dbId = seedDatabase();
  seedSync({ arrInstanceId: inst, instanceName: 'ok', status: 'success', startedAt: '2026-07-09T09:00:00.000Z' });
  seedSync({ arrInstanceId: inst, instanceName: 'bad', status: 'failed', startedAt: '2026-07-09T09:01:00.000Z' });
  seedCanary({
    canaryInstanceId: inst,
    canaryInstanceName: 'aborted',
    status: 'aborted',
    startedAt: '2026-07-09T09:02:00.000Z',
  });
  seedRollback({ databaseId: dbId, status: 'failed', createdAt: '2026-07-09 09:03:00' });

  const failed = ALL({ status: 'failed' });
  assert(failed.every((r) => r.status === 'failed'));
  assertEquals(new Set(failed.map((r) => r.source)), new Set(['sync', 'rollback']));

  // canary aborted -> normalized 'skipped'
  const skipped = ALL({ status: 'skipped' });
  assertEquals(
    skipped.map((r) => r.source),
    ['canary']
  );
});

migratedTest('from/to bounds are inclusive across dialects', () => {
  const inst = seedInstance();
  const dbId = seedDatabase();
  seedSync({ arrInstanceId: inst, instanceName: 'early', startedAt: '2026-07-08T09:00:00.000Z' });
  seedSync({ arrInstanceId: inst, instanceName: 'mid', startedAt: '2026-07-09T09:00:00.000Z' });
  seedSnapshot({ databaseId: dbId, createdAt: '2026-07-10 09:00:00' });
  // The query module receives already-expanded ISO bounds (the route's parseDateBound turns a
  // date-only value into a full-day window). Sole in-window event is the 'mid' sync.
  const windowed = ALL({ from: '2026-07-09T00:00:00.000Z', to: '2026-07-09T23:59:59.999Z' });
  assertEquals(windowed.length, 1);
  assertEquals(windowed[0].source, 'sync');
});

migratedTest('sync_history recording disabled still lists pre-existing rows', () => {
  db.execute('UPDATE sync_history_settings SET enabled = 0 WHERE id = 1');
  const inst = seedInstance();
  seedSync({ arrInstanceId: inst, instanceName: 'x', startedAt: '2026-07-09T09:00:00.000Z' });
  assertEquals(ALL().length, 1);
});

migratedTest('deleted arr instance -> scope.id null, label retained (sync + canary)', () => {
  const inst = seedInstance();
  seedSync({ arrInstanceId: inst, instanceName: 'Radarr Main', startedAt: '2026-07-09T09:00:00.000Z' });
  seedCanary({ canaryInstanceId: inst, canaryInstanceName: 'Canary Main', startedAt: '2026-07-09T09:01:00.000Z' });
  db.execute('DELETE FROM arr_instances WHERE id = ?', inst);
  const rows = ALL();
  assert(rows.every((r) => r.scope_id === null));
  assertEquals(new Set(rows.map((r) => r.scope_label)), new Set(['Radarr Main', 'Canary Main']));
});

migratedTest('annotation orphan survives event pruning; pruneOrphans is opt-in', () => {
  const inst = seedInstance();
  const sid = seedSync({ arrInstanceId: inst, instanceName: 'x', startedAt: '2026-07-09T09:00:00.000Z' });
  const note = timelineAnnotationQueries.create({
    eventSource: 'sync',
    eventId: sid,
    body: 'checked upstream, this was intentional',
    authorUserId: null,
    authorName: null,
  });
  db.execute('DELETE FROM sync_history WHERE id = ?', sid);
  assertExists(timelineAnnotationQueries.getById(note.id));
  assertEquals(timelineAnnotationQueries.listForEvent('sync', sid).length, 1);
  const pruned = timelineAnnotationQueries.pruneOrphans();
  assert(pruned >= 1);
  assertEquals(timelineAnnotationQueries.getById(note.id), undefined);
});

migratedTest('listForEvents batches by source:id with no cross-source bleed', () => {
  const inst = seedInstance();
  const dbId = seedDatabase();
  const sid = seedSync({ arrInstanceId: inst, instanceName: 'x', startedAt: '2026-07-09T09:00:00.000Z' });
  const snapId = seedSnapshot({ databaseId: dbId, createdAt: '2026-07-09 09:01:00' });
  timelineAnnotationQueries.create({
    eventSource: 'sync',
    eventId: sid,
    body: 'sync note',
    authorUserId: null,
    authorName: null,
  });
  timelineAnnotationQueries.create({
    eventSource: 'snapshot',
    eventId: snapId,
    body: 'snap note',
    authorUserId: null,
    authorName: null,
  });
  const map = timelineAnnotationQueries.listForEvents([
    { source: 'sync', eventId: sid },
    { source: 'snapshot', eventId: snapId },
  ]);
  assertEquals(map.get(`sync:${sid}`)?.length, 1);
  assertEquals(map.get(`snapshot:${snapId}`)?.length, 1);
  assertEquals(map.get(`sync:${sid}`)?.[0].body, 'sync note');
});

migratedTest('annotation body/source CHECKs reject at the DB boundary', () => {
  const inst = seedInstance();
  const sid = seedSync({ arrInstanceId: inst, instanceName: 'x', startedAt: '2026-07-09T09:00:00.000Z' });
  let threw = false;
  try {
    db.execute(`INSERT INTO timeline_annotations (event_source, event_id, body) VALUES ('pcd_op', ?, 'x')`, sid);
  } catch {
    threw = true;
  }
  assert(threw, 'invalid event_source must be rejected');

  threw = false;
  try {
    db.execute(`INSERT INTO timeline_annotations (event_source, event_id, body) VALUES ('sync', ?, '   ')`, sid);
  } catch {
    threw = true;
  }
  assert(threw, 'whitespace-only body must be rejected');
});
