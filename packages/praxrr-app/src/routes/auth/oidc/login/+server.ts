import { redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { config } from '$config';
import {
  getDiscoveryDocument,
  generateState,
  generateNonce,
  generateCodeVerifier,
  codeChallengeS256,
  buildAuthorizationUrl,
} from '$auth/oidc.ts';
import { oidcFlowCookieOptions } from '$auth/oidcFlowCookie.ts';
import { getClientIp } from '$auth/network.ts';
import { logger } from '$logger/logger.ts';

/**
 * GET /auth/oidc/login
 *
 * Start the OIDC login flow:
 * validate configuration, generate state/nonce/PKCE verifier, and redirect to the provider authorization URL.
 */
export const GET: RequestHandler = async (event) => {
  const { cookies } = event;
  const ip = getClientIp(event);

  // Validate OIDC configuration
  if (config.authMode !== 'oidc') {
    throw error(404, 'Not found');
  }

  if (!config.oidc.discoveryUrl || !config.oidc.clientId || !config.oidc.clientSecret) {
    const missing = [
      !config.oidc.discoveryUrl && 'OIDC_DISCOVERY_URL',
      !config.oidc.clientId && 'OIDC_CLIENT_ID',
      !config.oidc.clientSecret && 'OIDC_CLIENT_SECRET',
    ].filter(Boolean);

    await logger.error(`OIDC config missing: ${missing.join(', ')}`, {
      source: 'Auth:OIDC',
      meta: { missing },
    });
    throw error(500, 'OIDC is not configured. Set OIDC_DISCOVERY_URL, OIDC_CLIENT_ID, and OIDC_CLIENT_SECRET');
  }

  await logger.debug('OIDC flow started', {
    source: 'Auth:OIDC',
    meta: { ip },
  });

  // Fetch discovery document (refuses non-https endpoints)
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

  // Per-attempt secrets: CSRF state, ID-token nonce, and PKCE verifier
  const state = generateState();
  const nonce = generateNonce();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await codeChallengeS256(codeVerifier);

  // Store them in short-lived httpOnly cookies (10 minute expiry)
  const cookieOptions = { ...oidcFlowCookieOptions(event), maxAge: 60 * 10 };
  cookies.set('oidc_state', state, cookieOptions);
  cookies.set('oidc_nonce', nonce, cookieOptions);
  cookies.set('oidc_code_verifier', codeVerifier, cookieOptions);

  // Build authorization URL and redirect
  const authUrl = buildAuthorizationUrl(discovery.authorization_endpoint, {
    clientId: config.oidc.clientId,
    redirectUri: `${config.serverUrl}/auth/oidc/callback`,
    state,
    nonce,
    codeChallenge,
  });

  throw redirect(302, authUrl);
};
