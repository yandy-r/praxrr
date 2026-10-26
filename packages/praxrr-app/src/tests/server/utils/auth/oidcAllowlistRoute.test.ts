/**
 * OIDC sign-in allowlist route tests (YAN-436): the callback only provisions users for
 * identities the operator allowlisted. Drives `oidcCallbackGet` under AUTH=oidc with a
 * stubbed IdP (discovery + token endpoints) and a decodable unsigned id_token.
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../../../app.d.ts" />
import { assert, assertEquals } from '@std/assert';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { config, type AuthMode } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { sessionsQueries } from '$db/queries/sessions.ts';
import { usersQueries } from '$db/queries/users.ts';
import { clearDiscoveryCache } from '$auth/oidc.ts';
import { parseOidcAllowlist } from '$auth/oidcAllowlist.ts';
import { GET as oidcCallbackGet } from '../../../../routes/auth/oidc/callback/+server.ts';

/** Real scratch SQLite DB per test with the full migration chain. */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/oidc-allowlist-${crypto.randomUUID()}`;
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

/** GET callback RequestEvent with matching state cookie and a non-local client IP. */
function callbackEvent(state = 'abc123', code = 'stub-code'): RequestEvent {
  const url = new URL(`http://praxrr.test/auth/oidc/callback?state=${state}&code=${code}`);
  const jar: Record<string, string> = { oidc_state: state };
  return {
    url,
    request: new Request(url, { headers: { 'user-agent': 'Deno-test' } }),
    locals: { user: null, session: null, authBypass: false, principal: null },
    cookies: {
      get: (name: string) => jar[name],
      set: (name: string, value: string) => void (jar[name] = value),
      delete: (name: string) => void delete jar[name],
      getAll: () => Object.entries(jar).map(([name, value]) => ({ name, value })),
    },
    getClientAddress: () => '203.0.113.9',
  } as unknown as RequestEvent;
}

const ISSUER = 'https://idp.test';
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;

/** Base64url-encode a JWT segment. */
function b64url(input: string): string {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Unsigned-but-decodable JWT carrying `claims` (the callback trusts the code exchange). */
function idToken(claims: Record<string, unknown>): string {
  return `${b64url('{"alg":"none","typ":"JWT"}')}.${b64url(JSON.stringify(claims))}.sig`;
}

/**
 * Stub the global fetch to serve the discovery doc + token endpoint, and swap `config.oidc`
 * (readonly via defineProperty) for well-formed client credentials plus an allowlist policy
 * parsed by the real `parseOidcAllowlist`. The discovery cache is cleared before `fn` and
 * again in `finally` so no test inherits a cached document. Restores everything in `finally`.
 */
async function withStubbedIdp(
  claims: Record<string, unknown>,
  allowlistEnv: {
    subjects?: string;
    emails?: string;
    groups?: string;
    groupsClaim?: string;
    allowAll?: string;
  },
  fn: () => Promise<void> | void
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const token = idToken({
    iss: ISSUER,
    aud: 'praxrr-client',
    exp: now + 600,
    iat: now,
    ...claims,
  });

  const discoveryDoc = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    jwks_uri: `${ISSUER}/jwks`,
  };

  const originalFetch = globalThis.fetch;
  const originalOidc = config.oidc;
  globalThis.fetch = ((input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === DISCOVERY_URL) {
      return Promise.resolve(new Response(JSON.stringify(discoveryDoc), { status: 200 }));
    }
    if (url === `${ISSUER}/token`) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'at', id_token: token, token_type: 'Bearer' }), {
          status: 200,
        })
      );
    }
    return Promise.reject(new Error(`Unexpected fetch in test: ${url}`));
  }) as typeof fetch;

  Object.defineProperty(config, 'oidc', {
    value: {
      discoveryUrl: DISCOVERY_URL,
      clientId: 'praxrr-client',
      clientSecret: 'praxrr-secret',
      allowlist: parseOidcAllowlist(allowlistEnv),
    },
    configurable: true,
    writable: true,
  });

  clearDiscoveryCache();
  try {
    await fn();
  } finally {
    clearDiscoveryCache();
    globalThis.fetch = originalFetch;
    Object.defineProperty(config, 'oidc', {
      value: originalOidc,
      configurable: true,
      writable: true,
    });
  }
}

/** Run the callback and return whatever it threw (SvelteKit routes throw redirects/errors). */
async function runCallback(): Promise<unknown> {
  try {
    await oidcCallbackGet(callbackEvent());
  } catch (err) {
    return err;
  }
  return undefined;
}

/**
 * Run the callback expecting a denial: assert the thrown 403 SvelteKit HttpError and that no
 * session cookie was set on the event (a denied identity must not be handed a session).
 */
async function runCallbackDenied(): Promise<void> {
  const event = callbackEvent();
  try {
    await oidcCallbackGet(event);
    assert(false, 'GET must throw');
  } catch (err) {
    assert(isHttpError(err), 'must be a SvelteKit HttpError');
    assertEquals(err.status, 403);
  }
  assertEquals(event.cookies.get('session'), undefined);
}

// ---------------------------------------------------------------------------
// Route-level gate
// ---------------------------------------------------------------------------

migratedTest('oidc callback refuses an identity outside the allowlist (403, no user, no session)', async () => {
  await withAuthMode('oidc', async () => {
    await withStubbedIdp(
      { sub: 'user-123', email: 'someone@example.org', email_verified: true },
      { subjects: 'admin-sub' },
      async () => {
        const before = { users: userCount(), sessions: sessionCount() };

        await runCallbackDenied();
        assertEquals({ users: userCount(), sessions: sessionCount() }, before);
      }
    );
  });
});

migratedTest('oidc callback allows an allowlisted subject (303 redirect, one user, one session)', async () => {
  await withAuthMode('oidc', async () => {
    await withStubbedIdp({ sub: 'admin-sub', email: 'someone@example.org' }, { subjects: 'admin-sub' }, async () => {
      const thrown = await runCallback();
      assert(isRedirect(thrown), 'must be a SvelteKit Redirect');
      assertEquals(thrown.status, 303);
      assertEquals(userCount(), 1);
      assertEquals(sessionCount(), 1);
    });
  });
});

migratedTest('oidc callback with no allowlist and no opt-out is fail-closed (403, no user, no session)', async () => {
  await withAuthMode('oidc', async () => {
    await withStubbedIdp({ sub: 'user-123', email: 'someone@example.org' }, {}, async () => {
      const before = { users: userCount(), sessions: sessionCount() };

      await runCallbackDenied();
      assertEquals({ users: userCount(), sessions: sessionCount() }, before);
    });
  });
});

migratedTest(
  'oidc callback allows any identity when OIDC_ALLOW_ALL_USERS is set and no lists are configured',
  async () => {
    await withAuthMode('oidc', async () => {
      await withStubbedIdp({ sub: 'user-123' }, { allowAll: 'true' }, async () => {
        const thrown = await runCallback();
        assert(isRedirect(thrown), 'must be a SvelteKit Redirect');
        assertEquals(thrown.status, 303);
        assertEquals(userCount(), 1);
        assertEquals(sessionCount(), 1);
      });
    });
  }
);

migratedTest('oidc callback allows a verified email on the allowlist (303, one user, one session)', async () => {
  await withAuthMode('oidc', async () => {
    await withStubbedIdp(
      { sub: 'user-123', email: 'Operator@Corp.example', email_verified: true },
      { emails: 'operator@corp.example' },
      async () => {
        const thrown = await runCallback();
        assert(isRedirect(thrown), 'must be a SvelteKit Redirect');
        assertEquals(thrown.status, 303);
        assertEquals(userCount(), 1);
        assertEquals(sessionCount(), 1);
      }
    );
  });
});

migratedTest('oidc callback refuses an allowlisted email that is not verified (403, no user, no session)', async () => {
  await withAuthMode('oidc', async () => {
    await withStubbedIdp(
      { sub: 'user-123', email: 'operator@corp.example', email_verified: false },
      { emails: 'operator@corp.example' },
      async () => {
        const before = { users: userCount(), sessions: sessionCount() };

        await runCallbackDenied();
        assertEquals({ users: userCount(), sessions: sessionCount() }, before);
      }
    );
  });
});

migratedTest(
  'oidc callback allows a group matched from a custom top-level claim (303, one user, one session)',
  async () => {
    await withAuthMode('oidc', async () => {
      await withStubbedIdp(
        { sub: 'user-123', roles: ['Praxrr Admins', 'viewers'] },
        { groups: 'Praxrr Admins', groupsClaim: 'roles' },
        async () => {
          const thrown = await runCallback();
          assert(isRedirect(thrown), 'must be a SvelteKit Redirect');
          assertEquals(thrown.status, 303);
          assertEquals(userCount(), 1);
          assertEquals(sessionCount(), 1);
        }
      );
    });
  }
);

migratedTest(
  'oidc callback denies when only an invalid email entry is configured even with allowAll set (403, no user, no session)',
  async () => {
    await withAuthMode('oidc', async () => {
      await withStubbedIdp(
        { sub: 'user-123', email: 'someone@corp', email_verified: true },
        { emails: '@corp', allowAll: 'true' },
        async () => {
          const before = { users: userCount(), sessions: sessionCount() };

          await runCallbackDenied();
          assertEquals({ users: userCount(), sessions: sessionCount() }, before);
        }
      );
    });
  }
);

migratedTest('oidc callback denial revokes existing sessions of the pre-existing OIDC user (403)', async () => {
  await withAuthMode('oidc', async () => {
    await withStubbedIdp(
      { sub: 'returning-user', email: 'someone@example.org' },
      { subjects: 'admin-sub' },
      async () => {
        const userId = usersQueries.getOrCreateOidcUser('returning-user');
        sessionsQueries.create(userId, 24, { ipAddress: '203.0.113.9', userAgent: 'Deno-test' });
        assertEquals(userCount(), 1);
        assertEquals(sessionsQueries.getByUserId(userId).length, 1);

        await runCallbackDenied();
        // The denial drops the user's live sessions; the user row itself is kept.
        assertEquals(sessionsQueries.getByUserId(userId), []);
        assertEquals(sessionCount(), 0);
        assertEquals(userCount(), 1);
      }
    );
  });
});
