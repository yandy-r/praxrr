/**
 * Auth-mode boundaries (YAN-435): OIDC-only and password-only identities never cross modes.
 * OIDC users are `oidc:`-prefixed rows with the passwordless placeholder hash; local users
 * must not collide with that prefix, and each mode only honors its own kind of session.
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../../../app.d.ts" />
import { assert, assertEquals, assertThrows } from '@std/assert';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import type { ActionFailure, RequestEvent } from '@sveltejs/kit';
import { config, type AuthMode } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { usersQueries, isOidcUser, OIDC_PASSWORD_PLACEHOLDER } from '$db/queries/users.ts';
import { sessionsQueries } from '$db/queries/sessions.ts';
import {
  getAuthState,
  cleanupModeMismatchedSessions,
  shouldClearSessionCookie,
  type AuthState,
} from '$auth/middleware.ts';
import { clearSessionCookie, clearSessionCookieOptions } from '$auth/sessionCookie.ts';
import { hashPassword } from '$auth/password.ts';
import { GET as oidcCallbackGet } from '../../../../routes/auth/oidc/callback/+server.ts';
import { actions as loginActions } from '../../../../routes/auth/login/+page.server.ts';
import { actions as setupActions } from '../../../../routes/auth/setup/+page.server.ts';

/** Real scratch SQLite DB per test with the full migration chain. */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/auth-mode-boundaries-${crypto.randomUUID()}`;
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

/** `config.authMode` is readonly; tests swap it and always restore. */
async function withAuthMode(mode: AuthMode, fn: () => Promise<void> | void): Promise<void> {
  const original = config.authMode;
  Object.defineProperty(config, 'authMode', { value: mode, configurable: true, writable: true });
  try {
    await fn();
  } finally {
    Object.defineProperty(config, 'authMode', { value: original, configurable: true, writable: true });
  }
}

function userCount(): number {
  return db.queryFirst<{ count: number }>('SELECT COUNT(*) as count FROM users')!.count;
}

function sessionCount(): number {
  return db.queryFirst<{ count: number }>('SELECT COUNT(*) as count FROM sessions')!.count;
}

function sessionIds(): string[] {
  return db.query<{ id: string }>('SELECT id FROM sessions').map((r) => r.id);
}

/** Minimal RequestEvent with a cookie jar, a non-local client IP, and a form body. */
function eventStub(opts: {
  path: string;
  cookies?: Record<string, string>;
  form?: Record<string, string>;
  ip?: string;
}): RequestEvent {
  const url = new URL(`http://praxrr.test${opts.path}`);
  const jar: Record<string, string> = { ...(opts.cookies ?? {}) };
  const body = opts.form ? new URLSearchParams(Object.entries(opts.form)).toString() : undefined;
  const request = new Request(url, {
    method: 'POST',
    headers: body ? { 'content-type': 'application/x-www-form-urlencoded' } : {},
    body,
  });
  return {
    url,
    request,
    locals: { user: null, session: null, authBypass: false, principal: null },
    cookies: {
      get: (name: string) => jar[name],
      set: (name: string, value: string) => void (jar[name] = value),
      delete: (name: string) => void delete jar[name],
      getAll: () => Object.entries(jar).map(([name, value]) => ({ name, value })),
    },
    getClientAddress: () => opts.ip ?? '203.0.113.9',
  } as unknown as RequestEvent;
}

/** Session-cookie event plus the raw session id it carries. */
function sessionEventWithId(userId: number, ip = '203.0.113.9'): { event: RequestEvent; sessionId: string } {
  const sessionId = sessionsQueries.create(userId, 1, { ipAddress: ip, browser: 'Firefox', os: 'Linux' });
  const event = eventStub({ path: '/settings/security', cookies: { session: sessionId }, ip });
  return { event, sessionId };
}

// ---------------------------------------------------------------------------
// OIDC callback under password modes
// ---------------------------------------------------------------------------

for (const mode of ['on', 'local'] as const) {
  migratedTest(`oidc callback 404s under AUTH=${mode} before touching OIDC`, async () => {
    await withAuthMode(mode, async () => {
      const before = { users: userCount(), sessions: sessionCount() };
      const event = eventStub({
        path: '/auth/oidc/callback?state=abc123&code=some-code',
        cookies: { oidc_state: 'abc123' },
      });

      let thrown: unknown;
      try {
        await oidcCallbackGet(event);
      } catch (err) {
        thrown = err;
      }
      assert(thrown !== undefined, 'GET must throw');
      assert(isHttpError(thrown), 'must be a SvelteKit HttpError');
      assertEquals(thrown.status, 404);
      assertEquals({ users: userCount(), sessions: sessionCount() }, before);
    });
  });
}

// ---------------------------------------------------------------------------
// getAuthState mode/kind agreement
// ---------------------------------------------------------------------------

for (const mode of ['on', 'local'] as const) {
  migratedTest(`getAuthState drops an OIDC session under AUTH=${mode} (remote client)`, async () => {
    const oidcId = usersQueries.getOrCreateOidcUser('sub1');
    const { event, sessionId } = sessionEventWithId(oidcId);

    await withAuthMode(mode, () => {
      const state = getAuthState(event);
      assertEquals(state.user, null);
      assertEquals(state.principal, null);
      assertEquals(state.session, null, 'mismatched session must not be surfaced');
      assertEquals(sessionIds(), [sessionId], 'session row untouched by getAuthState');
    });
  });
}

migratedTest('getAuthState keeps a local session under AUTH=on/local (remote client)', async () => {
  const localId = usersQueries.create('admin', await hashPassword('admin-pass-123'));
  const { event, sessionId } = sessionEventWithId(localId);

  for (const mode of ['on', 'local'] as const) {
    await withAuthMode(mode, () => {
      const state = getAuthState(event);
      assertEquals(state.user?.id, localId, mode);
      assertEquals(state.principal?.kind, 'session', mode);
      assertEquals(state.session?.id, sessionId, mode);
    });
  }
});

migratedTest('getAuthState drops a local session under AUTH=oidc but keeps an OIDC session', async () => {
  const localId = usersQueries.create('admin', await hashPassword('admin-pass-123'));
  const oidcId = usersQueries.getOrCreateOidcUser('sub1');
  const local = sessionEventWithId(localId);
  const oidc = sessionEventWithId(oidcId);

  await withAuthMode('oidc', () => {
    const dropped = getAuthState(local.event);
    assertEquals(dropped.user, null);
    assertEquals(dropped.principal, null);
    assertEquals(dropped.session, null);

    const kept = getAuthState(oidc.event);
    assertEquals(kept.user?.id, oidcId);
    assertEquals(kept.principal?.kind, 'session');
    assertEquals(kept.session?.id, oidc.sessionId);
  });
});

migratedTest(
  'a legacy "OIDC:legacy" row is local: session resolves under AUTH=on, dropped under AUTH=oidc',
  async () => {
    db.execute('INSERT INTO users (username, password_hash) VALUES (?, ?)', 'OIDC:legacy', 'OIDC_NO_PASSWORD');
    const legacy = usersQueries.getByUsername('OIDC:legacy')!;
    assertEquals(isOidcUser(legacy), false, 'placeholder alone or prefix-case alone is not OIDC');
    const { event, sessionId } = sessionEventWithId(legacy.id);

    await withAuthMode('on', () => {
      const state = getAuthState(event);
      assertEquals(state.user?.id, legacy.id);
      assertEquals(state.session?.id, sessionId);
    });

    await withAuthMode('oidc', () => {
      assertEquals(getAuthState(event).user, null);
    });
  }
);

migratedTest("an 'oidc:admin' row with a real password hash counts as local", async () => {
  db.execute(
    'INSERT INTO users (username, password_hash) VALUES (?, ?)',
    'oidc:admin',
    await hashPassword('real-pass-123')
  );
  const row = usersQueries.getByUsername('oidc:admin')!;
  assertEquals(isOidcUser(row), false, 'real hash disqualifies the OIDC classification');
  assertEquals(usersQueries.existsLocal(), true);
  assertEquals(usersQueries.getAllUsernames(), ['oidc:admin']);
  const { event, sessionId } = sessionEventWithId(row.id);

  await withAuthMode('on', () => {
    const state = getAuthState(event);
    assertEquals(state.user?.id, row.id);
    assertEquals(state.session?.id, sessionId);
  });

  await withAuthMode('oidc', () => {
    assertEquals(getAuthState(event).user, null);
    assertEquals(getAuthState(event).session, null);
  });
});

// ---------------------------------------------------------------------------
// Login action
// ---------------------------------------------------------------------------

migratedTest('login action fails 403 under AUTH=oidc and creates no session', async () => {
  usersQueries.create('admin', await hashPassword('admin-pass-123'));
  const before = sessionCount();
  const event = eventStub({
    path: '/auth/login',
    form: { username: 'admin', password: 'admin-pass-123' },
  });

  await withAuthMode('oidc', async () => {
    const result = (await loginActions.default(
      event as unknown as Parameters<typeof loginActions.default>[0]
    )) as ActionFailure;
    assertEquals(result.status, 403);
  });

  assertEquals(sessionCount(), before);
});

migratedTest('login with an OIDC username under AUTH=on fails like an unknown user (400)', async () => {
  usersQueries.getOrCreateOidcUser('sub1');
  const before = sessionCount();
  let result: ActionFailure | undefined;
  await withAuthMode('on', async () => {
    result = (await loginActions.default(
      eventStub({
        path: '/auth/login',
        form: { username: 'oidc:sub1', password: 'whatever-pass' },
      }) as unknown as Parameters<typeof loginActions.default>[0]
    )) as ActionFailure;
  });
  assert(result !== undefined, 'login action must return a failure');
  assertEquals(result.status, 400);
  assertEquals(sessionCount(), before, 'no session row created');
});

// ---------------------------------------------------------------------------
// Setup action
// ---------------------------------------------------------------------------

migratedTest('setup action rejects oidc: prefixed usernames, then creates a valid account', async () => {
  await withAuthMode('on', async () => {
    for (const username of ['OIDC:admin', 'oidc:admin']) {
      const result = (await setupActions.default(
        eventStub({
          path: '/auth/setup',
          form: { username, password: 'long-enough-pass', confirmPassword: 'long-enough-pass' },
        }) as unknown as Parameters<typeof setupActions.default>[0]
      )) as ActionFailure;
      assertEquals(result.status, 400, username);
      assertEquals(userCount(), 0, username);
    }

    const created = await setupActions
      .default(
        eventStub({
          path: '/auth/setup',
          form: { username: 'admin', password: 'long-enough-pass', confirmPassword: 'long-enough-pass' },
        }) as unknown as Parameters<typeof setupActions.default>[0]
      )
      .then(
        (value) => value,
        (err: unknown) => {
          assert(isRedirect(err), 'success path must redirect');
          assertEquals(err.location, '/');
          return undefined;
        }
      );
    assertEquals(created, undefined);
    assertEquals(usersQueries.existsLocal(), true);
    assertEquals(userCount(), 1);
  });
});

migratedTest('setup action redirects to home under AUTH=oidc without creating a user', async () => {
  await withAuthMode('oidc', async () => {
    let thrown: unknown;
    try {
      await setupActions.default(
        eventStub({
          path: '/auth/setup',
          form: { username: 'admin', password: 'long-enough-pass', confirmPassword: 'long-enough-pass' },
        }) as unknown as Parameters<typeof setupActions.default>[0]
      );
    } catch (err) {
      thrown = err;
    }
    assert(isRedirect(thrown), 'setup under SSO must redirect');
    assertEquals((thrown as { location: string }).location, '/');
  });
  assertEquals(userCount(), 0);
});

// ---------------------------------------------------------------------------
// OIDC identity integrity
// ---------------------------------------------------------------------------

migratedTest('getOrCreateOidcUser refuses a username owned by a local account', async () => {
  db.execute(
    'INSERT INTO users (username, password_hash) VALUES (?, ?)',
    'oidc:taken',
    await hashPassword('local-pass-123')
  );
  assertThrows(() => usersQueries.getOrCreateOidcUser('taken'), Error, 'local account');
  // The untouched local row keeps its hash
  assertEquals(usersQueries.getByUsername('oidc:taken')!.password_hash === OIDC_PASSWORD_PLACEHOLDER, false);
});

migratedTest('usersQueries.create/updateUsername reject the reserved oidc: prefix (any case)', async () => {
  const adminId = usersQueries.create('admin', 'hash');
  for (const username of ['oidc:x', 'OIDC:x', 'Oidc:x', 'oIdC:x']) {
    assertThrows(() => usersQueries.create(username, 'hash'), Error, 'oidc:', username);
    assertThrows(() => usersQueries.updateUsername(adminId, username), Error, 'oidc:', username);
  }
});

// ---------------------------------------------------------------------------
// Startup cleanup of mode-mismatched sessions
// ---------------------------------------------------------------------------

migratedTest('cleanupModeMismatchedSessions deletes only mismatched rows per mode', async () => {
  const localId = usersQueries.create('admin', await hashPassword('admin-pass-123'));
  const oidcId = usersQueries.getOrCreateOidcUser('sub1');

  const seed = () => {
    db.execute('DELETE FROM sessions');
    return { local: sessionsQueries.create(localId, 1), oidc: sessionsQueries.create(oidcId, 1) };
  };

  // oidc keeps only OIDC-user sessions
  let s = seed();
  await withAuthMode('oidc', () => {
    assertEquals(cleanupModeMismatchedSessions(), 1);
    assertEquals(sessionIds(), [s.oidc]);
  });

  // on / local / off keep only local-user sessions (off intentionally drops OIDC sessions)
  for (const mode of ['on', 'local', 'off'] as const) {
    s = seed();
    await withAuthMode(mode, () => {
      assertEquals(cleanupModeMismatchedSessions(), 1, mode);
      assertEquals(sessionIds(), [s.local], mode);
    });
  }
});

// ---------------------------------------------------------------------------
// Stale session-cookie clearing
// ---------------------------------------------------------------------------

migratedTest('shouldClearSessionCookie: only unauthenticated non-bypass requests with a cookie', () => {
  const base = {
    needsSetup: false,
    user: null,
    session: null,
    skipAuth: false,
    principal: null,
  } satisfies AuthState;
  const sessionUser = { id: 1, username: 'a', password_hash: 'h', created_at: '', updated_at: '' };
  const liveSession = {
    id: 's',
    user_id: 1,
    expires_at: '',
    created_at: '',
    ip_address: null,
    user_agent: null,
    browser: null,
    os: null,
    device_type: null,
    last_active_at: null,
    public_id: 'p',
  };
  const cases: Array<[AuthState, boolean, boolean]> = [
    [{ ...base, skipAuth: true }, true, false], // bypass: cookie left alone
    [{ ...base, principal: { kind: 'token', tokenId: 1, scopes: [] } }, true, false], // API token: cookie left alone
    [
      {
        ...base,
        user: sessionUser,
        session: liveSession,
        principal: { kind: 'session', scopes: [] },
      },
      true,
      false,
    ], // valid session: keep
    [base, true, true], // expired/no session + cookie: stale
    [base, false, false], // no cookie at all
  ];
  for (const [state, hasCookie, expected] of cases) {
    assertEquals(shouldClearSessionCookie(state, hasCookie), expected);
  }
});

migratedTest('clearSessionCookie: secure follows transport (plain http vs https)', () => {
  const jar: Record<string, unknown> = {};
  const cookies = { delete: (name: string, opts: Record<string, unknown>) => void (jar[name] = opts) };

  clearSessionCookie({ url: new URL('http://praxrr.test/'), request: new Request('http://praxrr.test/') }, cookies);
  const httpOpts = jar.session as { secure: boolean; httpOnly: boolean; sameSite: string; path: string };
  assertEquals(httpOpts.secure, false, 'plain http non-localhost => secure:false');
  assertEquals(httpOpts.httpOnly, true);
  assertEquals(httpOpts.sameSite, 'lax');
  assertEquals(httpOpts.path, '/');

  clearSessionCookie({ url: new URL('https://praxrr.test/'), request: new Request('https://praxrr.test/') }, cookies);
  assertEquals((jar.session as { secure: boolean }).secure, true, 'https => secure:true');

  const opts = clearSessionCookieOptions({
    url: new URL('https://praxrr.test/'),
    request: new Request('https://praxrr.test/'),
  });
  assertEquals('expires' in opts, false);
  assertEquals(opts.secure, true);
});
