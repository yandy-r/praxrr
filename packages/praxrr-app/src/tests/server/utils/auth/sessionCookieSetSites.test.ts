/**
 * Wiring-regression guard for the #227 session-hardening deliverable (issue #227).
 *
 * `sessionCookieOptions` is exhaustively unit-tested, but nothing otherwise pins that each of the four
 * session-cookie set-sites actually ADOPTS it. A revert to a hardcoded `{ ...secure: false }` literal
 * at any one site would ship a non-Secure session cookie over HTTPS while the helper's own tests stay
 * green. This source-level guard asserts every set-site mints the `session` cookie via the shared
 * helper and hardcodes no `secure:` flag — the exact regression the hardening prevents.
 */

import { assert } from '@std/assert';

/** The four routes that mint the `session` cookie (logout only deletes it — Secure-independent). */
const SET_SITES = [
  '../../../../routes/auth/login/+page.server.ts',
  '../../../../routes/auth/setup/+page.server.ts',
  '../../../../routes/auth/oidc/callback/+server.ts',
  '../../../../routes/api/v1/auth/webauthn/authentication/verify/+server.ts',
] as const;

for (const relative of SET_SITES) {
  Deno.test(`session set-site mints the cookie via sessionCookieOptions: ${relative}`, async () => {
    const source = await Deno.readTextFile(new URL(relative, import.meta.url));

    // The session cookie is set through the shared helper (single source of truth for Secure).
    assert(
      source.includes("cookies.set('session'") || source.includes('cookies.set("session"'),
      `${relative} no longer sets the 'session' cookie — update this guard if the flow moved`
    );
    assert(
      source.includes('sessionCookieOptions(event, expires)'),
      `${relative} must pass sessionCookieOptions(event, expires) to cookies.set('session', ...)`
    );
    // And never re-introduces a hardcoded transport flag that would bypass the helper.
    assert(
      !/secure:\s*(true|false)/.test(source),
      `${relative} must not hardcode a cookie 'secure:' flag — resolve it via sessionCookieOptions`
    );
  });
}
