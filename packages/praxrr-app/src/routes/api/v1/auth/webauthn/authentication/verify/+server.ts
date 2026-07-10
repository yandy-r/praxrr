import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { config } from '$config';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, AuthenticatorTransportFuture } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { resolveWebAuthnRp } from '$lib/server/webauthn/rp.ts';
import { webauthnChallengesQueries } from '$db/queries/webauthnChallenges.ts';
import { webauthnCredentialsQueries } from '$db/queries/webauthnCredentials.ts';
import { isCounterRegression } from '$lib/server/webauthn/ceremonies.ts';
import { usersQueries } from '$db/queries/users.ts';
import { sessionsQueries } from '$db/queries/sessions.ts';
import { authSettingsQueries } from '$db/queries/authSettings.ts';
import { parseUserAgent } from '$auth/userAgent.ts';
import { getClientIp } from '$auth/network.ts';
import { sessionCookieOptions } from '$auth/sessionCookie.ts';
import { logger } from '$logger/logger.ts';

type ErrorResponse = { error: string };

const CHALLENGE_COOKIE = 'webauthn_challenge';

/**
 * POST /api/v1/auth/webauthn/authentication/verify
 *
 * Complete passwordless passkey login: consume the challenge, look up the asserted credential,
 * verify the assertion, guard against counter regression (cloned authenticator), then mint a
 * session cookie using the exact same contract as password login. Public but AUTH=on only.
 */
export const POST: RequestHandler = async (event) => {
  if (config.authMode !== 'on') {
    return json({ error: 'Passkeys require AUTH=on' } satisfies ErrorResponse, { status: 409 });
  }

  const handle = event.cookies.get(CHALLENGE_COOKIE);
  event.cookies.delete(CHALLENGE_COOKIE, { path: '/' });
  if (!handle) {
    return json({ error: 'Challenge expired or not found' } satisfies ErrorResponse, { status: 400 });
  }

  let body: { response?: AuthenticationResponseJSON };
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'Invalid request body' } satisfies ErrorResponse, { status: 400 });
  }
  if (!body?.response?.id) {
    return json({ error: 'Missing authentication response' } satisfies ErrorResponse, { status: 400 });
  }

  const consumed = webauthnChallengesQueries.consume(handle, 'authenticate');
  if (!consumed) {
    return json({ error: 'Challenge expired or not found' } satisfies ErrorResponse, { status: 400 });
  }

  const credential = webauthnCredentialsQueries.getById(body.response.id);
  if (!credential) {
    return json({ error: 'Passkey not recognized' } satisfies ErrorResponse, { status: 400 });
  }

  let rp;
  try {
    rp = resolveWebAuthnRp(event);
  } catch (error) {
    await logger.error('WebAuthn RP resolution failed (authentication/verify)', {
      source: 'Auth:WebAuthn',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'WebAuthn RP resolution failed' } satisfies ErrorResponse, { status: 500 });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: consumed.challenge,
      expectedOrigin: rp.allowedOrigins,
      expectedRPID: rp.rpID,
      credential: {
        id: credential.id,
        publicKey: isoBase64URL.toBuffer(credential.public_key),
        counter: credential.counter,
        transports: credential.transports
          ? (JSON.parse(credential.transports) as AuthenticatorTransportFuture[])
          : undefined,
      },
      requireUserVerification: false,
    });
  } catch (error) {
    await logger.warn('Passkey authentication verification failed', {
      source: 'Auth:WebAuthn',
      meta: { credentialId: credential.id.slice(0, 8) + '...', error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Authentication verification failed' } satisfies ErrorResponse, { status: 400 });
  }

  if (!verification.verified) {
    return json({ error: 'Authentication could not be verified' } satisfies ErrorResponse, { status: 400 });
  }

  const { newCounter } = verification.authenticationInfo;
  if (isCounterRegression(newCounter, credential.counter)) {
    await logger.warn('Passkey counter regression — possible cloned authenticator, login rejected', {
      source: 'Auth:WebAuthn',
      meta: { credentialId: credential.id.slice(0, 8) + '...', newCounter, storedCounter: credential.counter },
    });
    return json({ error: 'Authentication rejected' } satisfies ErrorResponse, { status: 400 });
  }

  webauthnCredentialsQueries.updateCounter(credential.id, newCounter);

  const userRow = usersQueries.getById(credential.user_id);
  if (!userRow) {
    return json({ error: 'Account not found' } satisfies ErrorResponse, { status: 400 });
  }

  // Mint a session exactly like password login (same cookie contract → indistinguishable downstream).
  const ipAddress = getClientIp(event);
  const userAgent = event.request.headers.get('user-agent') ?? '';
  const parsed = parseUserAgent(userAgent);
  const durationHours = authSettingsQueries.getSessionDurationHours();
  const sessionId = sessionsQueries.create(userRow.id, durationHours, {
    ipAddress,
    userAgent,
    browser: parsed.browser,
    os: parsed.os,
    deviceType: parsed.deviceType,
  });
  const expires = new Date(Date.now() + durationHours * 60 * 60 * 1000);
  event.cookies.set('session', sessionId, sessionCookieOptions(event, expires));

  await logger.info(`Passkey login successful for '${userRow.username}'`, {
    source: 'Auth:WebAuthn',
    meta: { username: userRow.username, ip: ipAddress, browser: parsed.browser, device: parsed.deviceType },
  });

  return json({ verified: true });
};
