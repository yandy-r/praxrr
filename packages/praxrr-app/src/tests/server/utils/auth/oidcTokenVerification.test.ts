/**
 * OIDC client hardening (YAN-1601): endpoint transport policy, PKCE, ID-token signature
 * verification against the JWKS (algorithm allowlist, cache, rate-limited refresh), UTF-8 claim
 * decoding, and nonce binding.
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../../../app.d.ts" />
import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import {
  base64UrlDecode,
  buildAuthorizationUrl,
  clearDiscoveryCache,
  clearJwksCache,
  codeChallengeS256,
  decodeIdToken,
  exchangeCode,
  generateCodeVerifier,
  generateNonce,
  getDiscoveryDocument,
  getLastDiscoveryEndpoints,
  verifyIdToken,
  verifyIdTokenNonce,
  verifyIdTokenSignature,
  type IdTokenClaims,
  type OidcDiscoveryEndpoints,
} from '$auth/oidc.ts';
import { GET as oidcLoginGet } from '../../../../routes/auth/oidc/login/+server.ts';
import {
  TEST_CLIENT_ID,
  TEST_DISCOVERY_URL,
  TEST_ISSUER,
  TEST_JWKS_URI,
  TEST_TOKEN_ENDPOINT,
  b64url,
  generateTestKey,
  installTestIdp,
  signJwt,
  validClaims,
  withAuthMode,
  withOidcConfig,
} from './oidcTestIdp.ts';

// ---------------------------------------------------------------------------
// PKCE / nonce helpers
// ---------------------------------------------------------------------------

Deno.test('PKCE S256 challenge matches the RFC 7636 Appendix B vector', async () => {
  assertEquals(
    await codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
  );
});

Deno.test('code verifier and nonce are unique base64url strings of 43+ characters', () => {
  const verifier = generateCodeVerifier();
  const nonce = generateNonce();
  assert(/^[A-Za-z0-9_-]{43,}$/.test(verifier), verifier);
  assert(/^[A-Za-z0-9_-]{43,}$/.test(nonce), nonce);
  assert(verifier !== generateCodeVerifier());
  assert(nonce !== generateNonce());
});

Deno.test('authorization URL carries nonce, code_challenge, and the S256 method', () => {
  const url = new URL(
    buildAuthorizationUrl('https://idp.test/authorize', {
      clientId: 'c',
      redirectUri: 'https://app.test/auth/oidc/callback',
      state: 's',
      nonce: 'n-1',
      codeChallenge: 'challenge-1',
    })
  );
  assertEquals(url.searchParams.get('nonce'), 'n-1');
  assertEquals(url.searchParams.get('code_challenge'), 'challenge-1');
  assertEquals(url.searchParams.get('code_challenge_method'), 'S256');
  assertEquals(url.searchParams.get('state'), 's');
});

// ---------------------------------------------------------------------------
// Claim decoding
// ---------------------------------------------------------------------------

Deno.test('decodeIdToken decodes the payload as UTF-8 (non-ASCII email round-trips)', async () => {
  const key = await generateTestKey('RS256');
  const token = await signJwt(key, validClaims({ email: 'jürgen@exämple.com', name: '山田 太郎' }));
  const claims = decodeIdToken(token);
  assertEquals(claims.email, 'jürgen@exämple.com');
  assertEquals(claims.name, '山田 太郎');
});

Deno.test('base64UrlDecode accepts unpadded and padded input and rejects invalid characters', () => {
  assertEquals(new TextDecoder().decode(base64UrlDecode('Zm9v')), 'foo');
  assertEquals(new TextDecoder().decode(base64UrlDecode('Zm8')), 'fo');
  assertEquals(new TextDecoder().decode(base64UrlDecode('Zm8=')), 'fo');
  assertEquals(new TextDecoder().decode(base64UrlDecode('Zg')), 'f');
  assertThrows(() => base64UrlDecode('Zm9v!'), Error, 'Invalid base64url');
  assertThrows(() => base64UrlDecode('Z'), Error, 'Invalid base64url');
});

Deno.test('decodeIdToken rejects malformed UTF-8 and non-object payloads', () => {
  const header = b64url('{"alg":"RS256"}');
  assertThrows(() => decodeIdToken(`${header}.${b64url(new Uint8Array([0xff, 0xfe, 0xfd]))}.sig`));
  assertThrows(() => decodeIdToken(`${header}.${b64url('[1,2]')}.sig`), Error, 'JSON object');
  assertThrows(() => decodeIdToken('only.two'), Error, 'Invalid JWT format');
});

// ---------------------------------------------------------------------------
// Nonce binding
// ---------------------------------------------------------------------------

Deno.test('verifyIdTokenNonce requires a matching string nonce claim', () => {
  const base = validClaims() as never;
  verifyIdTokenNonce({ ...(base as object), nonce: 'abc' } as never, 'abc');
  assertThrows(() => verifyIdTokenNonce({ ...(base as object), nonce: undefined } as never, 'abc'), Error, 'missing');
  assertThrows(() => verifyIdTokenNonce({ ...(base as object), nonce: 'abd' } as never, 'abc'), Error, 'match');
  assertThrows(() => verifyIdTokenNonce({ ...(base as object), nonce: 5 } as never, '5'), Error, 'missing');
});

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

Deno.test('signature: valid RS256 and ES256 tokens verify', async () => {
  const rsa = await generateTestKey('RS256');
  const ec = await generateTestKey('ES256');
  const idp = installTestIdp({ keys: [rsa, ec] });
  try {
    await verifyIdTokenSignature(await signJwt(rsa, validClaims()), TEST_JWKS_URI);
    await verifyIdTokenSignature(await signJwt(ec, validClaims()), TEST_JWKS_URI);
    // Second verification reuses the cached JWKS.
    assertEquals(idp.count(TEST_JWKS_URI), 1);
  } finally {
    idp.restore();
  }
});

Deno.test('signature: a tampered payload fails', async () => {
  const key = await generateTestKey('RS256');
  const idp = installTestIdp({ keys: [key] });
  try {
    const token = await signJwt(key, validClaims({ sub: 'victim' }));
    const [h, , s] = token.split('.');
    const forged = `${h}.${b64url(JSON.stringify(validClaims({ sub: 'admin' })))}.${s}`;
    await assertRejects(() => verifyIdTokenSignature(forged, TEST_JWKS_URI), Error, 'signature verification failed');
  } finally {
    idp.restore();
  }
});

Deno.test('signature: a token signed by an unpublished key fails', async () => {
  const published = await generateTestKey('RS256', 'k1');
  const attacker = await generateTestKey('RS256', 'k1');
  const idp = installTestIdp({ keys: [published] });
  try {
    await assertRejects(
      async () => verifyIdTokenSignature(await signJwt(attacker, validClaims()), TEST_JWKS_URI),
      Error,
      'signature verification failed'
    );
  } finally {
    idp.restore();
  }
});

Deno.test('signature: alg none and missing alg are rejected without fetching keys', async () => {
  const key = await generateTestKey('RS256');
  const idp = installTestIdp({ keys: [key] });
  try {
    for (const alg of ['none', 'None', 'NONE']) {
      const token = await signJwt(key, validClaims(), { header: { alg }, signature: '' });
      await assertRejects(() => verifyIdTokenSignature(token, TEST_JWKS_URI), Error, 'Unsupported');
    }
    const noAlg = `${b64url('{"typ":"JWT"}')}.${b64url(JSON.stringify(validClaims()))}.AAAA`;
    await assertRejects(() => verifyIdTokenSignature(noAlg, TEST_JWKS_URI), Error, 'Unsupported');
    assertEquals(idp.count(TEST_JWKS_URI), 0);
  } finally {
    idp.restore();
  }
});

Deno.test('signature: HS256 token MACed with the public key material is rejected', async () => {
  const key = await generateTestKey('RS256');
  const idp = installTestIdp({ keys: [key] });
  try {
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: key.kid }));
    const payload = b64url(JSON.stringify(validClaims()));
    const hmacKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(String(key.publicJwk.n)),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signingInput = new TextEncoder().encode(`${header}.${payload}`);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, signingInput));
    const token = `${header}.${payload}.${b64url(mac)}`;
    await assertRejects(() => verifyIdTokenSignature(token, TEST_JWKS_URI), Error, 'Unsupported');
  } finally {
    idp.restore();
  }
});

Deno.test('signature: key type must match the header algorithm', async () => {
  const ec = await generateTestKey('ES256', 'shared-kid');
  const idp = installTestIdp({ keys: [ec] });
  try {
    // Header claims RS256 but only an EC key is published for that kid.
    const token = await signJwt(ec, validClaims(), { header: { alg: 'RS256' }, signature: 'AAAA' });
    await assertRejects(() => verifyIdTokenSignature(token, TEST_JWKS_URI), Error, 'No matching signing key');
  } finally {
    idp.restore();
  }
});

Deno.test('signature: keys with a non-sig use are ignored', async () => {
  const key = await generateTestKey('RS256', 'enc-key');
  key.publicJwk.use = 'enc';
  const idp = installTestIdp({ keys: [key] });
  try {
    await assertRejects(
      async () => verifyIdTokenSignature(await signJwt(key, validClaims()), TEST_JWKS_URI),
      Error,
      'No matching signing key'
    );
  } finally {
    idp.restore();
  }
});

Deno.test('JWKS: an unknown kid triggers one refetch and succeeds once the key has rotated in', async () => {
  const oldKey = await generateTestKey('RS256', 'old');
  const newKey = await generateTestKey('RS256', 'new');
  const idp = installTestIdp({ keys: [oldKey] });
  try {
    await verifyIdTokenSignature(await signJwt(oldKey, validClaims()), TEST_JWKS_URI);
    assertEquals(idp.count(TEST_JWKS_URI), 1);

    idp.setKeys([oldKey, newKey]);
    await verifyIdTokenSignature(await signJwt(newKey, validClaims()), TEST_JWKS_URI);
    assertEquals(idp.count(TEST_JWKS_URI), 2);

    // The refreshed set is cached: no further fetches for either key.
    await verifyIdTokenSignature(await signJwt(oldKey, validClaims()), TEST_JWKS_URI);
    await verifyIdTokenSignature(await signJwt(newKey, validClaims()), TEST_JWKS_URI);
    assertEquals(idp.count(TEST_JWKS_URI), 2);
  } finally {
    idp.restore();
  }
});

Deno.test('JWKS: forced refreshes for unknown kids are rate limited', async () => {
  const key = await generateTestKey('RS256', 'known');
  const stranger = await generateTestKey('RS256', 'stranger');
  const idp = installTestIdp({ keys: [key] });
  try {
    await verifyIdTokenSignature(await signJwt(key, validClaims()), TEST_JWKS_URI);
    assertEquals(idp.count(TEST_JWKS_URI), 1);

    for (let i = 0; i < 5; i++) {
      const token = await signJwt(stranger, validClaims(), { header: { kid: `unknown-${i}` } });
      await assertRejects(() => verifyIdTokenSignature(token, TEST_JWKS_URI), Error, 'No matching signing key');
    }
    // One forced refresh happened; the other four were suppressed.
    assertEquals(idp.count(TEST_JWKS_URI), 2);
  } finally {
    idp.restore();
  }
});

Deno.test('JWKS: a failing forced refresh is still rate limited', async () => {
  const key = await generateTestKey('RS256', 'known');
  const stranger = await generateTestKey('RS256', 'stranger');
  const idp = installTestIdp({ keys: [key] });
  const stubFetch = globalThis.fetch;
  try {
    await verifyIdTokenSignature(await signJwt(key, validClaims()), TEST_JWKS_URI);
    assertEquals(idp.count(TEST_JWKS_URI), 1);

    // The provider now fails every JWKS request.
    let failedFetches = 0;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url !== TEST_JWKS_URI) return stubFetch(input, init);
      failedFetches++;
      return Promise.resolve(new Response('unavailable', { status: 503 }));
    }) as typeof fetch;

    for (let i = 0; i < 5; i++) {
      const token = await signJwt(stranger, validClaims(), { header: { kid: `unknown-${i}` } });
      await assertRejects(() => verifyIdTokenSignature(token, TEST_JWKS_URI));
    }
    // Only the first forced refresh reached the failing provider.
    assertEquals(failedFetches, 1);
  } finally {
    globalThis.fetch = stubFetch;
    idp.restore();
  }
});

// ---------------------------------------------------------------------------
// Discovery transport policy
// ---------------------------------------------------------------------------

Deno.test('discovery: an insecure discovery URL is rejected without fetching', async () => {
  const idp = installTestIdp();
  try {
    await assertRejects(
      () => getDiscoveryDocument('http://idp.example.com/.well-known/openid-configuration'),
      Error,
      'https'
    );
    assertEquals(idp.calls, []);
  } finally {
    idp.restore();
  }
});

Deno.test('discovery: insecure endpoints in the document are rejected and not cached', async () => {
  const base = {
    issuer: TEST_ISSUER,
    authorization_endpoint: `${TEST_ISSUER}/authorize`,
    token_endpoint: TEST_TOKEN_ENDPOINT,
    jwks_uri: TEST_JWKS_URI,
  };
  const recorded = {
    url: TEST_DISCOVERY_URL,
    authorizationEndpoint: base.authorization_endpoint,
    tokenEndpoint: TEST_TOKEN_ENDPOINT,
    jwksUri: TEST_JWKS_URI,
  };
  const cases: Array<[string, Record<string, unknown>, string, OidcDiscoveryEndpoints | null]> = [
    [
      'http token_endpoint',
      { ...base, token_endpoint: 'http://idp.example.com/token' },
      'token endpoint',
      { ...recorded, tokenEndpoint: 'http://idp.example.com/token' },
    ],
    [
      'http jwks_uri',
      { ...base, jwks_uri: 'http://idp.example.com/jwks' },
      'jwks_uri',
      { ...recorded, jwksUri: 'http://idp.example.com/jwks' },
    ],
    [
      'http authorization_endpoint',
      { ...base, authorization_endpoint: 'http://idp.example.com/authorize' },
      'authorization endpoint',
      { ...recorded, authorizationEndpoint: 'http://idp.example.com/authorize' },
    ],
    ['non-string authorization_endpoint', { ...base, authorization_endpoint: 42 }, 'authorization_endpoint', null],
    ['missing jwks_uri', { ...base, jwks_uri: undefined }, 'jwks_uri', null],
    ['empty issuer', { ...base, issuer: '' }, 'issuer', null],
  ];
  for (const [label, doc, message, expectedRecord] of cases) {
    const idp = installTestIdp({ discoveryDoc: doc });
    try {
      await assertRejects(() => getDiscoveryDocument(TEST_DISCOVERY_URL), Error, message, label);
      assertEquals(getLastDiscoveryEndpoints(), expectedRecord, label);
      // A rejected document is never cached: the next call fetches again.
      await assertRejects(() => getDiscoveryDocument(TEST_DISCOVERY_URL), Error, message, label);
      assertEquals(idp.count(TEST_DISCOVERY_URL), 2, label);
    } finally {
      idp.restore();
    }
  }
});

Deno.test('discovery: loopback http endpoints are allowed and the cache exposes them', async () => {
  const url = 'http://localhost:9000/.well-known/openid-configuration';
  const originalFetch = globalThis.fetch;
  clearDiscoveryCache();
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          issuer: 'http://localhost:9000',
          authorization_endpoint: 'http://localhost:9000/authorize',
          token_endpoint: 'http://127.0.0.1:9000/token',
          jwks_uri: 'http://[::1]:9000/jwks',
        })
      )
    )) as typeof fetch;
  try {
    assertEquals(getLastDiscoveryEndpoints(), null);
    const doc = await getDiscoveryDocument(url);
    assertEquals(doc.issuer, 'http://localhost:9000');
    assertEquals(getLastDiscoveryEndpoints(), {
      url,
      authorizationEndpoint: 'http://localhost:9000/authorize',
      tokenEndpoint: 'http://127.0.0.1:9000/token',
      jwksUri: 'http://[::1]:9000/jwks',
    });
  } finally {
    globalThis.fetch = originalFetch;
    clearDiscoveryCache();
    clearJwksCache();
  }
});

// ---------------------------------------------------------------------------
// Redirect handling
// ---------------------------------------------------------------------------

Deno.test('discovery: a redirect response is treated as a failure', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  clearDiscoveryCache();
  globalThis.fetch = (() => {
    calls += 1;
    return Promise.resolve(new Response(null, { status: 302, headers: { Location: TEST_TOKEN_ENDPOINT } }));
  }) as typeof fetch;
  try {
    await assertRejects(() => getDiscoveryDocument(TEST_DISCOVERY_URL), Error, '302');
    assertEquals(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    clearDiscoveryCache();
    clearJwksCache();
  }
});

Deno.test('token exchange: a redirect response is treated as a failure and is not followed', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    calls += 1;
    return Promise.resolve(
      new Response(null, { status: 307, headers: { Location: `${TEST_TOKEN_ENDPOINT}/followed` } })
    );
  }) as typeof fetch;
  try {
    await assertRejects(
      () =>
        exchangeCode(TEST_TOKEN_ENDPOINT, 'code', {
          clientId: TEST_CLIENT_ID,
          clientSecret: 'secret',
          redirectUri: 'http://praxrr.test/auth/oidc/callback',
          codeVerifier: 'verifier',
        }),
      Error,
      '307'
    );
    assertEquals(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    clearDiscoveryCache();
    clearJwksCache();
  }
});

Deno.test('JWKS: a redirect response is treated as a failure', async () => {
  const key = await generateTestKey('RS256');
  const originalFetch = globalThis.fetch;
  let calls = 0;
  clearDiscoveryCache();
  clearJwksCache();
  globalThis.fetch = (() => {
    calls += 1;
    return Promise.resolve(new Response(null, { status: 302, headers: { Location: TEST_JWKS_URI } }));
  }) as typeof fetch;
  try {
    await assertRejects(
      async () => verifyIdTokenSignature(await signJwt(key, validClaims()), TEST_JWKS_URI),
      Error,
      '302'
    );
    assertEquals(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    clearDiscoveryCache();
    clearJwksCache();
  }
});

// ---------------------------------------------------------------------------
// Outbound request timeouts
// ---------------------------------------------------------------------------

Deno.test('discovery, token exchange, and JWKS fetches carry a finite abort timeout', async () => {
  const key = await generateTestKey('RS256');
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  const requestedTimeouts: number[] = [];
  let hangingFetches = 0;
  // Shorten the real delay but record what production code asked for.
  AbortSignal.timeout = (ms: number) => {
    requestedTimeouts.push(ms);
    return originalTimeout.call(AbortSignal, 20);
  };
  // A provider that accepts the connection and never answers; only the abort signal ends the request.
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    hangingFetches += 1;
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; // no signal: hangs forever, so the awaited call below would never settle
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }) as typeof fetch;
  clearDiscoveryCache();
  clearJwksCache();
  try {
    await assertRejects(() => getDiscoveryDocument(TEST_DISCOVERY_URL));
    await assertRejects(() =>
      exchangeCode(TEST_TOKEN_ENDPOINT, 'code', {
        clientId: TEST_CLIENT_ID,
        clientSecret: 'secret',
        redirectUri: 'http://praxrr.test/auth/oidc/callback',
        codeVerifier: 'verifier',
      })
    );
    await assertRejects(async () => verifyIdTokenSignature(await signJwt(key, validClaims()), TEST_JWKS_URI));
    assertEquals(hangingFetches, 3);
    assertEquals(requestedTimeouts.length, 3);
    for (const ms of requestedTimeouts) assert(Number.isFinite(ms) && ms > 0 && ms <= 60_000);
  } finally {
    AbortSignal.timeout = originalTimeout;
    globalThis.fetch = originalFetch;
    clearDiscoveryCache();
    clearJwksCache();
  }
});

// ---------------------------------------------------------------------------
// Claim checks (OIDC Core 3.1.3.7)
// ---------------------------------------------------------------------------

Deno.test('verifyIdToken: azp and issued-at checks follow OIDC Core 3.1.3.7', () => {
  const opts = { clientId: TEST_CLIENT_ID, issuer: TEST_ISSUER };
  const asClaims = (overrides: Record<string, unknown>) => validClaims(overrides) as unknown as IdTokenClaims;
  const now = Math.floor(Date.now() / 1000);

  verifyIdToken(asClaims({}), opts);
  verifyIdToken(asClaims({ azp: TEST_CLIENT_ID }), opts);
  verifyIdToken(asClaims({ aud: [TEST_CLIENT_ID, 'other-audience'], azp: TEST_CLIENT_ID }), opts);
  verifyIdToken(asClaims({ iat: now - 60 }), opts);
  verifyIdToken(asClaims({ iat: now + 299 }), opts);

  assertThrows(() => verifyIdToken(asClaims({ azp: 'other-client' }), opts), Error, 'azp');
  assertThrows(() => verifyIdToken(asClaims({ aud: [TEST_CLIENT_ID, 'other-audience'] }), opts), Error, 'azp');
  assertThrows(
    () => verifyIdToken(asClaims({ aud: [TEST_CLIENT_ID, 'other-audience'], azp: 'other-client' }), opts),
    Error,
    'azp'
  );
  for (const iat of [undefined, null, '123', Number.NaN, Number.POSITIVE_INFINITY, now + 301, now + 3600]) {
    assertThrows(() => verifyIdToken(asClaims({ iat }), opts), Error, 'iat', String(iat));
  }
});

// ---------------------------------------------------------------------------
// Login route
// ---------------------------------------------------------------------------

interface CookieRecord {
  value: string;
  options: Record<string, unknown>;
}

function loginEvent(protocol: 'http' | 'https' = 'http'): { event: RequestEvent; jar: Map<string, CookieRecord> } {
  const jar = new Map<string, CookieRecord>();
  const url = new URL(`${protocol}://praxrr.test/auth/oidc/login`);
  const event = {
    url,
    request: new Request(url, { headers: { 'user-agent': 'Deno-test' } }),
    locals: { user: null, session: null, authBypass: false, principal: null },
    cookies: {
      get: (name: string) => jar.get(name)?.value,
      set: (name: string, value: string, options: Record<string, unknown>) => void jar.set(name, { value, options }),
      delete: (name: string) => void jar.delete(name),
      getAll: () => [...jar].map(([name, record]) => ({ name, value: record.value })),
    },
    getClientAddress: () => '203.0.113.9',
  } as unknown as RequestEvent;
  return { event, jar };
}

Deno.test('login route sets httpOnly state/nonce/verifier cookies and a PKCE S256 authorization URL', async () => {
  const idp = installTestIdp();
  try {
    await withAuthMode('oidc', () =>
      withOidcConfig({}, async () => {
        const { event, jar } = loginEvent();
        let thrown: unknown;
        try {
          await oidcLoginGet(event);
        } catch (err) {
          thrown = err;
        }
        assert(isRedirect(thrown), 'login must redirect');
        const location = new URL(thrown.location);
        assertEquals(location.origin + location.pathname, `${TEST_ISSUER}/authorize`);

        for (const name of ['oidc_state', 'oidc_nonce', 'oidc_code_verifier']) {
          const cookie = jar.get(name);
          assert(cookie, `${name} cookie must be set`);
          assertEquals(cookie.options.httpOnly, true, name);
          assertEquals(cookie.options.sameSite, 'lax', name);
          assertEquals(cookie.options.path, '/', name);
          assertEquals(cookie.options.maxAge, 600, name);
        }

        assertEquals(location.searchParams.get('state'), jar.get('oidc_state')!.value);
        assertEquals(location.searchParams.get('nonce'), jar.get('oidc_nonce')!.value);
        assertEquals(location.searchParams.get('code_challenge_method'), 'S256');
        assertEquals(
          location.searchParams.get('code_challenge'),
          await codeChallengeS256(jar.get('oidc_code_verifier')!.value)
        );
      })
    );
  } finally {
    idp.restore();
  }
});

Deno.test('login route marks the OIDC cookies Secure on https transport', async () => {
  const idp = installTestIdp();
  try {
    await withAuthMode('oidc', () =>
      withOidcConfig({}, async () => {
        const { event, jar } = loginEvent('https');
        try {
          await oidcLoginGet(event);
        } catch {
          // redirect expected
        }
        for (const name of ['oidc_state', 'oidc_nonce', 'oidc_code_verifier']) {
          assertEquals(jar.get(name)?.options.secure, true, name);
        }
      })
    );
  } finally {
    idp.restore();
  }
});

Deno.test('login route returns a generic 500 and no cookies when discovery is insecure', async () => {
  const idp = installTestIdp();
  try {
    await withAuthMode('oidc', () =>
      withOidcConfig(
        {},
        async () => {
          const { event, jar } = loginEvent();
          let thrown: unknown;
          try {
            await oidcLoginGet(event);
          } catch (err) {
            thrown = err;
          }
          assert(isHttpError(thrown), 'must be an HttpError');
          assertEquals(thrown.status, 500);
          assertEquals(jar.size, 0);
          assertEquals(idp.calls, []);
        },
        'http://idp.example.com/.well-known/openid-configuration'
      )
    );
  } finally {
    idp.restore();
  }
});
