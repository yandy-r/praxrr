/**
 * Auth middleware utilities
 * Core auth logic - keeps hooks.server.ts thin
 */

import type { RequestEvent } from '@sveltejs/kit';
import { config } from '$config';
import { usersQueries, type User } from '$db/queries/users.ts';
import { sessionsQueries, type Session } from '$db/queries/sessions.ts';
import { authSettingsQueries } from '$db/queries/authSettings.ts';
import { isLocalAddress, getClientIp } from './network.ts';
import { resolveApiToken } from './apiTokens.ts';
import type { AuthPrincipal } from './principal.ts';
import { API_TOKEN_SCOPES } from '$shared/auth/apiTokenScopes.ts';
import { logger } from '$logger/logger.ts';

/**
 * Auth state returned by getAuthState
 */
export interface AuthState {
  needsSetup: boolean;
  user: User | null;
  session: Session | null;
  skipAuth: boolean; // true when AUTH=off or AUTH=local+local IP
  principal: AuthPrincipal | null; // null when unauthenticated
}

const BYPASS_PRINCIPAL: AuthPrincipal = { kind: 'bypass', scopes: API_TOKEN_SCOPES };
const SESSION_PRINCIPAL: AuthPrincipal = { kind: 'session', scopes: API_TOKEN_SCOPES };

/**
 * Paths that don't require authentication
 */
const PUBLIC_PATHS = [
  '/auth/login',
  '/auth/setup',
  '/auth/oidc',
  '/api/v1/health',
  // Passkey authentication ceremony (pre-login, discoverable credentials). Only the
  // /authentication/* endpoints are public; /registration/* stays session-gated.
  '/api/v1/auth/webauthn/authentication',
];

/**
 * Check if a path is public (doesn't require auth)
 */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

/**
 * Resolve an API token presented on an `/api/v1/` request (X-Api-Key header or `apikey` query
 * param). Tokens never authenticate page routes, form actions, or legacy non-v1 `/api/*` routes
 * (those include backup downloads, which carry session data). Returns null when no token was
 * presented or it is invalid/revoked/expired (the caller then falls through to session auth).
 */
function authenticateApiToken(event: RequestEvent): AuthState | null {
  if (!event.url.pathname.startsWith('/api/v1/')) return null;

  const presented = event.request.headers.get('X-Api-Key') || event.url.searchParams.get('apikey');
  if (!presented) return null;

  const ip = getClientIp(event);
  const endpoint = event.url.pathname;
  const token = resolveApiToken(presented);
  if (!token) {
    // Mask API key - only show last 4 chars
    const maskedKey = presented.length > 4 ? `****${presented.slice(-4)}` : '****';
    void logger.warn('Invalid API token', {
      source: 'Auth:APIKey',
      meta: { ip, endpoint, key: maskedKey },
    });
    return null;
  }

  void logger.info('API token authenticated', {
    source: 'Auth:APIKey',
    meta: { ip, endpoint, tokenName: token.name, legacy: token.isLegacy },
  });
  return {
    needsSetup: false,
    // Synthetic API user: id 0 keeps existing `id <= 0` "not a real user" checks working.
    user: { id: 0, username: 'api' } as User,
    session: null,
    skipAuth: false,
    principal: {
      kind: 'token',
      tokenId: token.id,
      tokenName: token.name,
      isLegacy: token.isLegacy,
      scopes: token.scopes,
    },
  };
}

/**
 * Get auth state from request
 * Order: AUTH=off bypass → AUTH=local local-IP bypass → API token (any authenticating mode,
 * `/api/v1/` paths only) → session cookie (oidc or on/local-remote).
 */
export function getAuthState(event: RequestEvent): AuthState {
  // AUTH=off - skip all auth (trust external proxy like Authelia/Authentik)
  if (config.authMode === 'off') {
    return {
      needsSetup: false,
      user: null,
      session: null,
      skipAuth: true,
      principal: BYPASS_PRINCIPAL,
    };
  }

  const hasLocalUsers = usersQueries.existsLocal();

  // AUTH=local - skip auth for local IPs
  if (config.authMode === 'local') {
    const clientIp = getClientIp(event);
    if (isLocalAddress(clientIp)) {
      void logger.debug('Local IP bypass', {
        source: 'Auth',
        meta: { ip: clientIp },
      });
      return {
        needsSetup: !hasLocalUsers,
        user: null,
        session: null,
        skipAuth: true,
        principal: BYPASS_PRINCIPAL,
      };
    }
  }

  // API token (header or query param) - every authenticating mode, including oidc (YAN-441)
  const tokenState = authenticateApiToken(event);
  if (tokenState) return tokenState;

  // Session cookie (oidc: no local user/password; on/local-remote: username/password)
  const sessionId = event.cookies.get('session');
  const session = sessionId ? (sessionsQueries.getValidById(sessionId) ?? null) : null;
  const user = session ? (usersQueries.getById(session.user_id) ?? null) : null;

  return {
    needsSetup: config.authMode === 'oidc' ? false : !hasLocalUsers, // No setup needed for OIDC
    user,
    session,
    skipAuth: false,
    principal: user ? SESSION_PRINCIPAL : null,
  };
}

/**
 * Sliding expiration: extend session if past halfway point
 * Avoids DB write on every request while keeping active users logged in
 */
export function maybeExtendSession(session: Session): void {
  const durationHours = authSettingsQueries.getSessionDurationHours();
  const expiresAt = new Date(session.expires_at).getTime();
  const now = Date.now();
  const halfDuration = (durationHours * 60 * 60 * 1000) / 2;

  // Only extend if less than half the duration remains
  if (expiresAt - now < halfDuration) {
    sessionsQueries.extendExpiration(session.id, durationHours);
    void logger.debug('Session extended', {
      source: 'Auth:Session',
      meta: { userId: session.user_id },
    });
  }
}

/**
 * Clean expired sessions - call on startup
 */
export function cleanupExpiredSessions(): number {
  return sessionsQueries.deleteExpired();
}
