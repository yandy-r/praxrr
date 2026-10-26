import { redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { config } from '$config';
import {
  getDiscoveryDocument,
  exchangeCode,
  decodeIdToken,
  verifyIdToken,
  verifyIdTokenNonce,
  verifyIdTokenSignature,
} from '$auth/oidc.ts';
import { evaluateOidcAllowlist } from '$auth/oidcAllowlist.ts';
import { usersQueries, isOidcUser, OidcIdentityConflictError } from '$db/queries/users.ts';
import { sessionsQueries } from '$db/queries/sessions.ts';
import { authSettingsQueries } from '$db/queries/authSettings.ts';
import { getClientIp } from '$auth/network.ts';
import { parseUserAgent } from '$auth/userAgent.ts';
import { sessionCookieOptions } from '$auth/sessionCookie.ts';
import { oidcFlowCookieOptions } from '$auth/oidcFlowCookie.ts';
import { logger } from '$logger/logger.ts';

/**
 * GET /auth/oidc/callback
 *
 * Complete OIDC authentication callback:
 * validate state/code, exchange tokens (PKCE), verify ID token signature/claims/nonce,
 * create session, and redirect home.
 */
export const GET: RequestHandler = async (event) => {
  // OIDC callback only exists in OIDC mode; other modes get a plain 404
  if (config.authMode !== 'oidc') {
    throw error(404, 'Not found');
  }

  const { url, cookies, request } = event;

  const savedState = cookies.get('oidc_state');
  const savedNonce = cookies.get('oidc_nonce');
  const codeVerifier = cookies.get('oidc_code_verifier');

  // Get code and state from query params
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  // Handle provider errors that carry a matching state; a state-less or mismatched
  // error response leaves the in-progress attempt intact (handled below).
  if (errorParam && state && savedState && state === savedState) {
    for (const name of ['oidc_state', 'oidc_nonce', 'oidc_code_verifier']) {
      cookies.delete(name, oidcFlowCookieOptions(event));
    }
    throw error(400, `OIDC error: ${errorParam} - ${errorDescription || 'Unknown error'}`);
  }

  // Verify state (CSRF protection). On mismatch the per-attempt cookies are left
  // untouched so an unrelated callback cannot cancel the in-progress login.
  if (!state || state !== savedState) {
    const ip = getClientIp(event);
    await logger.warn('OIDC state mismatch (possible CSRF attempt)', {
      source: 'Auth:OIDC',
      meta: { ip },
    });
    throw error(400, 'Invalid state parameter');
  }

  // State matches: this attempt is consumed, so clear its cookies on every path from here.
  for (const name of ['oidc_state', 'oidc_nonce', 'oidc_code_verifier']) {
    cookies.delete(name, oidcFlowCookieOptions(event));
  }

  // The nonce and PKCE verifier set at login must still be present
  if (!savedNonce || !codeVerifier) {
    const ip = getClientIp(event);
    await logger.warn('OIDC callback is missing its nonce or PKCE verifier cookie', {
      source: 'Auth:OIDC',
      meta: { ip },
    });
    throw error(400, 'Login session expired. Please try again');
  }

  // Verify we have a code
  if (!code) {
    throw error(400, 'No authorization code provided');
  }

  // Validate OIDC configuration
  if (!config.oidc.discoveryUrl || !config.oidc.clientId || !config.oidc.clientSecret) {
    throw error(500, 'OIDC is not configured');
  }

  // Fetch discovery document (refuses non-https endpoints)
  const ip = getClientIp(event);
  let discovery;
  try {
    discovery = await getDiscoveryDocument(config.oidc.discoveryUrl);
  } catch (err) {
    await logger.error('OIDC discovery failed', {
      source: 'Auth:OIDC',
      meta: { ip, error: err instanceof Error ? err.message : String(err) },
    });
    throw error(500, 'OIDC provider is unavailable or misconfigured');
  }

  // Exchange code for tokens
  let tokens;
  try {
    tokens = await exchangeCode(discovery.token_endpoint, code, {
      clientId: config.oidc.clientId,
      clientSecret: config.oidc.clientSecret,
      redirectUri: `${config.serverUrl}/auth/oidc/callback`,
      codeVerifier,
    });
  } catch (err) {
    await logger.warn('OIDC token exchange failed', {
      source: 'Auth:OIDC',
      meta: { ip, error: err instanceof Error ? err.message : String(err) },
    });
    throw error(500, 'Failed to exchange authorization code');
  }

  // Verify the ID token signature, decode and check its claims, then bind it to this login attempt
  let claims;
  try {
    if (typeof tokens.id_token !== 'string') {
      throw new Error('Token response did not include an id_token');
    }
    await verifyIdTokenSignature(tokens.id_token, discovery.jwks_uri);
    claims = decodeIdToken(tokens.id_token);
    verifyIdToken(claims, {
      clientId: config.oidc.clientId,
      issuer: discovery.issuer,
    });
    verifyIdTokenNonce(claims, savedNonce);
  } catch (err) {
    await logger.error('OIDC ID token verification failed', {
      source: 'Auth:OIDC',
      meta: { ip, error: err instanceof Error ? err.message : String(err) },
    });
    throw error(500, 'Failed to verify ID token');
  }

  // Only operator-approved identities may obtain an account or session.
  // Evaluated before provisioning; denied identities lose prior sessions.
  const decision = evaluateOidcAllowlist(claims, config.oidc.allowlist);
  if (!decision.allowed) {
    const existing = usersQueries.getByUsername(`oidc:${claims.sub}`);
    if (existing && isOidcUser(existing)) {
      sessionsQueries.deleteByUserId(existing.id);
    }
    await logger.warn('OIDC sign-in refused: identity is not on the allowlist', {
      source: 'Auth:OIDC',
      meta: { sub: claims.sub, ip, reason: decision.reason },
    });
    throw error(403, 'This account is not permitted to sign in');
  }

  let userId: number;
  try {
    userId = usersQueries.getOrCreateOidcUser(claims.sub);
  } catch (err) {
    // A local account already owns this identifier's username: never merge identities
    if (!(err instanceof OidcIdentityConflictError)) {
      throw err;
    }
    await logger.error(`OIDC identifier '${claims.sub}' collides with a local account`, {
      source: 'Auth:OIDC',
      meta: { ip, error: err.message },
    });
    throw error(409, 'This account identifier is unavailable');
  }

  // Capture session metadata
  const ipAddress = getClientIp(event);
  const userAgent = request.headers.get('user-agent') ?? '';
  const parsed = parseUserAgent(userAgent);

  // Create session
  const durationHours = authSettingsQueries.getSessionDurationHours();
  const sessionToken = sessionsQueries.create(userId, durationHours, {
    ipAddress,
    userAgent,
    browser: parsed.browser,
    os: parsed.os,
    deviceType: parsed.deviceType,
  });

  await logger.info(`OIDC login successful for '${claims.sub}'`, {
    source: 'Auth:OIDC',
    meta: {
      sub: claims.sub,
      ip: ipAddress,
      browser: parsed.browser,
      device: parsed.deviceType,
      matchedBy: decision.matchedBy,
    },
  });

  // Set session cookie
  const expires = new Date(Date.now() + durationHours * 60 * 60 * 1000);
  cookies.set('session', sessionToken, sessionCookieOptions(event, expires));

  // Redirect to home
  throw redirect(303, '/');
};
