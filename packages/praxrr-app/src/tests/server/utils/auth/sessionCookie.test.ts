/**
 * Tests for the shared session-cookie options helper (issue #227). `sessionCookieOptions` is the
 * single source of truth for cookie hardening: it always emits the canonical
 * `{ path, httpOnly, sameSite, secure, expires }` field set, with `secure` resolved from the
 * configured `PRAXRR_COOKIE_SECURE` mode and this request's observed transport. The mode is read
 * from the `config` singleton, so each case pins `config.cookieSecureMode` and restores it after.
 */

import { assertEquals } from '@std/assert';
import { config } from '$config';
import {
  SESSION_COOKIE_HTTPONLY,
  SESSION_COOKIE_SAMESITE,
  sessionCookieOptions,
  type CookieRequestContext,
} from '$auth/sessionCookie.ts';
import type { CookieSecureMode } from '$shared/security/types.ts';

const EXPIRES = new Date('2026-07-10T00:00:00.000Z');

const DIRECT_SECURE: CookieRequestContext = { url: new URL('https://praxrr.test/') };
const INSECURE: CookieRequestContext = { url: new URL('http://praxrr.test/') };
const PROXY_TERMINATED: CookieRequestContext = {
  url: new URL('http://praxrr.test/'),
  request: new Request('http://praxrr.test/', { headers: { 'x-forwarded-proto': 'https' } }),
};
const UNKNOWN: CookieRequestContext = {};

/** Pin `config.cookieSecureMode` for the duration of `fn`, then restore it (readonly at compile time only). */
function withMode<T>(mode: CookieSecureMode, fn: () => T): T {
  const target = config as unknown as { cookieSecureMode: CookieSecureMode };
  const original = target.cookieSecureMode;
  target.cookieSecureMode = mode;
  try {
    return fn();
  } finally {
    target.cookieSecureMode = original;
  }
}

Deno.test('sessionCookie: exported constants are HttpOnly + SameSite=Lax', () => {
  assertEquals(SESSION_COOKIE_HTTPONLY, true);
  assertEquals(SESSION_COOKIE_SAMESITE, 'lax');
});

Deno.test('sessionCookieOptions: canonical field set with secure resolved from mode + transport', () => {
  withMode('auto', () => {
    assertEquals(sessionCookieOptions(UNKNOWN, EXPIRES), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      expires: EXPIRES,
    });
  });
});

Deno.test('sessionCookieOptions: mode on is always secure regardless of transport', () => {
  withMode('on', () => {
    for (const ctx of [DIRECT_SECURE, PROXY_TERMINATED, INSECURE, UNKNOWN]) {
      assertEquals(sessionCookieOptions(ctx, EXPIRES).secure, true);
    }
  });
});

Deno.test('sessionCookieOptions: mode off is never secure regardless of transport', () => {
  withMode('off', () => {
    for (const ctx of [DIRECT_SECURE, PROXY_TERMINATED, INSECURE, UNKNOWN]) {
      assertEquals(sessionCookieOptions(ctx, EXPIRES).secure, false);
    }
  });
});

Deno.test('sessionCookieOptions: mode auto is secure only over direct-secure / proxy-terminated', () => {
  withMode('auto', () => {
    assertEquals(sessionCookieOptions(DIRECT_SECURE, EXPIRES).secure, true);
    assertEquals(sessionCookieOptions(PROXY_TERMINATED, EXPIRES).secure, true);
    assertEquals(sessionCookieOptions(INSECURE, EXPIRES).secure, false);
    assertEquals(sessionCookieOptions(UNKNOWN, EXPIRES).secure, false);
  });
});

Deno.test('sessionCookieOptions: non-secure fields stay canonical across every mode', () => {
  for (const mode of ['auto', 'on', 'off'] as const) {
    withMode(mode, () => {
      const opts = sessionCookieOptions(DIRECT_SECURE, EXPIRES);
      assertEquals(opts.path, '/');
      assertEquals(opts.httpOnly, true);
      assertEquals(opts.sameSite, 'lax');
      assertEquals(opts.expires, EXPIRES);
      assertEquals(Object.keys(opts).sort(), ['expires', 'httpOnly', 'path', 'sameSite', 'secure']);
    });
  }
});
