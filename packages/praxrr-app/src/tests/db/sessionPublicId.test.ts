import { assert, assertEquals, assertNotEquals, assertThrows } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { loadMigrations, runMigrations } from '$db/migrations.ts';
import { sessionsQueries } from '$db/queries/sessions.ts';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TARGET_VERSION = 20261006;

/** Real scratch SQLite DB per test; `legacy` stops migrations before the public_id migration. */
function dbTest(name: string, fn: () => Promise<void> | void, opts: { legacy?: boolean } = {}): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/session-public-id-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);

      try {
        await db.initialize();
        await runMigrations(opts.legacy ? loadMigrations().filter((m) => m.version < TARGET_VERSION) : undefined);
        await fn();
      } finally {
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

function insertUser(username: string): number {
  db.execute('INSERT INTO users (username, password_hash) VALUES (?, ?)', username, 'x');
  return db.queryFirst<{ id: number }>('SELECT id FROM users WHERE username = ?', username)!.id;
}

function sessionIds(): string[] {
  return db.query<{ id: string }>('SELECT id FROM sessions ORDER BY id').map((r) => r.id);
}

type LegacyRow = {
  id: string;
  user_id: number;
  expires_at: string;
  created_at: string;
  ip_address: string | null;
  user_agent: string | null;
  browser: string | null;
  os: string | null;
  device_type: string | null;
  last_active_at: string | null;
};

dbTest(
  'upgrade: legacy sessions backfilled with distinct UUID-v4 public_id, bearer still valid',
  async () => {
    const userId = insertUser('legacy-user');
    const future = new Date(Date.now() + 3600_000).toISOString();
    const past = new Date(Date.now() - 3600_000).toISOString();
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const expiries = [future, future, past];
    ids.forEach((id, i) =>
      db.execute(
        `INSERT INTO sessions (id, user_id, expires_at, ip_address, user_agent, browser, os, device_type, last_active_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        id,
        userId,
        expiries[i],
        `10.0.0.${i}`,
        `UA ${i}`,
        `Browser ${i}`,
        `OS ${i}`,
        'Desktop'
      )
    );
    const before = db.query<LegacyRow>('SELECT * FROM sessions ORDER BY id');
    assertEquals(before.length, 3);

    await runMigrations();

    const after = db.query<LegacyRow & { public_id: string | null }>('SELECT * FROM sessions ORDER BY id');
    assertEquals(after.length, 3);
    const seen = new Set<string>();
    after.forEach((row, i) => {
      const { public_id: publicId, ...rest } = row;
      assertEquals(rest, before[i]);
      assert(publicId !== null && UUID_V4.test(publicId), `public_id not UUID-v4: ${publicId}`);
      assertNotEquals(publicId, row.id);
      seen.add(publicId);
    });
    assertEquals(seen.size, 3);

    assertEquals(sessionsQueries.getValidById(ids[0])?.id, ids[0]);
    const applied = db.query<{ version: number }>('SELECT version FROM migrations WHERE version = ?', TARGET_VERSION);
    assertEquals(applied.length, 1);
  },
  { legacy: true }
);

dbTest('fresh DB: unique idx_sessions_public_id exists and rejects duplicates', () => {
  const indexes = db.query<{ name: string; unique: number }>('PRAGMA index_list(sessions)');
  const idx = indexes.find((i) => i.name === 'idx_sessions_public_id');
  assert(idx, 'idx_sessions_public_id missing');
  assertEquals(idx.unique, 1);

  const userId = insertUser('fresh-user');
  sessionsQueries.create(userId, 1);
  sessionsQueries.create(userId, 1);
  const first = db.queryFirst<{ public_id: string }>('SELECT public_id FROM sessions LIMIT 1')!.public_id;
  assertThrows(() => db.execute('UPDATE sessions SET public_id = ?', first));
});

dbTest('create: returns stored bearer, independent UUID-v4 public_id that cannot authenticate', () => {
  const userId = insertUser('mint-user');
  const bearer = sessionsQueries.create(userId, 1);
  const row = db.queryFirst<{ id: string; public_id: string }>('SELECT id, public_id FROM sessions')!;
  assertEquals(row.id, bearer);
  assertNotEquals(row.public_id, bearer);
  assert(UUID_V4.test(row.public_id));
  assertEquals(sessionsQueries.getValidById(row.public_id), undefined);
});

dbTest('listSummariesByUserId: own unexpired rows only, exact keys, correct isCurrent', () => {
  const userA = insertUser('list-a');
  const userB = insertUser('list-b');
  const a1 = sessionsQueries.create(userA, 1, { ipAddress: '1.1.1.1', browser: 'Firefox' });
  const a2 = sessionsQueries.create(userA, 1);
  const expired = sessionsQueries.create(userA, 1);
  db.execute('UPDATE sessions SET expires_at = ? WHERE id = ?', new Date(Date.now() - 3600_000).toISOString(), expired);
  sessionsQueries.create(userB, 1);

  const list = sessionsQueries.listSummariesByUserId(userA, a1);
  assertEquals(list.length, 2);
  const publicIds = list.map((s) => s.public_id).sort();
  assertEquals(
    publicIds,
    db
      .query<{ public_id: string }>('SELECT public_id FROM sessions WHERE id IN (?, ?)', a1, a2)
      .map((r) => r.public_id)
      .sort()
  );
  for (const s of list) {
    assertEquals(Object.keys(s).sort(), [
      'browser',
      'created_at',
      'device_type',
      'expires_at',
      'ip_address',
      'isCurrent',
      'last_active_at',
      'os',
      'public_id',
    ]);
  }
  const currentPublicId = db.queryFirst<{ public_id: string }>(
    'SELECT public_id FROM sessions WHERE id = ?',
    a1
  )!.public_id;
  assertEquals(
    list.filter((s) => s.isCurrent).map((s) => s.public_id),
    [currentPublicId]
  );
});

dbTest('deleteOtherByPublicId: foreign/unknown/current untouched, own other deleted', () => {
  const userA = insertUser('del-a');
  const userB = insertUser('del-b');
  const current = sessionsQueries.create(userA, 1);
  const other = sessionsQueries.create(userA, 1);
  sessionsQueries.create(userB, 1);
  const publicOf = (id: string) =>
    db.queryFirst<{ public_id: string }>('SELECT public_id FROM sessions WHERE id = ?', id)!.public_id;
  const foreignPublic = db.queryFirst<{ public_id: string }>(
    'SELECT public_id FROM sessions WHERE user_id = ?',
    userB
  )!.public_id;
  const snapshot = sessionIds();

  assertEquals(sessionsQueries.deleteOtherByPublicId(userA, foreignPublic, current), false);
  assertEquals(sessionsQueries.deleteOtherByPublicId(userA, crypto.randomUUID(), current), false);
  assertEquals(sessionsQueries.deleteOtherByPublicId(userA, publicOf(current), current), false);
  assertEquals(sessionIds(), snapshot);

  assertEquals(sessionsQueries.deleteOtherByPublicId(userA, publicOf(other), current), true);
  assertEquals(
    sessionIds(),
    snapshot.filter((id) => id !== other)
  );
});
