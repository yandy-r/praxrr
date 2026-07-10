/**
 * Pure tests for the trusted-proxy allowlist (issue #228): grammar + validation, real bitwise CIDR
 * containment (IPv4 u32, IPv6 bigint), fail-closed non-throwing parse, the overly-broad rule, and the
 * drift guard pinning the `private`/`loopback` keyword expansions to `isLocalAddress`. No env, no I/O.
 */

import { assert, assertEquals } from '@std/assert';
import { isTrustedProxyPeer, parseTrustedProxy } from '$shared/security/index.ts';
import { isLocalAddress } from '$auth/network.ts';

// --- parsing: literals, CIDR, prefixes --------------------------------------------------------

Deno.test('parseTrustedProxy: a bare IPv4 literal becomes a /32 range', () => {
  const cfg = parseTrustedProxy('172.18.0.2');
  assertEquals(cfg.mode, 'explicit');
  assertEquals(cfg.ranges.length, 1);
  assertEquals(cfg.ranges[0].family, 4);
  assertEquals(cfg.ranges[0].prefix, 32);
  assertEquals(cfg.invalidEntries, []);
  assertEquals(cfg.overlyBroad, false);
});

Deno.test('parseTrustedProxy: a bare IPv6 literal becomes a /128 range', () => {
  const cfg = parseTrustedProxy('::1');
  assertEquals(cfg.ranges.length, 1);
  assertEquals(cfg.ranges[0].family, 6);
  assertEquals(cfg.ranges[0].prefix, 128);
});

Deno.test('parseTrustedProxy: IPv4 + IPv6 CIDR parse at prefix boundaries /0 /32 /128', () => {
  const cfg = parseTrustedProxy('10.0.0.0/8, 0.0.0.0/0, 192.168.1.1/32, 2001:db8::/32, ::/0');
  assertEquals(cfg.invalidEntries, []);
  assertEquals(cfg.ranges.length, 5);
  assert(cfg.ranges.some((r) => r.family === 4 && r.prefix === 0));
  assert(cfg.ranges.some((r) => r.family === 4 && r.prefix === 32));
  assert(cfg.ranges.some((r) => r.family === 6 && r.prefix === 0));
});

// --- keyword expansion ------------------------------------------------------------------------

Deno.test('parseTrustedProxy: loopback expands to 127.0.0.0/8 + ::1/128 and is NOT overly broad', () => {
  const cfg = parseTrustedProxy('loopback');
  assertEquals(cfg.mode, 'explicit');
  assertEquals(cfg.ranges.length, 2);
  assertEquals(cfg.overlyBroad, false);
  assert(isTrustedProxyPeer('127.0.0.5', cfg));
  assert(isTrustedProxyPeer('::1', cfg));
  assert(!isTrustedProxyPeer('10.0.0.1', cfg));
});

Deno.test(
  'parseTrustedProxy: private expands to the RFC1918 + ULA + link-local set and IS overly broad (fc00::/7)',
  () => {
    const cfg = parseTrustedProxy('private');
    assertEquals(cfg.ranges.length, 6);
    assertEquals(cfg.overlyBroad, true); // fc00::/7 has prefix 7 <= 7
    assert(isTrustedProxyPeer('10.1.2.3', cfg));
    assert(isTrustedProxyPeer('172.20.0.1', cfg));
    assert(isTrustedProxyPeer('192.168.1.1', cfg));
  }
);

// --- wildcard + overly broad ------------------------------------------------------------------

Deno.test('parseTrustedProxy: * and all set wildcard + overlyBroad and trust every peer', () => {
  for (const raw of ['*', 'all', 'ALL']) {
    const cfg = parseTrustedProxy(raw);
    assertEquals(cfg.mode, 'wildcard', `mode for ${raw}`);
    assertEquals(cfg.wildcard, true);
    assertEquals(cfg.overlyBroad, true);
    assert(isTrustedProxyPeer('8.8.8.8', cfg));
    assert(isTrustedProxyPeer('2001:db8::1', cfg));
  }
});

Deno.test('parseTrustedProxy: 0.0.0.0/0 and ::/0 and a <= /7 supernet are overly broad; /8 is not', () => {
  assertEquals(parseTrustedProxy('0.0.0.0/0').overlyBroad, true);
  assertEquals(parseTrustedProxy('::/0').overlyBroad, true);
  // The split-/1 internet trick.
  assertEquals(parseTrustedProxy('0.0.0.0/1, 128.0.0.0/1').overlyBroad, true);
  // Legit operator supernets are spared.
  assertEquals(parseTrustedProxy('10.0.0.0/8').overlyBroad, false);
  assertEquals(parseTrustedProxy('172.16.0.0/12').overlyBroad, false);
});

// --- malformed tokens: fail-closed, non-throwing ----------------------------------------------

Deno.test('parseTrustedProxy: malformed tokens are dropped into invalidEntries, never into ranges (no throw)', () => {
  const cfg = parseTrustedProxy('10.0.0.0/8, 999.0.0.0/8, 10.0.0.0/33, fe80::1%eth0, garbage, 2001:db8::/129');
  assertEquals(cfg.ranges.length, 1); // only 10.0.0.0/8 survives
  assertEquals(cfg.ranges[0].family, 4);
  assertEquals(
    new Set(cfg.invalidEntries),
    new Set(['999.0.0.0/8', '10.0.0.0/33', 'fe80::1%eth0', 'garbage', '2001:db8::/129'])
  );
});

Deno.test('parseTrustedProxy: a wholly-invalid value behaves exactly like unset (no ranges, trust nobody)', () => {
  const cfg = parseTrustedProxy('garbage, 999.999.999.999');
  assertEquals(cfg.ranges.length, 0);
  assert(cfg.invalidEntries.length > 0);
  assert(!isTrustedProxyPeer('10.0.0.1', cfg));
  assert(!isTrustedProxyPeer('127.0.0.1', cfg));
});

Deno.test('parseTrustedProxy: unset / empty / whitespace / lone separators are mode unset', () => {
  for (const raw of [null, undefined, '', '   ', ',', ' , , ']) {
    const cfg = parseTrustedProxy(raw as string | null | undefined);
    assertEquals(cfg.mode, 'unset', `mode for ${JSON.stringify(raw)}`);
    assertEquals(cfg.ranges.length, 0);
    assertEquals(cfg.wildcard, false);
  }
});

Deno.test('parseTrustedProxy: empty tokens between separators are skipped and never coerced to wildcard', () => {
  const cfg = parseTrustedProxy('10.0.0.0/8,, ,10.0.0.1');
  assertEquals(cfg.mode, 'explicit'); // NOT wildcard
  assertEquals(cfg.wildcard, false);
  assertEquals(cfg.invalidEntries, []);
  assertEquals(cfg.ranges.length, 2);
});

// --- containment: bitwise correctness ---------------------------------------------------------

Deno.test('isTrustedProxyPeer: unset trusts nobody; wildcard trusts everyone', () => {
  assert(!isTrustedProxyPeer('127.0.0.1', parseTrustedProxy(null)));
  assert(isTrustedProxyPeer('203.0.113.9', parseTrustedProxy('*')));
});

Deno.test('isTrustedProxyPeer: IPv4 containment is exact at CIDR boundaries', () => {
  const cfg = parseTrustedProxy('172.16.0.0/12');
  assert(isTrustedProxyPeer('172.16.0.0', cfg));
  assert(isTrustedProxyPeer('172.31.255.255', cfg));
  assert(!isTrustedProxyPeer('172.15.255.255', cfg));
  assert(!isTrustedProxyPeer('172.32.0.0', cfg));
});

Deno.test('isTrustedProxyPeer: IPv6 containment is exact', () => {
  const cfg = parseTrustedProxy('2001:db8::/32');
  assert(isTrustedProxyPeer('2001:db8::1', cfg));
  assert(isTrustedProxyPeer('2001:db8:ffff:ffff::1', cfg));
  assert(!isTrustedProxyPeer('2001:db9::1', cfg));
});

Deno.test('isTrustedProxyPeer: an IPv4-mapped IPv6 peer matches a v4 range', () => {
  const cfg = parseTrustedProxy('10.0.0.0/8');
  assert(isTrustedProxyPeer('::ffff:10.0.0.5', cfg));
  assert(isTrustedProxyPeer('[::ffff:10.0.0.5]', cfg));
});

Deno.test('isTrustedProxyPeer: an unparseable peer is not trusted (fail closed)', () => {
  const cfg = parseTrustedProxy('10.0.0.0/8, ::1');
  assert(!isTrustedProxyPeer('not-an-ip', cfg));
  assert(!isTrustedProxyPeer('', cfg));
  assert(!isTrustedProxyPeer('fe80::1%eth0', cfg)); // zone id rejected
});

Deno.test('isTrustedProxyPeer: a v4 peer never matches a v6 range and vice versa', () => {
  assert(!isTrustedProxyPeer('10.0.0.1', parseTrustedProxy('::/0')));
  assert(!isTrustedProxyPeer('2001:db8::1', parseTrustedProxy('0.0.0.0/0')));
});

// --- drift guard: keyword expansions vs the isLocalAddress heuristic ---------------------------

Deno.test('drift guard: private+loopback expansion matches isLocalAddress for the RFC1918/loopback canon', () => {
  // If a future edit diverges the trust allowlist's local/private encoding from the AUTH=local bypass
  // classifier, this fails — catching silent drift the scope decision to leave the duplicate constants
  // in place would otherwise allow.
  const cfg = parseTrustedProxy('private loopback');
  const sample = ['10.0.0.5', '172.20.1.1', '192.168.1.1', '169.254.0.1', '127.0.0.1', '::1', 'fe80::1', 'fc00::1'];
  for (const ip of sample) {
    assertEquals(isTrustedProxyPeer(ip, cfg), isLocalAddress(ip), `drift at ${ip}`);
  }
});
