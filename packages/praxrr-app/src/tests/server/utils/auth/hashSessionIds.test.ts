/**
 * YAN-1264 / YAN-440 regression tests: hashed session ids + sliding-expiry cookie refresh.
 *
 * Bug A: `sessions.id` used to store the raw `session` cookie value, so a leaked DB file was a
 * leaked bearer credential. Now only sha256(cookie) is stored; the raw token authenticates via
 * `getValidByToken`/`getByToken`/`deleteByToken`.
 *
 * Bug B: `maybeExtendSession` extended the DB row but never re-set the cookie, so the browser
 * dropped the session while the DB row lived on. It now re-sets the cookie with the exact new
 * DB expiry whenever it extends.
 */
// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../../../app.d.ts" />

import { assert, assertEquals, assertFalse } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { loadMigrations, runMigrations } from '$db/migrations.ts';
import { sessionsQueries, hashSessionToken, type Session } from '$db/queries/sessions.ts';
import { invalidateLegacySessions } from '$db/migrations/20261026_hash_session_ids.ts';
import { maybeExtendSession } from '$auth/middleware.ts';
import { SESSION_COOKIE_HTTPONLY, SESSION_COOKIE_SAMESITE, sessionCookieOptions } from '$auth/sessionCookie.ts';
import { buildRevalidator } from '$lib/server/events/streamAuth.ts';
import type { RequestEvent } from '@sveltejs/kit';

const HASH_TARGET = 20261026;

/** Real scratch SQLite DB per test; `legacy` stops migrations before the hashing migration. */
function dbTest(name: string, fn: () => Promise<void> | void, opts: { legacy?: boolean } = {}): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/hash-session-ids-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);

      try {
        await db.initialize();
        await runMigrations(opts.legacy ? loadMigrations().filter((m) => m.version < HASH_TARGET) : undefined);
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

// ---------------------------------------------------------------------------
// Bug A: sessions table never contains the cookie value
// ---------------------------------------------------------------------------

dbTest('create: row id is sha256(token), token authenticates, stored hash does not', () => {
  const userId = insertUser('hash-user');
  const token = sessionsQueries.create(userId, 1);

  const row = db.queryFirst<{ id: string }>('SELECT id FROM sessions WHERE user_id = ?', userId)!;
  assert(row.id !== token, 'stored id must never equal the raw cookie value');
  assertEquals(row.id, hashSessionToken(token));
  // The stored hash is not a usable credential.
  assertEquals(sessionsQueries.getValidByToken(row.id), undefined);
  // The raw token resolves to the row that stores its hash.
  assertEquals(sessionsQueries.getValidByToken(token)?.id, row.id);
});

// ---------------------------------------------------------------------------
// Bug A migration: legacy plaintext ids are invalidated, not rehashed
// ---------------------------------------------------------------------------

function insertSessionRow(userId: number, id: string): void {
  db.execute(
    `INSERT INTO sessions (id, public_id, user_id, expires_at, last_active_at)
		 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    id,
    crypto.randomUUID(),
    userId,
    new Date(Date.now() + 3600_000).toISOString()
  );
}

dbTest('migration afterUp: deletes legacy raw ids, keeps hashed rows, rerun is a no-op', async () => {
  const userId = insertUser('legacy-user');
  const rawIds = [crypto.randomUUID(), crypto.randomUUID()];
  const hashedToken = 'tok-' + crypto.randomUUID();
  const hashed = hashSessionToken(hashedToken);
  rawIds.forEach((id) => insertSessionRow(userId, id));
  insertSessionRow(userId, hashed);

  await invalidateLegacySessions();
  await invalidateLegacySessions(); // rerun must be a no-op

  assertEquals(
    db.query<{ id: string }>('SELECT id FROM sessions').map((r) => r.id),
    [hashed]
  );
  for (const raw of rawIds) {
    assertEquals(sessionsQueries.getValidByToken(raw), undefined);
    // A rehash would have produced a still-valid credential; it must not exist.
    assertEquals(sessionsQueries.getByToken(raw), undefined);
  }
  assertEquals(sessionsQueries.getValidByToken(hashedToken)?.id, hashed);
  // Safety pragma restored to its prior value.
  assertEquals(db.queryFirst<{ secure_delete: number }>('PRAGMA secure_delete')!.secure_delete, 0);
});

dbTest(
  'migration chain: legacy raw rows are gone after the runner applies 20261026',
  async () => {
    // dbTest({legacy:true}) stopped the chain before the migration; seed raw rows, then resume.
    const userId = insertUser('chain-user');
    const rawId = crypto.randomUUID();
    insertSessionRow(userId, rawId);

    await runMigrations();

    assertEquals(db.query('SELECT id FROM sessions').length, 0);
    assertEquals(sessionsQueries.getValidByToken(rawId), undefined);
    const applied = db.query<{ version: number }>('SELECT version FROM migrations WHERE version = ?', HASH_TARGET);
    assertEquals(applied.length, 1);
  },
  { legacy: true }
);

// ---------------------------------------------------------------------------
// Bug B: maybeExtendSession refreshes the cookie when it extends
// ---------------------------------------------------------------------------

interface CookieCapture {
  jar: Map<string, { value: string; opts: Record<string, unknown> }>;
}

/** RequestEvent slice with a capturing cookie jar (matches maybeExtendSession's Pick). */
function extendEvent(
  sessionToken: string | undefined,
  origin = 'http://praxrr.test'
): CookieCapture & { event: RequestEvent } {
  const jar = new Map<string, { value: string; opts: Record<string, unknown> }>();
  const cookies = {
    get: (name: string) => (jar.has(name) ? jar.get(name)!.value : sessionToken),
    set: (name: string, value: string, opts: Record<string, unknown>) => void jar.set(name, { value, opts }),
  };
  const url = new URL(`${origin}/settings`);
  return { jar, event: { url, request: new Request(url), cookies } as unknown as RequestEvent };
}

dbTest('maybeExtendSession: past-halfway session extends row and re-sets cookie with exact expiry', async () => {
  const userId = insertUser('extend-user');
  const duration = db.queryFirst<{ h: number }>(
    'SELECT session_duration_hours AS h FROM auth_settings WHERE id = 1'
  )!.h;
  const token = sessionsQueries.create(userId, duration);
  const storedId = hashSessionToken(token);

  // Push the row past halfway (full duration minus most of it; 1h left).
  db.execute(
    'UPDATE sessions SET expires_at = ? WHERE id = ?',
    new Date(Date.now() + 3600_000).toISOString(),
    storedId
  );
  const session = sessionsQueries.getValidByToken(token)!;

  const { jar, event } = extendEvent(token, 'https://praxrr.test');
  maybeExtendSession(event, session);

  const row = db.queryFirst<{ expires_at: string }>('SELECT expires_at FROM sessions WHERE id = ?', storedId)!;
  const cookie = jar.get('session');
  assert(cookie, 'session cookie must be re-set on extension');
  assertEquals(cookie.value, token, 'cookie value must not rotate');
  assertEquals(cookie.opts.expires instanceof Date, true);
  assertEquals((cookie.opts.expires as Date).toISOString(), row.expires_at, 'cookie expiry must equal DB expiry');
  assertEquals(cookie.opts.httpOnly, SESSION_COOKIE_HTTPONLY);
  assertEquals(cookie.opts.sameSite, SESSION_COOKIE_SAMESITE);
  assertEquals(cookie.opts.path, '/');
  assertEquals(cookie.opts.secure, sessionCookieOptions(event, new Date()).secure);
  assertEquals(cookie.opts.secure, true, 'https request => Secure cookie');
});

dbTest('maybeExtendSession: fresh session does not touch the cookie', () => {
  const userId = insertUser('fresh-user');
  // Duration must match auth_settings so the fresh row sits exactly at full duration.
  const duration = db.queryFirst<{ h: number }>(
    'SELECT session_duration_hours AS h FROM auth_settings WHERE id = 1'
  )!.h;
  const token = sessionsQueries.create(userId, duration); // full duration remaining
  const session = sessionsQueries.getValidByToken(token)!;

  const { jar, event } = extendEvent(token);
  const before = db.queryFirst<{ expires_at: string }>(
    'SELECT expires_at FROM sessions WHERE id = ?',
    hashSessionToken(token)
  )!;

  maybeExtendSession(event, session);

  assertFalse(jar.has('session'), 'no cookie write when not extending');
  assertEquals(
    db.queryFirst<{ expires_at: string }>('SELECT expires_at FROM sessions WHERE id = ?', hashSessionToken(token))!
      .expires_at,
    before.expires_at,
    'DB expiry unchanged when not extending'
  );
});

// ---------------------------------------------------------------------------
// Logout deletes by token
// ---------------------------------------------------------------------------

dbTest('logout path: getByToken + deleteByToken remove the row, other sessions survive', () => {
  const userId = insertUser('logout-user');
  const mine = sessionsQueries.create(userId, 1);
  const other = sessionsQueries.create(userId, 1);

  assertEquals(sessionsQueries.getByToken(mine)?.id, hashSessionToken(mine));
  assertEquals(sessionsQueries.deleteByToken(mine), true);
  assertEquals(sessionsQueries.getByToken(mine), undefined);
  assertEquals(sessionsQueries.getValidByToken(mine), undefined);
  // The stored hash is not itself a credential: deleting with it removes nothing.
  assertEquals(sessionsQueries.deleteByToken(hashSessionToken(other)), false);
  assertEquals(sessionsQueries.getValidByToken(other)?.id, hashSessionToken(other));
});

// ---------------------------------------------------------------------------
// extendExpiration return contract
// ---------------------------------------------------------------------------

dbTest('extendExpiration returns the new expiry, null for unknown rows', () => {
  const userId = insertUser('expiry-user');
  const token = sessionsQueries.create(userId, 1);
  const storedId = hashSessionToken(token);

  const before = db.queryFirst<Session>('SELECT * FROM sessions WHERE id = ?', storedId)!;
  const newExpiry = sessionsQueries.extendExpiration(storedId, 48);
  assert(newExpiry instanceof Date);
  const after = db.queryFirst<Session>('SELECT * FROM sessions WHERE id = ?', storedId)!;
  assertEquals(after.expires_at, newExpiry!.toISOString());
  assert(new Date(after.expires_at).getTime() > new Date(before.expires_at).getTime());
  assertEquals(sessionsQueries.extendExpiration('0'.repeat(64), 48), null);
});

dbTest('maybeExtendSession: missing cookie extends nothing visible and writes no cookie', () => {
  const userId = insertUser('nocookie-user');
  const duration = db.queryFirst<{ h: number }>(
    'SELECT session_duration_hours AS h FROM auth_settings WHERE id = 1'
  )!.h;
  const token = sessionsQueries.create(userId, duration);
  db.execute(
    'UPDATE sessions SET expires_at = ? WHERE id = ?',
    new Date(Date.now() + 3600_000).toISOString(),
    hashSessionToken(token)
  );
  const session = sessionsQueries.getValidByToken(token)!;

  const { jar, event } = extendEvent(undefined);
  maybeExtendSession(event, session);

  assertFalse(jar.has('session'), 'no cookie to refresh => no cookie write');
});

// ---------------------------------------------------------------------------
// Live-stream revalidator uses the stored hash id
// ---------------------------------------------------------------------------

dbTest('buildRevalidator: true for a live stored-hash id, false once the row is deleted', () => {
  const userId = insertUser('stream-user');
  const token = sessionsQueries.create(userId, 1);
  const session = sessionsQueries.getValidByToken(token)!;
  const revalidate = buildRevalidator({
    session: { id: session.id },
    principal: { kind: 'session', scopes: [] },
  });

  assertEquals(revalidate(), true);
  assertEquals(sessionsQueries.deleteByToken(token), true);
  assertEquals(revalidate(), false);
});
