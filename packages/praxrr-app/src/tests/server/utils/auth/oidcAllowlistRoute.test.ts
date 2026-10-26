/**
 * OIDC sign-in allowlist route tests (YAN-436): the callback only provisions users for
 * identities the operator allowlisted. Drives `oidcCallbackGet` under AUTH=oidc with a
 * stubbed IdP (discovery, JWKS, and token endpoints) and an id_token signed by a generated key.
 * Also covers the callback's PKCE / nonce / signature hardening (YAN-1601).
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../../../app.d.ts" />
import { assert, assertEquals } from '@std/assert';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { sessionsQueries } from '$db/queries/sessions.ts';
import { usersQueries } from '$db/queries/users.ts';
import { oidcFlowCookieOptions } from '$auth/oidcFlowCookie.ts';
import {
  TEST_CODE_VERIFIER,
  TEST_NONCE,
  generateTestKey,
  installTestIdp,
  signJwt,
  validClaims,
  withAuthMode,
  withOidcConfig,
  type TestIdp,
  type TestKey,
} from './oidcTestIdp.ts';
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

function userCount(): number {
  return db.queryFirst<{ count: number }>('SELECT COUNT(*) as count FROM users')!.count;
}

function sessionCount(): number {
  return db.queryFirst<{ count: number }>('SELECT COUNT(*) as count FROM sessions')!.count;
}

interface CallbackCookieState {
  values: Map<string, string>;
  setOptions: Map<string, Record<string, unknown>>;
  deleteCalls: Array<{ name: string; options: Record<string, unknown> }>;
}

/**
 * GET callback RequestEvent with the cookies set at login (state, nonce, PKCE verifier by default;
 * pass `cookies` to override or `undefined` to omit one) and a non-local client IP.
 */
function callbackEvent(
  state = 'abc123',
  code = 'stub-code',
  cookies: Record<string, string | undefined> = {},
  opts: { protocol?: 'http' | 'https'; cookieState?: CallbackCookieState; urlState?: string } = {}
): RequestEvent {
  const protocol = opts.protocol ?? 'http';
  const queryState = opts.urlState ?? state;
  const url = new URL(
    `${protocol}://praxrr.test/auth/oidc/callback?state=${encodeURIComponent(queryState)}&code=${encodeURIComponent(code)}`
  );
  const cookieState: CallbackCookieState = opts.cookieState ?? {
    values: new Map<string, string>(),
    setOptions: new Map<string, Record<string, unknown>>(),
    deleteCalls: [],
  };
  for (const [name, value] of Object.entries({
    oidc_state: state,
    oidc_nonce: TEST_NONCE,
    oidc_code_verifier: TEST_CODE_VERIFIER,
    ...cookies,
  })) {
    if (value === undefined) cookieState.values.delete(name);
    else cookieState.values.set(name, value);
  }
  return {
    url,
    request: new Request(url, { headers: { 'user-agent': 'Deno-test' } }),
    locals: { user: null, session: null, authBypass: false, principal: null },
    cookies: {
      get: (name: string) => cookieState.values.get(name),
      set: (name: string, value: string, options: Record<string, unknown> = {}) => {
        cookieState.values.set(name, value);
        cookieState.setOptions.set(name, options);
      },
      delete: (name: string, options: Record<string, unknown> = {}) => {
        cookieState.deleteCalls.push({ name, options });
        cookieState.values.delete(name);
      },
      getAll: () => [...cookieState.values].map(([name, value]) => ({ name, value })),
    },
    getClientAddress: () => '203.0.113.9',
  } as unknown as RequestEvent;
}

let signingKey: TestKey | null = null;

/**
 * Stand up the stub IdP (discovery + JWKS + token endpoint) serving an id_token signed by a generated
 * key, and swap `config.oidc` for well-formed client credentials plus an allowlist policy parsed by the
 * real `parseOidcAllowlist`. Discovery/JWKS caches are cleared before `fn` and again afterwards. The
 * token carries the nonce the callback event's cookie holds unless `claims` overrides it.
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
  fn: (idp: TestIdp) => Promise<void> | void,
  opts: { signWith?: TestKey } = {}
): Promise<void> {
  signingKey ??= await generateTestKey('RS256', 'route-test-key');
  const token = await signJwt(opts.signWith ?? signingKey, validClaims(claims));
  const idp = installTestIdp({ keys: [signingKey], idToken: token });
  try {
    await withOidcConfig(allowlistEnv, () => fn(idp));
  } finally {
    idp.restore();
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

// ---------------------------------------------------------------------------
// Token verification hardening (YAN-1601)
// ---------------------------------------------------------------------------

/** Run the callback with `event` and return the thrown HttpError/Redirect (or undefined). */
async function runCallbackWith(event: RequestEvent): Promise<unknown> {
  try {
    await oidcCallbackGet(event);
  } catch (err) {
    return err;
  }
  return undefined;
}

function assertNoUserOrSession(): void {
  assertEquals({ users: userCount(), sessions: sessionCount() }, { users: 0, sessions: 0 });
}

migratedTest('oidc callback sends the PKCE code_verifier in the token request', async () => {
  await withAuthMode('oidc', async () => {
    await withStubbedIdp({ sub: 'admin-sub' }, { subjects: 'admin-sub' }, async (idp) => {
      const thrown = await runCallbackWith(callbackEvent());
      assert(isRedirect(thrown), 'must be a SvelteKit Redirect');
      assertEquals(idp.tokenRequests.length, 1);
      assertEquals(idp.tokenRequests[0].get('code_verifier'), TEST_CODE_VERIFIER);
      assertEquals(idp.tokenRequests[0].get('grant_type'), 'authorization_code');
    });
  });
});

migratedTest('oidc callback clears the state, nonce, and verifier cookies', async () => {
  await withAuthMode('oidc', async () => {
    await withStubbedIdp({ sub: 'admin-sub' }, { subjects: 'admin-sub' }, async () => {
      const event = callbackEvent();
      await runCallbackWith(event);
      for (const name of ['oidc_state', 'oidc_nonce', 'oidc_code_verifier']) {
        assertEquals(event.cookies.get(name), undefined, name);
      }
    });
  });
});

migratedTest('oidc callback rejects a missing PKCE verifier cookie (400) and still clears the cookies', async () => {
  await withAuthMode('oidc', async () => {
    await withStubbedIdp({ sub: 'admin-sub' }, { subjects: 'admin-sub' }, async (idp) => {
      const event = callbackEvent('abc123', 'stub-code', { oidc_code_verifier: undefined });
      const thrown = await runCallbackWith(event);
      assert(isHttpError(thrown), 'must be a SvelteKit HttpError');
      assertEquals(thrown.status, 400);
      assertEquals(idp.tokenRequests.length, 0);
      assertEquals(event.cookies.get('oidc_state'), undefined);
      assertEquals(event.cookies.get('oidc_nonce'), undefined);
      assertNoUserOrSession();
    });
  });
});

migratedTest('oidc callback rejects a missing nonce cookie (400)', async () => {
  await withAuthMode('oidc', async () => {
    await withStubbedIdp({ sub: 'admin-sub' }, { subjects: 'admin-sub' }, async (idp) => {
      const thrown = await runCallbackWith(callbackEvent('abc123', 'stub-code', { oidc_nonce: undefined }));
      assert(isHttpError(thrown), 'must be a SvelteKit HttpError');
      assertEquals(thrown.status, 400);
      assertEquals(idp.tokenRequests.length, 0);
      assertNoUserOrSession();
    });
  });
});

migratedTest('oidc callback rejects an ID token without a nonce claim (500, no user, no session)', async () => {
  await withAuthMode('oidc', async () => {
    await withStubbedIdp({ sub: 'admin-sub', nonce: undefined }, { subjects: 'admin-sub' }, async () => {
      const event = callbackEvent();
      const thrown = await runCallbackWith(event);
      assert(isHttpError(thrown), 'must be a SvelteKit HttpError');
      assertEquals(thrown.status, 500);
      assertEquals(event.cookies.get('session'), undefined);
      assertNoUserOrSession();
    });
  });
});

migratedTest('oidc callback rejects an ID token with a mismatched nonce claim (500, no user, no session)', async () => {
  await withAuthMode('oidc', async () => {
    await withStubbedIdp({ sub: 'admin-sub', nonce: 'someone-elses-nonce' }, { subjects: 'admin-sub' }, async () => {
      const event = callbackEvent();
      const thrown = await runCallbackWith(event);
      assert(isHttpError(thrown), 'must be a SvelteKit HttpError');
      assertEquals(thrown.status, 500);
      assertEquals(event.cookies.get('session'), undefined);
      assertNoUserOrSession();
    });
  });
});

migratedTest('oidc callback rejects an ID token signed by a key the IdP does not publish (500)', async () => {
  await withAuthMode('oidc', async () => {
    const rogue = await generateTestKey('RS256', 'route-test-key');
    await withStubbedIdp(
      { sub: 'admin-sub' },
      { subjects: 'admin-sub' },
      async () => {
        const event = callbackEvent();
        const thrown = await runCallbackWith(event);
        assert(isHttpError(thrown), 'must be a SvelteKit HttpError');
        assertEquals(thrown.status, 500);
        assertEquals(event.cookies.get('session'), undefined);
        assertNoUserOrSession();
      },
      { signWith: rogue }
    );
  });
});

migratedTest('oidc callback rejects an unsigned (alg none) ID token (500)', async () => {
  await withAuthMode('oidc', async () => {
    const key = await generateTestKey('RS256', 'route-test-key');
    const unsigned = await signJwt(key, validClaims({ sub: 'admin-sub' }), {
      header: { alg: 'none' },
      signature: '',
    });
    const idp = installTestIdp({ keys: [key], idToken: unsigned });
    try {
      await withOidcConfig({ subjects: 'admin-sub' }, async () => {
        const thrown = await runCallbackWith(callbackEvent());
        assert(isHttpError(thrown), 'must be a SvelteKit HttpError');
        assertEquals(thrown.status, 500);
        assertNoUserOrSession();
      });
    } finally {
      idp.restore();
    }
  });
});

function makeSharedCookieState(): CallbackCookieState {
  return { values: new Map(), setOptions: new Map(), deleteCalls: [] };
}

migratedTest('oidc callback leaves the flow cookies untouched when the state does not match', async () => {
  await withAuthMode('oidc', async () => {
    await withStubbedIdp({ sub: 'admin-sub' }, { subjects: 'admin-sub' }, async (idp) => {
      const shared = makeSharedCookieState();
      // Second login overwrites the first attempt's cookies.
      const second = callbackEvent('state-second', 'stub-code', {}, { cookieState: shared });
      void second;
      const stale = callbackEvent('state-second', 'stub-code', {}, { cookieState: shared, urlState: 'state-first' });
      const thrownStale = await runCallbackWith(stale);
      assert(isHttpError(thrownStale), 'must be a SvelteKit HttpError');
      assertEquals(thrownStale.status, 400);
      assertEquals(shared.deleteCalls, []);
      assertEquals(shared.values.get('oidc_state'), 'state-second');
      assertEquals(shared.values.get('oidc_nonce'), TEST_NONCE);
      assertEquals(shared.values.get('oidc_code_verifier'), TEST_CODE_VERIFIER);
      assertEquals(idp.tokenRequests.length, 0);
      assertNoUserOrSession();

      const good = callbackEvent('state-second', 'stub-code', {}, { cookieState: shared });
      const thrownGood = await runCallbackWith(good);
      assert(isRedirect(thrownGood), 'second attempt must succeed');
      assertEquals(
        shared.deleteCalls.map((call) => call.name),
        ['oidc_state', 'oidc_nonce', 'oidc_code_verifier']
      );
      assertEquals(idp.tokenRequests.length, 1);
    });
  });
});

migratedTest('oidc callback deletes flow cookies with the login cookie options', async () => {
  await withAuthMode('oidc', async () => {
    for (const protocol of ['http', 'https'] as const) {
      await withStubbedIdp({ sub: 'admin-sub' }, { subjects: 'admin-sub' }, async () => {
        const shared = makeSharedCookieState();
        const event = callbackEvent('abc123', 'stub-code', {}, { cookieState: shared, protocol });
        const expected = oidcFlowCookieOptions(event);
        const thrown = await runCallbackWith(event);
        assert(isRedirect(thrown), 'must redirect on success');
        assertEquals(
          shared.deleteCalls.map((call) => call.name),
          ['oidc_state', 'oidc_nonce', 'oidc_code_verifier']
        );
        for (const call of shared.deleteCalls) {
          assertEquals(call.options, expected, `${protocol} ${call.name}`);
        }
      });
    }
  });
});

migratedTest('oidc callback returns 500 without a token request when the discovery URL is insecure', async () => {
  await withAuthMode('oidc', async () => {
    signingKey ??= await generateTestKey('RS256', 'route-test-key');
    const token = await signJwt(signingKey, validClaims({ sub: 'admin-sub' }));
    const idp = installTestIdp({ keys: [signingKey], idToken: token });
    try {
      await withOidcConfig(
        { subjects: 'admin-sub' },
        async () => {
          const shared = makeSharedCookieState();
          const event = callbackEvent('abc123', 'stub-code', {}, { cookieState: shared });
          const thrown = await runCallbackWith(event);
          assert(isHttpError(thrown), 'must be a SvelteKit HttpError');
          assertEquals(thrown.status, 500);
          assertEquals(idp.tokenRequests.length, 0);
          assertEquals(idp.calls, []);
          assertEquals(event.cookies.get('session'), undefined);
          assertEquals(
            shared.deleteCalls.map((call) => call.name),
            ['oidc_state', 'oidc_nonce', 'oidc_code_verifier']
          );
          assertNoUserOrSession();
        },
        'http://idp.example.com/.well-known/openid-configuration'
      );
    } finally {
      idp.restore();
    }
  });
});
