import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { config } from '$config';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
import { resolveWebAuthnRp } from '$lib/server/webauthn/rp.ts';
import { webauthnChallengesQueries } from '$db/queries/webauthnChallenges.ts';
import { webauthnCredentialsQueries } from '$db/queries/webauthnCredentials.ts';
import { logger } from '$logger/logger.ts';

type ErrorResponse = { error: string };

const CHALLENGE_COOKIE = 'webauthn_challenge';

/**
 * POST /api/v1/auth/webauthn/registration/options
 *
 * Begin passkey registration for the authenticated local user. Requires AUTH=on and a real local
 * user (rejects the id=0 API-key pseudo-user and OIDC users). Stores a single-use challenge and
 * returns the WebAuthn creation options for navigator.credentials.create().
 */
export const POST: RequestHandler = async (event) => {
  if (config.authMode !== 'on') {
    return json({ error: 'Passkeys require AUTH=on' } satisfies ErrorResponse, { status: 409 });
  }

  const user = event.locals.user;
  if (!user || user.id <= 0 || user.username.startsWith('oidc:')) {
    return json({ error: 'Unauthorized' } satisfies ErrorResponse, { status: 401 });
  }

  webauthnChallengesQueries.deleteExpired();

  let rp;
  try {
    rp = resolveWebAuthnRp(event);
  } catch (error) {
    await logger.error('WebAuthn RP resolution failed (registration/options)', {
      source: 'Auth:WebAuthn',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'WebAuthn RP resolution failed' } satisfies ErrorResponse, { status: 500 });
  }

  const existing = webauthnCredentialsQueries.listByUserId(user.id);

  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userName: user.username,
    userID: new TextEncoder().encode(String(user.id)),
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({
      id: c.id,
      transports: c.transports ? (JSON.parse(c.transports) as AuthenticatorTransportFuture[]) : undefined,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  const handle = webauthnChallengesQueries.create(
    options.challenge,
    'register',
    user.id,
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
