import type { Cookies } from '@sveltejs/kit';
import { config } from '$config';
import type { SessionRequestContext } from '$shared/security/types.ts';
import { resolveCookieSecure, resolveSessionTransport } from '$lib/server/security/sessionTransport.ts';

export const SESSION_COOKIE_HTTPONLY = true;
export const SESSION_COOKIE_SAMESITE = 'lax' as const;

/** { request, url }-shaped context — accepts a RequestEvent or a minimal slice. */
export type CookieRequestContext = SessionRequestContext;

/**
 * Single source of truth for session-cookie hardening. Resolves `Secure` from the configured
 * `PRAXRR_COOKIE_SECURE` mode and this request's observed transport, so the cookie can never
 * disagree with the session advisory that reports it.
 */
export function sessionCookieOptions(ctx: CookieRequestContext | undefined, expires: Date) {
  const secure = resolveCookieSecure(config.cookieSecureMode, resolveSessionTransport(ctx));
  return {
    path: '/',
    httpOnly: SESSION_COOKIE_HTTPONLY,
    sameSite: SESSION_COOKIE_SAMESITE,
    secure,
    expires,
  };
}

/** Options for deleting the session cookie: same hardening as setting it, minus the expiry. */
export function clearSessionCookieOptions(ctx: CookieRequestContext | undefined) {
  const { expires: _expires, ...rest } = sessionCookieOptions(ctx, new Date(0));
  return rest;
}

/** Delete the session cookie on the response using the same Secure/HttpOnly/SameSite policy. */
export function clearSessionCookie(ctx: CookieRequestContext | undefined, cookies: Cookies): void {
  cookies.delete('session', clearSessionCookieOptions(ctx));
}
