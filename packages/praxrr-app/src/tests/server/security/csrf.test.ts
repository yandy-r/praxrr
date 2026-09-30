/**
 * Tests for the runtime CSRF origin gate (YAN-433 / #276). `isCrossOriginMutation` is the
 * accept/reject classifier; `resolveExpectedOrigins` builds the trusted-origin set from the
 * listener origin, trusted-proxy forwarded headers, and the explicit allowlist;
 * `parseTrustedOrigins`/`normalizeOrigin` are the shared env parsers. No DB, no env, no network.
 */

import { assertEquals } from '@std/assert';
import { csrfGuard, isCrossOriginMutation, resolveExpectedOrigins } from '$lib/server/security/csrf.ts';
import { normalizeOrigin, parseTrustedOrigins } from '$lib/shared/security/origin.ts';

const LISTENER = 'http://praxrr:6868';
const PUBLIC = 'https://praxrr.example.com';

function expected(overrides: Partial<Parameters<typeof resolveExpectedOrigins>[0]> = {}) {
  return resolveExpectedOrigins({
    urlOrigin: LISTENER,
    forwardedProto: null,
    forwardedHost: null,
    peerIsTrustedProxy: false,
    trustedOrigins: [],
    ...overrides,
  });
}

function mutation(overrides: Partial<Parameters<typeof isCrossOriginMutation>[0]> = {}): boolean {
  return isCrossOriginMutation({
    method: 'POST',
    origin: 'http://evil.example',
    expectedOrigins: expected(),
    ...overrides,
  });
}

Deno.test('isCrossOriginMutation: cross-site mutation is rejected for every method', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assertEquals(mutation({ method }), true, method);
  }
});

Deno.test('isCrossOriginMutation: comma-joined duplicate Origin is rejected', () => {
  assertEquals(mutation({ origin: `${LISTENER}, http://evil.example` }), true);
  assertEquals(mutation({ origin: `http://evil.example, ${LISTENER}` }), true);
});

Deno.test('isCrossOriginMutation: same-origin POST to the listener passes', () => {
  assertEquals(mutation({ origin: LISTENER }), false);
});

Deno.test('isCrossOriginMutation: absent Origin (non-browser client) passes', () => {
  assertEquals(mutation({ origin: null }), false);
});

Deno.test('isCrossOriginMutation: safe methods are never rejected', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    assertEquals(mutation({ method }), false);
  }
});

Deno.test('isCrossOriginMutation: unparseable Origin (incl. literal null) is rejected', () => {
  assertEquals(mutation({ origin: 'null' }), true);
  assertEquals(mutation({ origin: 'not-an-origin' }), true);
});

Deno.test('isCrossOriginMutation: explicit PRAXRR_TRUSTED_ORIGINS entry passes', () => {
  const expectedOrigins = expected({ trustedOrigins: ['http://evil.example'] });
  assertEquals(mutation({ expectedOrigins }), false);
});

Deno.test('resolveExpectedOrigins: forwarded origin is honored only from a trusted proxy peer', () => {
  const untrusted = expected({
    forwardedProto: 'https',
    forwardedHost: 'praxrr.example.com',
    peerIsTrustedProxy: false,
  });
  assertEquals(untrusted, [LISTENER]);

  const trusted = expected({
    forwardedProto: 'https',
    forwardedHost: 'praxrr.example.com',
    peerIsTrustedProxy: true,
  });
  assertEquals(trusted, [LISTENER, PUBLIC]);
  assertEquals(mutation({ origin: PUBLIC, expectedOrigins: trusted }), false);
});

Deno.test('resolveExpectedOrigins: malformed forwarded headers never widen trust', () => {
  assertEquals(
    expected({
      forwardedProto: 'gopher',
      forwardedHost: 'praxrr.example.com',
      peerIsTrustedProxy: true,
    }),
    [LISTENER]
  );
  assertEquals(
    expected({
      forwardedProto: 'https',
      forwardedHost: '::not a host::',
      peerIsTrustedProxy: true,
    }),
    [LISTENER]
  );
  assertEquals(expected({ forwardedProto: 'https', forwardedHost: null, peerIsTrustedProxy: true }), [LISTENER]);
});

Deno.test('normalizeOrigin: canonicalizes and drops non-http(s)/invalid values', () => {
  assertEquals(normalizeOrigin('https://Example.COM:8443'), 'https://example.com:8443');
  assertEquals(normalizeOrigin('http://praxrr:6868/path?x=1'), 'http://praxrr:6868');
  assertEquals(normalizeOrigin('gopher://x'), null);
  assertEquals(normalizeOrigin('null'), null);
  assertEquals(normalizeOrigin(null), null);
});

Deno.test('parseTrustedOrigins: comma list is trimmed, normalized, deduped, fail-closed', () => {
  assertEquals(parseTrustedOrigins(' https://praxrr.example.com ,https://PRAXRR.EXAMPLE.COM, not-a-url, '), [
    'https://praxrr.example.com',
  ]);
  assertEquals(parseTrustedOrigins(null), []);
  assertEquals(parseTrustedOrigins(''), []);
  assertEquals(parseTrustedOrigins('not-a-url'), []);
});

// ---------------------------------------------------------------------------
// Hook-level wiring: the csrfGuard Handle itself (response shape + passthrough).
// These use the live config singleton (TRUSTED_PROXY/PRAXRR_TRUSTED_ORIGINS unset in tests), so
// forwarded headers are untrusted noise and only the listener origin is expected — exactly the
// default deployment posture.
// ---------------------------------------------------------------------------

interface GuardEvent {
  url: URL;
  request: Request;
  getClientAddress: () => string;
}

function guardEvent(path: string, init: RequestInit, peer = '192.0.2.9'): GuardEvent {
  const url = new URL(path, 'http://praxrr:6868');
  return {
    url,
    request: new Request(url, init),
    getClientAddress: () => peer,
  };
}

async function runGuard(event: GuardEvent): Promise<Response> {
  let resolved = false;
  const response = await csrfGuard({
    event: event as never,
    resolve: () => {
      resolved = true;
      return Promise.resolve(new Response('passthrough', { status: 200 }));
    },
  } as never);
  assertEquals(resolved, response.status === 200, 'resolve() must run exactly when the guard passes');
  return response;
}

Deno.test('csrfGuard: cross-origin JSON mutation to an API path returns 403 JSON and never resolves', async () => {
  const event = guardEvent('/api/v1/pcd/import', {
    method: 'POST',
    headers: { origin: 'http://evil.example', 'content-type': 'application/json' },
    body: '{"a":1}',
  });
  const response = await runGuard(event);
  assertEquals(response.status, 403);
  assertEquals(response.headers.get('content-type'), 'application/json');
  assertEquals((await response.json()).error, 'Cross-site POST submissions are forbidden');
});

Deno.test('csrfGuard: cross-site form/text/plain POST to a page route returns 403 text', async () => {
  for (const contentType of ['application/x-www-form-urlencoded', 'text/plain']) {
    const event = guardEvent('/settings/security', {
      method: 'POST',
      headers: { origin: 'http://evil.example', 'content-type': contentType },
      body: 'x=1',
    });
    const response = await runGuard(event);
    assertEquals(response.status, 403, contentType);
    assertEquals((await response.text()).includes('Cross-site POST submissions are forbidden'), true, contentType);
  }
});

Deno.test('csrfGuard: cross-origin mutation with no Content-Type (no-cors blob) is rejected', async () => {
  const event = guardEvent('/api/v1/pcd/import', {
    method: 'POST',
    headers: { origin: 'http://evil.example' },
    body: new Blob(['{"a":1}']),
  });
  assertEquals(event.request.headers.get('content-type'), null);
  assertEquals((await runGuard(event)).status, 403);
});

Deno.test('csrfGuard: cross-origin DELETE and PUT are rejected', async () => {
  for (const method of ['DELETE', 'PUT']) {
    const event = guardEvent('/api/v1/databases/1', { method, headers: { origin: 'http://evil.example' } });
    assertEquals((await runGuard(event)).status, 403, method);
  }
});

Deno.test('csrfGuard: same-origin and absent-Origin mutations resolve through', async () => {
  const sameOrigin = guardEvent('/settings/security', {
    method: 'POST',
    headers: { origin: 'http://praxrr:6868', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'x=1',
  });
  assertEquals((await runGuard(sameOrigin)).status, 200);

  const noOrigin = guardEvent('/api/v1/pcd/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"a":1}',
  });
  assertEquals((await runGuard(noOrigin)).status, 200);
});

Deno.test('csrfGuard: untrusted forwarded headers cannot widen the origin set', async () => {
  // A direct peer (not a TRUSTED_PROXY-allowlisted address) forging X-Forwarded-Host/Proto:
  // the forwarded origin must be ignored and the cross-origin request still rejected.
  const event = guardEvent('/api/v1/settings/canary', {
    method: 'PATCH',
    headers: {
      origin: 'https://praxrr.example.com',
      'content-type': 'application/json',
      'x-forwarded-host': 'praxrr.example.com',
      'x-forwarded-proto': 'https',
    },
    body: '{}',
  });
  assertEquals((await runGuard(event)).status, 403);
});

Deno.test('csrfGuard: GET with a foreign Origin is never blocked', async () => {
  const event = guardEvent('/settings/security', {
    method: 'GET',
    headers: { origin: 'http://evil.example' },
  });
  assertEquals((await runGuard(event)).status, 200);
});
