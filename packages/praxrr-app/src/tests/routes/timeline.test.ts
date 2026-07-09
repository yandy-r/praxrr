// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { timelineAnnotationQueries } from '$db/queries/timelineAnnotations.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import type { TimelineAnnotation, TimelineListResponse } from '$server/timeline/types.ts';
import { GET as GET_LIST } from '../../routes/api/v1/timeline/+server.ts';
import { GET as GET_EXPORT } from '../../routes/api/v1/timeline/export/+server.ts';
import { GET as GET_NOTES, POST as POST_NOTE } from '../../routes/api/v1/timeline/annotations/+server.ts';
import { PATCH as PATCH_NOTE, DELETE as DELETE_NOTE } from '../../routes/api/v1/timeline/annotations/[id]/+server.ts';

type ListGetEvent = Parameters<typeof GET_LIST>[0];
type ExportGetEvent = Parameters<typeof GET_EXPORT>[0];
type NotesGetEvent = Parameters<typeof GET_NOTES>[0];
type NotePostEvent = Parameters<typeof POST_NOTE>[0];
type NotePatchEvent = Parameters<typeof PATCH_NOTE>[0];
type NoteDeleteEvent = Parameters<typeof DELETE_NOTE>[0];

function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/timeline-route-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);

      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        jobDispatcher.stop();
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

interface Locals {
  user: { id: number; username: string; password_hash: string; created_at: string; updated_at: string } | null;
  session: null;
  authBypass: boolean;
}

function locals(userId: number | null, authBypass = false): Locals {
  return {
    user:
      userId === null
        ? null
        : {
            id: userId,
            username: `user-${userId}`,
            password_hash: 'hash',
            created_at: '2026-07-09T00:00:00.000Z',
            updated_at: '2026-07-09T00:00:00.000Z',
          },
    session: null,
    authBypass,
  };
}

function listEvent(query: string): ListGetEvent {
  return { url: new URL(`http://localhost/api/v1/timeline?${query}`) } as unknown as ListGetEvent;
}
function exportEvent(query: string): ExportGetEvent {
  return { url: new URL(`http://localhost/api/v1/timeline/export?${query}`) } as unknown as ExportGetEvent;
}
function notesGetEvent(query: string): NotesGetEvent {
  return { url: new URL(`http://localhost/api/v1/timeline/annotations?${query}`) } as unknown as NotesGetEvent;
}
function notePostEvent(body: unknown, userId: number | null, authBypass = false): NotePostEvent {
  return {
    request: new Request('http://localhost/api/v1/timeline/annotations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    locals: locals(userId, authBypass),
  } as unknown as NotePostEvent;
}
function notePatchEvent(id: string, body: unknown, userId: number | null, authBypass = false): NotePatchEvent {
  return {
    params: { id },
    request: new Request(`http://localhost/api/v1/timeline/annotations/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    locals: locals(userId, authBypass),
  } as unknown as NotePatchEvent;
}
function noteDeleteEvent(id: string, userId: number | null, authBypass = false): NoteDeleteEvent {
  return { params: { id }, locals: locals(userId, authBypass) } as unknown as NoteDeleteEvent;
}

// ---- seed helpers (raw db.execute) ----
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
    apiKey: 'k',
  });
}
function seedDatabase(): number {
  return databaseInstancesQueries.create({
    uuid: crypto.randomUUID(),
    name: `db-${crypto.randomUUID()}`,
    repositoryUrl: '',
    localPath: `/tmp/praxrr-timeline-${crypto.randomUUID()}`,
  });
}
function seedUser(id?: number): number {
  return insertReturningId(
    `INSERT INTO users (username, password_hash) VALUES (?, 'hash')`,
    `author-${id ?? crypto.randomUUID()}`
  );
}
function seedSync(instanceId: number, startedAt: string, name = 'Radarr'): number {
  return insertReturningId(
    `INSERT INTO sync_history (arr_instance_id, instance_name, arr_type, trigger, status, sections_run, items_synced, failure_count, entity_change_count, started_at, finished_at, duration_ms)
     VALUES (?, ?, 'radarr', 'manual', 'success', 1, 3, 0, 2, ?, ?, 100)`,
    instanceId,
    name,
    startedAt,
    startedAt
  );
}
function seedCanary(instanceId: number, startedAt: string): number {
  return insertReturningId(
    `INSERT INTO canary_rollouts (arr_type, status, canary_instance_id, canary_instance_name, canary_status, sections, max_batch_size, partial_policy, remaining_targets, batch_cursor, rollout_results, trigger, started_at, finished_at, state_token)
     VALUES ('radarr', 'completed', ?, 'Canary', 'success', '["qualityProfiles"]', 1, 'gate', '[]', 0, '[]', 'manual', ?, ?, ?)`,
    instanceId,
    startedAt,
    startedAt,
    `tok-${crypto.randomUUID()}`
  );
}
function seedSnapshot(databaseId: number, createdAt: string): number {
  return insertReturningId(
    `INSERT INTO pcd_snapshots (database_id, type, "trigger", description, ops_sequence_max_id, ops_count_base, ops_count_user, cache_state_hash, created_at)
     VALUES (?, 'manual', 'manual', 'nightly', 42, 10, 2, 'statehash', ?)`,
    databaseId,
    createdAt
  );
}
function seedRollback(databaseId: number, createdAt: string): number {
  return insertReturningId(
    `INSERT INTO pcd_rollbacks (database_id, snapshot_id, pre_rollback_snapshot_id, target_state_hash, ops_undone, ops_reactivated, status, error, created_at)
     VALUES (?, NULL, NULL, 'hash', 3, 1, 'success', NULL, ?)`,
    databaseId,
    createdAt
  );
}

async function listBody(query: string): Promise<TimelineListResponse> {
  const res = await GET_LIST(listEvent(query));
  assertEquals(res.status, 200);
  return (await res.json()) as TimelineListResponse;
}

// ---------------------------------------------------------------------------

migratedTest('GET /timeline: 200 merged envelope with scope/metrics/detailHref', async () => {
  const inst = seedInstance();
  const dbId = seedDatabase();
  seedSync(inst, '2026-07-09T09:00:00.000Z');
  seedCanary(inst, '2026-07-09T09:01:00.000Z');
  seedSnapshot(dbId, '2026-07-09 09:02:00');
  seedRollback(dbId, '2026-07-09 09:03:00');

  const body = await listBody('');
  assertEquals(body.totalRecords, 4);
  for (const key of ['items', 'page', 'pageSize', 'totalPages', 'hasNext', 'sourceCounts']) {
    assert(key in body, `envelope has ${key}`);
  }
  for (const item of body.items) {
    assertExists(item.scope);
    assertExists(item.detailHref);
    assertExists(item.metrics);
    assert(typeof item.badge === 'string');
  }
});

migratedTest('GET /timeline: sourceCounts sums to totalRecords', async () => {
  const inst = seedInstance();
  const dbId = seedDatabase();
  seedSync(inst, '2026-07-09T09:00:00.000Z');
  seedSync(inst, '2026-07-09T09:01:00.000Z');
  seedCanary(inst, '2026-07-09T09:02:00.000Z');
  seedSnapshot(dbId, '2026-07-09 09:03:00');
  const body = await listBody('');
  assertEquals(body.sourceCounts.sync, 2);
  assertEquals(body.sourceCounts.canary, 1);
  assertEquals(body.sourceCounts.snapshot, 1);
  const sum = Object.values(body.sourceCounts).reduce((a, b) => a + b, 0);
  assertEquals(sum, body.totalRecords);
});

migratedTest('GET /timeline: pagination hasNext + totalPages', async () => {
  const inst = seedInstance();
  seedSync(inst, '2026-07-09T09:00:00.000Z');
  seedSync(inst, '2026-07-09T09:01:00.000Z');
  seedSync(inst, '2026-07-09T09:02:00.000Z');
  const p1 = await listBody('pageSize=2&page=1');
  assertEquals(p1.items.length, 2);
  assertEquals(p1.totalPages, 2);
  assertEquals(p1.hasNext, true);
  const p2 = await listBody('pageSize=2&page=2');
  assertEquals(p2.items.length, 1);
  assertEquals(p2.hasNext, false);
});

migratedTest('GET /timeline?instanceId gates to sync+canary', async () => {
  const inst = seedInstance();
  const dbId = seedDatabase();
  seedSync(inst, '2026-07-09T09:00:00.000Z');
  seedCanary(inst, '2026-07-09T09:01:00.000Z');
  seedSnapshot(dbId, '2026-07-09 09:02:00');
  const body = await listBody(`instanceId=${inst}`);
  assert(body.items.every((i) => i.source === 'sync' || i.source === 'canary'));
  assert(body.items.every((i) => i.scope.kind === 'arr-instance'));
});

migratedTest('GET /timeline?databaseId gates to snapshot+rollback', async () => {
  const inst = seedInstance();
  const dbId = seedDatabase();
  seedSync(inst, '2026-07-09T09:00:00.000Z');
  seedSnapshot(dbId, '2026-07-09 09:02:00');
  seedRollback(dbId, '2026-07-09 09:03:00');
  const body = await listBody(`databaseId=${dbId}`);
  assert(body.items.every((i) => i.source === 'snapshot' || i.source === 'rollback'));
  assert(body.items.every((i) => i.scope.kind === 'pcd-database'));
});

migratedTest('GET /timeline 400 on contradictory scope combinations', async () => {
  for (const q of ['instanceId=1&databaseId=2', 'arrType=radarr&databaseId=2', 'scopeKind=pcd-database&instanceId=1']) {
    const res = await GET_LIST(listEvent(q));
    assertEquals(res.status, 400, `expected 400 for ${q}`);
    const body = (await res.json()) as { error: string };
    assert(body.error.length > 0);
  }
});

migratedTest('GET /timeline 400 on invalid params', async () => {
  assertEquals((await GET_LIST(listEvent('status=bogus'))).status, 400);
  assertEquals((await GET_LIST(listEvent('instanceId=abc'))).status, 400);
  assertEquals((await GET_LIST(listEvent('from=2026-07'))).status, 400);
});

migratedTest('GET /timeline: disabled sync_history recording still lists pre-existing rows', async () => {
  db.execute('UPDATE sync_history_settings SET enabled = 0 WHERE id = 1');
  const inst = seedInstance();
  seedSync(inst, '2026-07-09T09:00:00.000Z');
  const body = await listBody('');
  assert(body.totalRecords >= 1);
});

migratedTest('GET /timeline: deleted instance -> scope.id null, label retained', async () => {
  const inst = seedInstance();
  seedSync(inst, '2026-07-09T09:00:00.000Z', 'Radarr Main');
  db.execute('DELETE FROM arr_instances WHERE id = ?', inst);
  const body = await listBody('');
  assertEquals(body.items[0].scope.id, null);
  assertEquals(body.items[0].scope.label, 'Radarr Main');
});

migratedTest('GET /timeline/export?format=json: JSON attachment array', async () => {
  const inst = seedInstance();
  seedSync(inst, '2026-07-09T09:00:00.000Z');
  seedSync(inst, '2026-07-09T09:01:00.000Z');
  const res = await GET_EXPORT(exportEvent('format=json'));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Content-Type'), 'application/json');
  assert(res.headers.get('Content-Disposition')?.includes('attachment'));
  assert(res.headers.get('Content-Disposition')?.includes('.json'));
  const body = (await res.json()) as unknown[];
  assertEquals(body.length, 2);
});

migratedTest('GET /timeline/export?format=csv: CSV attachment, RFC-4180 escaped', async () => {
  const inst = seedInstance();
  seedSync(inst, '2026-07-09T09:00:00.000Z', 'Weird, "name"');
  const res = await GET_EXPORT(exportEvent('format=csv'));
  assertEquals(res.headers.get('Content-Type'), 'text/csv; charset=utf-8');
  assert(res.headers.get('Content-Disposition')?.includes('.csv'));
  const text = await res.text();
  assert(text.startsWith('id,source,sourceId'));
  assert(text.includes('"Weird, ""name"""') || text.includes('Weird, ""name""'));
});

migratedTest('POST /timeline/annotations: 401 unauthenticated, 201 with author, bypass -> null author', async () => {
  const inst = seedInstance();
  const sid = seedSync(inst, '2026-07-09T09:00:00.000Z');
  const uid = seedUser(7);

  const unauth = await POST_NOTE(notePostEvent({ source: 'sync', eventId: sid, body: 'x' }, null, false));
  assertEquals(unauth.status, 401);

  const authed = await POST_NOTE(notePostEvent({ source: 'sync', eventId: sid, body: 'why' }, uid));
  assertEquals(authed.status, 201);
  const created = (await authed.json()) as TimelineAnnotation;
  assertEquals(created.authorUserId, uid);
  assertEquals(created.authorName, `user-${uid}`);
  assertEquals(created.body, 'why');

  const bypass = await POST_NOTE(notePostEvent({ source: 'sync', eventId: sid, body: 'ok' }, null, true));
  assertEquals(bypass.status, 201);
  const bypassNote = (await bypass.json()) as TimelineAnnotation;
  assertEquals(bypassNote.authorUserId, null);
  assertEquals(bypassNote.authorName, null);
});

migratedTest('POST /timeline/annotations: 400 bad body/source, 404 unknown event', async () => {
  const inst = seedInstance();
  const sid = seedSync(inst, '2026-07-09T09:00:00.000Z');
  const uid = seedUser(1);
  assertEquals((await POST_NOTE(notePostEvent({ source: 'sync', eventId: sid, body: '   ' }, uid))).status, 400);
  assertEquals(
    (await POST_NOTE(notePostEvent({ source: 'sync', eventId: sid, body: 'a'.repeat(4001) }, uid))).status,
    400
  );
  assertEquals((await POST_NOTE(notePostEvent({ source: 'pcd_op', eventId: sid, body: 'x' }, uid))).status, 400);
  assertEquals((await POST_NOTE(notePostEvent({ source: 'sync', eventId: 999999, body: 'x' }, uid))).status, 404);
  // event id exists in a different source -> 404
  assertEquals((await POST_NOTE(notePostEvent({ source: 'snapshot', eventId: sid, body: 'x' }, uid))).status, 404);
});

migratedTest('GET /timeline/annotations lists the thread (oldest first)', async () => {
  const inst = seedInstance();
  const sid = seedSync(inst, '2026-07-09T09:00:00.000Z');
  timelineAnnotationQueries.create({
    eventSource: 'sync',
    eventId: sid,
    body: 'first',
    authorUserId: null,
    authorName: null,
  });
  timelineAnnotationQueries.create({
    eventSource: 'sync',
    eventId: sid,
    body: 'second',
    authorUserId: null,
    authorName: null,
  });
  const res = await GET_NOTES(notesGetEvent(`source=sync&eventId=${sid}`));
  assertEquals(res.status, 200);
  const notes = (await res.json()) as TimelineAnnotation[];
  assertEquals(notes.length, 2);
  assertEquals(notes[0].body, 'first');
});

migratedTest('PATCH /timeline/annotations: author edits, non-author 403, bypass overrides, 404 unknown', async () => {
  const inst = seedInstance();
  const sid = seedSync(inst, '2026-07-09T09:00:00.000Z');
  const author = seedUser(5);
  const note = timelineAnnotationQueries.create({
    eventSource: 'sync',
    eventId: sid,
    body: 'orig',
    authorUserId: author,
    authorName: 'user-5',
  });

  const edited = await PATCH_NOTE(notePatchEvent(String(note.id), { body: 'edited' }, author));
  assertEquals(edited.status, 200);
  assertEquals(((await edited.json()) as TimelineAnnotation).body, 'edited');

  assertEquals((await PATCH_NOTE(notePatchEvent(String(note.id), { body: 'x' }, 6))).status, 403);
  assertEquals((await PATCH_NOTE(notePatchEvent(String(note.id), { body: 'admin' }, null, true))).status, 200);
  assertEquals((await PATCH_NOTE(notePatchEvent('999999', { body: 'x' }, author))).status, 404);
  assertEquals((await PATCH_NOTE(notePatchEvent(String(note.id), { body: '   ' }, author))).status, 400);
});

migratedTest('DELETE /timeline/annotations: 403 non-author, 200 author, 404 unknown', async () => {
  const inst = seedInstance();
  const sid = seedSync(inst, '2026-07-09T09:00:00.000Z');
  const author = seedUser(5);
  const note = timelineAnnotationQueries.create({
    eventSource: 'sync',
    eventId: sid,
    body: 'orig',
    authorUserId: author,
    authorName: 'user-5',
  });

  assertEquals((await DELETE_NOTE(noteDeleteEvent(String(note.id), 6))).status, 403);
  assertEquals((await DELETE_NOTE(noteDeleteEvent(String(note.id), author))).status, 200);
  assertEquals(timelineAnnotationQueries.getById(note.id), undefined);
  assertEquals((await DELETE_NOTE(noteDeleteEvent('999999', author))).status, 404);
});

migratedTest('Annotation on a pruned event is invisible in-feed but survives via annotations GET', async () => {
  const inst = seedInstance();
  const sid = seedSync(inst, '2026-07-09T09:00:00.000Z');
  timelineAnnotationQueries.create({
    eventSource: 'sync',
    eventId: sid,
    body: 'why',
    authorUserId: null,
    authorName: null,
  });
  db.execute('DELETE FROM sync_history WHERE id = ?', sid);
  const body = await listBody('');
  assert(body.items.every((i) => !(i.source === 'sync' && i.sourceId === sid)));
  const notes = (await (await GET_NOTES(notesGetEvent(`source=sync&eventId=${sid}`))).json()) as TimelineAnnotation[];
  assertEquals(notes.length, 1);
});
