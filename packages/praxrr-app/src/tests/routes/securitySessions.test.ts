// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals, assertFalse, assertNotEquals } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { usersQueries, type User } from '$db/queries/users.ts';
import { sessionsQueries, type Session } from '$db/queries/sessions.ts';
import { hashPassword, verifyPassword } from '$auth/password.ts';
import { actions, load } from '../../routes/settings/security/+page.server.ts';

type ActionFailure = { status: number; data?: { sessionError?: string; passwordError?: string } };

/** Real scratch SQLite DB per test with the full migration chain (includes sessions.public_id). */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/security-sessions-route-${crypto.randomUUID()}`;
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

interface Fixture {
  a: User;
  b: User;
  c: User;
  sessions: {
    aCurrent: string;
    aOther: string;
    aExpired: string;
    b: string;
    c: string;
  };
  publicIds: {
    aCurrent: string;
    aOther: string;
    b: string;
    c: string;
  };
}

async function seed(): Promise<Fixture> {
  const a = usersQueries.getById(usersQueries.create('alice', await hashPassword('alice-pass-1')))!;
  const b = usersQueries.getById(usersQueries.create('bob', await hashPassword('bob-pass-123')))!;
  const c = usersQueries.getById(usersQueries.create('oidc:carol', 'OIDC_NO_PASSWORD'))!;

  const aCurrent = sessionsQueries.create(a.id, 1, { ipAddress: '10.0.0.1', browser: 'Firefox', os: 'Linux' });
  const aOther = sessionsQueries.create(a.id, 1, { ipAddress: '10.0.0.2', browser: 'Chrome', os: 'Windows' });
  const aExpired = sessionsQueries.create(a.id, 1);
  db.execute(
    'UPDATE sessions SET expires_at = ? WHERE id = ?',
    new Date(Date.now() - 3600_000).toISOString(),
    aExpired
  );
  const bSession = sessionsQueries.create(b.id, 1);
  const cSession = sessionsQueries.create(c.id, 1);

  const publicIdOf = (id: string) =>
    db.queryFirst<{ public_id: string }>('SELECT public_id FROM sessions WHERE id = ?', id)!.public_id;

  return {
    a,
    b,
    c,
    sessions: { aCurrent, aOther, aExpired, b: bSession, c: cSession },
    publicIds: {
      aCurrent: publicIdOf(aCurrent),
      aOther: publicIdOf(aOther),
      b: publicIdOf(bSession),
      c: publicIdOf(cSession),
    },
  };
}

function localsOf(
  user: User | null,
  sessionId: string | null,
  userIdOverride?: number,
  authBypass = false
): App.Locals {
  const session = sessionId ? ({ id: sessionId, user_id: userIdOverride ?? user?.id ?? 0 } as Session) : null;
  return { user, session, authBypass };
}

async function loadPayload(locals: App.Locals) {
  const headers: Record<string, string> = {};
  const payload = (await load({
    locals,
    setHeaders: (h: Record<string, string>) => Object.assign(headers, h),
  } as unknown as Parameters<typeof load>[0])) as Record<string, unknown>;
  return { payload, headers };
}

function sessionIdSet(): string[] {
  return db.query<{ id: string }>('SELECT id FROM sessions ORDER BY id').map((r) => r.id);
}

function formEvent(locals: App.Locals, form: (fd: FormData) => void) {
  const fd = new FormData();
  form(fd);
  return {
    request: new Request('http://localhost/settings/security', { method: 'POST', body: fd }),
    locals,
  } as unknown as Parameters<typeof actions.revokeSession>[0];
}

function noFormEvent(locals: App.Locals) {
  return { locals } as unknown as Parameters<typeof actions.revokeOtherSessions>[0];
}

const SUMMARY_KEYS = [
  'browser',
  'created_at',
  'device_type',
  'expires_at',
  'ip_address',
  'isCurrent',
  'last_active_at',
  'os',
  'public_id',
];

migratedTest('load: own unexpired rows only, exact keys, no bearer, flags and no-store header', async () => {
  const fx = await seed();
  const allBearers = Object.values(fx.sessions);
  // user -> current bearer, expected public_ids of own unexpired rows, current row's public_id
  const matrix: Array<[User, string, string[], string]> = [
    [fx.a, fx.sessions.aCurrent, [fx.publicIds.aCurrent, fx.publicIds.aOther], fx.publicIds.aCurrent],
    [fx.b, fx.sessions.b, [fx.publicIds.b], fx.publicIds.b],
    [fx.c, fx.sessions.c, [fx.publicIds.c], fx.publicIds.c],
  ];

  for (const [user, sessionId, expectedPublicIds, currentPublicId] of matrix) {
    const passwordEnabled = !user.username.startsWith('oidc:');
    const { payload, headers } = await loadPayload(localsOf(user, sessionId));

    assertEquals(headers['cache-control'], 'no-store');
    assertEquals(payload.canManageSessions, true);
    assertEquals(payload.passwordEnabled, passwordEnabled);
    assertFalse('currentSessionId' in payload);

    const sessions = payload.sessions as Array<Record<string, unknown>>;
    assertEquals(sessions.map((s) => s.public_id).sort(), [...expectedPublicIds].sort());
    for (const s of sessions) {
      assertEquals(Object.keys(s).sort(), SUMMARY_KEYS);
    }
    const current = sessions.filter((s) => s.isCurrent);
    assertEquals(current.length, 1);
    assertEquals(current[0].public_id, currentPublicId);

    const serialized = JSON.stringify(payload);
    for (const bearer of allBearers) {
      assertFalse(serialized.includes(bearer), `payload leaks bearer ${bearer}`);
    }
  }
});

migratedTest('load: denied principals get empty sessions and canManageSessions=false', async () => {
  const fx = await seed();

  const denied: App.Locals[] = [
    localsOf(null, null), // anonymous
    localsOf(fx.a, fx.sessions.aCurrent, undefined, true), // auth bypass
    localsOf({ id: 0, username: 'api' } as User, null), // API-key principal
    localsOf(fx.a, fx.sessions.aCurrent, fx.a.id + 1), // user/session mismatch
    localsOf(fx.a, fx.sessions.aExpired), // expired session
  ];

  sessionsQueries.deleteById(fx.sessions.b);
  denied.push(localsOf(fx.b, fx.sessions.b)); // deleted current row

  for (const locals of denied) {
    const { payload } = await loadPayload(locals);
    assertEquals(payload.sessions, []);
    assertEquals(payload.canManageSessions, false);
  }
});

migratedTest('revoke: foreign/unknown/current uniform 404, malformed 400, own other succeeds', async () => {
  const fx = await seed();
  const locals = localsOf(fx.a, fx.sessions.aCurrent);
  const snapshot = sessionIdSet();

  const expect404 = async (localsFor: App.Locals, fd: (f: FormData) => void) => {
    const result = (await actions.revokeSession(formEvent(localsFor, fd))) as ActionFailure;
    assertEquals(result.status, 404);
    assertEquals(result.data?.sessionError, 'Session not found or cannot be revoked');
  };

  await expect404(locals, (f) => f.set('public_id', fx.publicIds.b)); // foreign owner
  await expect404(locals, (f) => f.set('public_id', crypto.randomUUID())); // unknown
  await expect404(locals, (f) => f.set('public_id', fx.publicIds.aCurrent)); // current session

  const expect400 = async (fd: (f: FormData) => void) => {
    const result = (await actions.revokeSession(formEvent(locals, fd))) as ActionFailure;
    assertEquals(result.status, 400);
    assertEquals(result.data?.sessionError, 'Session ID required');
  };

  await expect400(() => {}); // missing
  await expect400((f) => f.set('sessionId', fx.sessions.aOther)); // legacy field / raw bearer
  await expect400((f) => f.set('public_id', 'not-a-uuid')); // non-UUID
  await expect400((f) => {
    f.set('public_id', fx.publicIds.aOther);
    f.append('public_id', fx.publicIds.aOther);
  }); // duplicate
  await expect400((f) => f.set('public_id', new File(['x'], 'f.bin'))); // File value

  assertEquals(sessionIdSet(), snapshot);

  // Unauthorized principals -> 401
  for (const deniedLocals of [localsOf(null, null), localsOf({ id: 0, username: 'api' } as User, null)]) {
    const result = (await actions.revokeSession(
      formEvent(deniedLocals, (f) => f.set('public_id', fx.publicIds.aOther))
    )) as ActionFailure;
    assertEquals(result.status, 401);
  }

  // Stale principal: current session deleted -> 401
  sessionsQueries.deleteById(fx.sessions.c);
  const staleResult = (await actions.revokeSession(
    formEvent(localsOf(fx.c, fx.sessions.c), (f) => f.set('public_id', fx.publicIds.aOther))
  )) as ActionFailure;
  assertEquals(staleResult.status, 401);

  assertEquals(
    sessionIdSet(),
    snapshot.filter((id) => id !== fx.sessions.c)
  );

  // Own other succeeds; only that row deleted
  const ok = (await actions.revokeSession(formEvent(locals, (f) => f.set('public_id', fx.publicIds.aOther)))) as {
    sessionRevoked: boolean;
  };
  assertEquals(ok.sessionRevoked, true);
  assertEquals(
    sessionIdSet(),
    snapshot.filter((id) => id !== fx.sessions.c && id !== fx.sessions.aOther)
  );
});

migratedTest('revokeOtherSessions: own others gone, current and other users untouched', async () => {
  const fx = await seed();

  for (const deniedLocals of [localsOf(null, null), localsOf({ id: 0, username: 'api' } as User, null)]) {
    const result = (await actions.revokeOtherSessions(noFormEvent(deniedLocals))) as ActionFailure;
    assertEquals(result.status, 401);
  }

  const result = (await actions.revokeOtherSessions(noFormEvent(localsOf(fx.a, fx.sessions.aCurrent)))) as {
    sessionsRevoked: number;
  };
  assertEquals(result.sessionsRevoked, 2); // aOther + aExpired
  assertEquals(sessionIdSet().sort(), [fx.sessions.aCurrent, fx.sessions.b, fx.sessions.c].sort());
});

migratedTest('changePassword: principal-only update, OIDC 403, denied 401, other users unaffected', async () => {
  const fx = await seed();
  const before = {
    a: usersQueries.getById(fx.a.id)!.password_hash,
    b: usersQueries.getById(fx.b.id)!.password_hash,
    c: usersQueries.getById(fx.c.id)!.password_hash,
  };

  const passwordForm = (current: string, next: string, confirm: string) => (f: FormData) => {
    f.set('currentPassword', current);
    f.set('newPassword', next);
    f.set('confirmPassword', confirm);
  };

  // A changes A's hash via locals principal (no cookie read)
  const ok = (await actions.changePassword(
    formEvent(localsOf(fx.a, fx.sessions.aCurrent), passwordForm('alice-pass-1', 'alice-new-pass', 'alice-new-pass'))
  )) as { passwordSuccess: boolean };
  assertEquals(ok.passwordSuccess, true);
  const afterA = usersQueries.getById(fx.a.id)!.password_hash;
  assertNotEquals(afterA, before.a);
  assert(await verifyPassword('alice-new-pass', afterA));
  assertEquals(usersQueries.getById(fx.b.id)!.password_hash, before.b);
  assertEquals(usersQueries.getById(fx.c.id)!.password_hash, before.c);

  // Existing validation preserved (wrong current password)
  const wrong = (await actions.changePassword(
    formEvent(localsOf(fx.b, fx.sessions.b), passwordForm('wrong-pass', 'bob-new-pass', 'bob-new-pass'))
  )) as ActionFailure;
  assertEquals(wrong.status, 400);
  assertEquals(wrong.data?.passwordError, 'Current password is incorrect');

  // File value handled safely
  const fileValue = (await actions.changePassword(
    formEvent(localsOf(fx.b, fx.sessions.b), (f) => f.set('currentPassword', new File(['x'], 'f.bin')))
  )) as ActionFailure;
  assertEquals(fileValue.status, 400);
  assertEquals(fileValue.data?.passwordError, 'All fields are required');
  assertEquals(usersQueries.getById(fx.b.id)!.password_hash, before.b);

  // OIDC -> 403
  const oidc = (await actions.changePassword(
    formEvent(localsOf(fx.c, fx.sessions.c), passwordForm('any', 'oidc-new-pass', 'oidc-new-pass'))
  )) as ActionFailure;
  assertEquals(oidc.status, 403);
  assertEquals(usersQueries.getById(fx.c.id)!.password_hash, before.c);

  // Denied principals -> 401, no hash changes
  for (const deniedLocals of [
    localsOf(null, null),
    localsOf({ id: 0, username: 'api' } as User, null),
    localsOf(fx.b, fx.sessions.b, fx.b.id + 1),
  ]) {
    const result = (await actions.changePassword(
      formEvent(deniedLocals, passwordForm('bob-pass-123', 'hacked-pass', 'hacked-pass'))
    )) as ActionFailure;
    assertEquals(result.status, 401);
  }
  assertEquals(usersQueries.getById(fx.b.id)!.password_hash, before.b);
});
