/**
 * Pure tests for the session-transport module (issue #227). `observeSessionTransport` is a total
 * classifier over the four `SessionTransport` buckets; `resolveSessionTransport` is a fully
 * optional-chained event wrapper that must never throw (an `undefined`/`{}` event yields `unknown`);
 * `resolveCookieSecure` is the `mode × transport → boolean` truth table. No DB, no Date, no random.
 */

import { assertEquals } from '@std/assert';
import {
  observeSessionTransport,
  resolveCookieSecure,
  resolveSessionTransport,
  type SessionTransportInfo,
} from '$lib/server/security/sessionTransport.ts';
import type { CookieSecureMode, SessionTransport } from '$shared/security/types.ts';

const TRANSPORTS: readonly SessionTransport[] = ['direct-secure', 'proxy-terminated', 'insecure', 'unknown'];

function info(urlProtocol: string | null, forwardedProto: string | null): SessionTransportInfo {
  return { urlProtocol, forwardedProto };
}

Deno.test('observeSessionTransport: url https: is direct-secure regardless of forwarded proto', () => {
  assertEquals(observeSessionTransport(info('https:', null)), 'direct-secure');
  assertEquals(observeSessionTransport(info('https:', 'http')), 'direct-secure');
  assertEquals(observeSessionTransport(info('https:', 'https')), 'direct-secure');
});

Deno.test('observeSessionTransport: http url with forwarded https is proxy-terminated', () => {
  assertEquals(observeSessionTransport(info('http:', 'https')), 'proxy-terminated');
  assertEquals(observeSessionTransport(info(null, 'https')), 'proxy-terminated');
});

Deno.test('observeSessionTransport: forwarded proto is matched case-insensitively (proxy may send HTTPS)', () => {
  // A proxy emitting an uppercase/mixed-case X-Forwarded-Proto must still be graded proxy-terminated,
  // not mis-graded insecure (which would withhold the Secure cookie on an HTTPS-fronted deployment).
  assertEquals(observeSessionTransport(info('http:', 'HTTPS')), 'proxy-terminated');
  assertEquals(observeSessionTransport(info('http:', 'Https')), 'proxy-terminated');
  assertEquals(observeSessionTransport(info('HTTPS:', null)), 'direct-secure');
});

Deno.test('resolveSessionTransport: an uppercase X-Forwarded-Proto header is proxy-terminated', () => {
  assertEquals(
    resolveSessionTransport({
      url: new URL('http://praxrr.test/'),
      request: new Request('http://praxrr.test/', { headers: { 'x-forwarded-proto': 'HTTPS' } }),
    }),
    'proxy-terminated'
  );
});

Deno.test('observeSessionTransport: http url without forwarded https is insecure', () => {
  assertEquals(observeSessionTransport(info('http:', null)), 'insecure');
  assertEquals(observeSessionTransport(info('http:', 'http')), 'insecure');
});

Deno.test('observeSessionTransport: nothing observable is unknown', () => {
  assertEquals(observeSessionTransport(info(null, null)), 'unknown');
  assertEquals(observeSessionTransport(info(null, 'http')), 'unknown');
});

Deno.test('resolveSessionTransport: undefined and {} yield unknown and never throw', () => {
  assertEquals(resolveSessionTransport(undefined), 'unknown');
  assertEquals(resolveSessionTransport({}), 'unknown');
});

Deno.test('resolveSessionTransport: classifies a live url + forwarded header', () => {
  assertEquals(resolveSessionTransport({ url: new URL('https://praxrr.test/') }), 'direct-secure');
  assertEquals(resolveSessionTransport({ url: new URL('http://praxrr.test/') }), 'insecure');
  assertEquals(
    resolveSessionTransport({
      url: new URL('http://praxrr.test/'),
      request: new Request('http://praxrr.test/', { headers: { 'x-forwarded-proto': 'https' } }),
    }),
    'proxy-terminated'
  );
});

Deno.test('resolveSessionTransport: a comma-chained x-forwarded-proto uses the first token', () => {
  assertEquals(
    resolveSessionTransport({
      url: new URL('http://praxrr.test/'),
      request: new Request('http://praxrr.test/', { headers: { 'x-forwarded-proto': 'https, http' } }),
    }),
    'proxy-terminated'
  );
  // First token wins: leading http means the forwarded proto is not https, so this stays insecure.
  assertEquals(
    resolveSessionTransport({
      url: new URL('http://praxrr.test/'),
      request: new Request('http://praxrr.test/', { headers: { 'x-forwarded-proto': 'http, https' } }),
    }),
    'insecure'
  );
});

Deno.test('resolveCookieSecure: mode on is always true, mode off is always false', () => {
  for (const transport of TRANSPORTS) {
    assertEquals(resolveCookieSecure('on', transport), true, `on/${transport}`);
    assertEquals(resolveCookieSecure('off', transport), false, `off/${transport}`);
  }
});

Deno.test('resolveCookieSecure: mode auto is true only for direct-secure and proxy-terminated', () => {
  const expected: Record<SessionTransport, boolean> = {
    'direct-secure': true,
    'proxy-terminated': true,
    insecure: false,
    unknown: false,
  };
  for (const transport of TRANSPORTS) {
    assertEquals(resolveCookieSecure('auto', transport), expected[transport], `auto/${transport}`);
  }
});

Deno.test('resolveCookieSecure: full mode x transport truth table', () => {
  const modes: readonly CookieSecureMode[] = ['auto', 'on', 'off'];
  const rows: Array<[CookieSecureMode, SessionTransport, boolean]> = [];
  for (const mode of modes) {
    for (const transport of TRANSPORTS) {
      const expected =
        mode === 'on'
          ? true
          : mode === 'off'
            ? false
            : transport === 'direct-secure' || transport === 'proxy-terminated';
      rows.push([mode, transport, expected]);
    }
  }
  for (const [mode, transport, expected] of rows) {
    assertEquals(resolveCookieSecure(mode, transport), expected, `${mode}/${transport}`);
  }
});
