import { sessionCookieOptions } from '$auth/sessionCookie.ts';
import type { SessionRequestContext } from '$shared/security/types.ts';

/**
 * Options for the short-lived OIDC flow cookies (state, nonce, PKCE verifier). Secure follows the
 * session cookie policy for this request. Setters add a lifetime; deletions use the same options
 * without one so the browser matches and clears the cookie that was set.
 */
export function oidcFlowCookieOptions(ctx: SessionRequestContext | undefined) {
  const { secure } = sessionCookieOptions(ctx, new Date());
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
  };
}
