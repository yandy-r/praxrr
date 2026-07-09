import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { config } from '$config';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { resolveWebAuthnRp } from '$lib/server/webauthn/rp.ts';
import { webauthnChallengesQueries } from '$db/queries/webauthnChallenges.ts';
import { logger } from '$logger/logger.ts';

type ErrorResponse = { error: string };

const CHALLENGE_COOKIE = 'webauthn_challenge';

/**
 * POST /api/v1/auth/webauthn/authentication/options
 *
 * Begin passwordless passkey login. Public (pre-login) but only under AUTH=on. Uses discoverable
 * credentials (allowCredentials omitted) for a one-tap, usernameless login, and stores a
 * single-use challenge.
 */
export const POST: RequestHandler = async (event) => {
  if (config.authMode !== 'on') {
    return json({ error: 'Passkeys require AUTH=on' } satisfies ErrorResponse, { status: 409 });
  }

  webauthnChallengesQueries.deleteExpired();

  let rp;
  try {
    rp = resolveWebAuthnRp(event);
  } catch (error) {
    await logger.error('WebAuthn RP resolution failed (authentication/options)', {
      source: 'Auth:WebAuthn',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'WebAuthn RP resolution failed' } satisfies ErrorResponse, { status: 500 });
  }

  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    userVerification: 'preferred',
  });

  const handle = webauthnChallengesQueries.create(
    options.challenge,
    'authenticate',
    null,
    config.webauthnChallengeTtlSeconds
  );
  event.cookies.set(CHALLENGE_COOKIE, handle, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: config.webauthnChallengeTtlSeconds,
  });

  return json({ options });
};
