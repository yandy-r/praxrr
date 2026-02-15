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
import { logger } from '$logger/logger.ts';

/**
 * Auth state returned by getAuthState
 */
export interface AuthState {
  needsSetup: boolean;
  user: User | null;
  session: Session | null;
  skipAuth: boolean; // true when AUTH=off or AUTH=local+local IP
}

/**
 * Paths that don't require authentication
 */
const PUBLIC_PATHS = ['/auth/login', '/auth/setup', '/auth/oidc', '/api/v1/health'];

/**
 * Check if a path is public (doesn't require auth)
 */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

/**
 * Get auth state from request
 * Checks auth mode, API key, and session cookie
 */
export function getAuthState(event: RequestEvent): AuthState {
  const hasLocalUsers = usersQueries.existsLocal();

  // AUTH=off - skip all auth (trust external proxy like Authelia/Authentik)
  if (config.authMode === 'off') {
    return {
      needsSetup: false,
      user: null,
      session: null,
      skipAuth: true,
    };
  }

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
      };
    }
  }

  // AUTH=oidc - uses sessions but no local user/password
  if (config.authMode === 'oidc') {
    const sessionId = event.cookies.get('session');
    const session = sessionId ? (sessionsQueries.getValidById(sessionId) ?? null) : null;
    const user = session ? (usersQueries.getById(session.user_id) ?? null) : null;

    return {
      needsSetup: false, // No setup needed for OIDC
      user,
      session,
      skipAuth: false,
    };
  }

  // AUTH=on (default) - full username/password auth

  // Check API key (header or query param)
  const apiKey = event.request.headers.get('X-Api-Key') || event.url.searchParams.get('apikey');
  if (apiKey) {
    const ip = getClientIp(event);
    const endpoint = event.url.pathname;

    if (authSettingsQueries.validateApiKey(apiKey)) {
      void logger.info('API key authenticated', {
        source: 'Auth:APIKey',
        meta: { ip, endpoint },
      });
      return {
        needsSetup: false,
        user: { id: 0, username: 'api' } as User,
        session: null,
        skipAuth: false,
      };
    } else {
      // Mask API key - only show last 4 chars
      const maskedKey = apiKey.length > 4 ? `****${apiKey.slice(-4)}` : '****';
      void logger.warn('Invalid API key', {
        source: 'Auth:APIKey',
        meta: { ip, endpoint, key: maskedKey },
      });
    }
  }

  // Check session cookie
  const sessionId = event.cookies.get('session');
  const session = sessionId ? (sessionsQueries.getValidById(sessionId) ?? null) : null;
  const user = session ? (usersQueries.getById(session.user_id) ?? null) : null;

  return {
    needsSetup: !hasLocalUsers,
    user,
    session,
    skipAuth: false,
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
