/**
 * Request-path trust tests for getClientIp (issue #228).
 *
 * These are the regression guards for the AUTH=local X-Forwarded-For bypass: forwarded headers are
 * honored ONLY when the direct socket peer is an explicitly trusted proxy, and even then the
 * proxy-appended (rightmost) hop is used — never the leftmost client-forged token. An unresolvable peer
 * fails closed to the non-local 'unknown' sentinel. Pure: an explicit TrustedProxyConfig is injected, no
 * DB, no env.
 */

import { assert, assertEquals } from '@std/assert';
import { getClientIp, isLocalAddress } from '$auth/network.ts';
import { parseTrustedProxy } from '$shared/security/index.ts';

type StubEvent = { getClientAddress: () => string; request: Request };

function eventWith(peer: string | (() => string), headers: Record<string, string> = {}): StubEvent {
  return {
    getClientAddress: typeof peer === 'function' ? peer : () => peer,
    request: new Request('http://localhost/api', { headers }),
  };
}

Deno.test(
  'getClientIp: untrusted peer + forged X-Forwarded-For:127.0.0.1 returns the real peer (bypass closed)',
  () => {
    const cfg = parseTrustedProxy(null); // unset — the default
    const ip = getClientIp(eventWith('203.0.113.9', { 'x-forwarded-for': '127.0.0.1' }), cfg);
    assertEquals(ip, '203.0.113.9');
    // The spoof no longer yields a local address, so the AUTH=local bypass cannot trigger.
    assert(!isLocalAddress(ip));
  }
);

Deno.test('getClientIp: a trusted proxy peer has its single-value forwarded client honored', () => {
  const cfg = parseTrustedProxy('203.0.113.9/32');
  const ip = getClientIp(eventWith('203.0.113.9', { 'x-forwarded-for': '10.0.0.5' }), cfg);
  assertEquals(ip, '10.0.0.5');
});

Deno.test('getClientIp: trusted peer + appended XFF "127.0.0.1, <real>" uses the RIGHTMOST hop', () => {
  // nginx/Traefik/Caddy append; a client-forged leftmost 127.0.0.1 must not win.
  const cfg = parseTrustedProxy('203.0.113.9/32');
  const ip = getClientIp(eventWith('203.0.113.9', { 'x-forwarded-for': '127.0.0.1, 203.0.113.9' }), cfg);
  assertEquals(ip, '203.0.113.9');
  assert(!isLocalAddress(ip));
});

Deno.test('getClientIp: wildcard config honors the forwarded header from any peer', () => {
  const cfg = parseTrustedProxy('*');
  const ip = getClientIp(eventWith('8.8.8.8', { 'x-forwarded-for': '10.0.0.5' }), cfg);
  assertEquals(ip, '10.0.0.5');
});

Deno.test(
  'getClientIp: no forwarded headers returns the direct peer regardless of config (direct-deploy invariance)',
  () => {
    for (const cfg of [parseTrustedProxy(null), parseTrustedProxy('10.0.0.0/8')]) {
      assertEquals(getClientIp(eventWith('10.0.0.7'), cfg), '10.0.0.7');
    }
  }
);

Deno.test('getClientIp: a trusted peer with no forwarded headers still returns the trusted peer itself', () => {
  const cfg = parseTrustedProxy('10.0.0.0/8');
  assertEquals(getClientIp(eventWith('10.0.0.2'), cfg), '10.0.0.2');
});

Deno.test('getClientIp: an unresolvable peer fails closed to the non-local "unknown" sentinel', () => {
  const cfg = parseTrustedProxy(null);
  const thrown = getClientIp(
    eventWith(
      () => {
        throw new Error('no address during prerender');
      },
      { 'x-forwarded-for': '127.0.0.1' }
    ),
    cfg
  );
  assertEquals(thrown, 'unknown');
  assert(!isLocalAddress(thrown)); // must NOT grant the AUTH=local bypass

  const unknown = getClientIp(eventWith('unknown', { 'x-forwarded-for': '127.0.0.1' }), cfg);
  assertEquals(unknown, 'unknown');
});

Deno.test('getClientIp: an x-real-ip from a trusted peer is honored (replace-semantics header)', () => {
  const cfg = parseTrustedProxy('203.0.113.9/32');
  const ip = getClientIp(eventWith('203.0.113.9', { 'x-real-ip': '198.51.100.4' }), cfg);
  assertEquals(ip, '198.51.100.4');
});
