import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { config } from '$config';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { resolveWebAuthnRp } from '$lib/server/webauthn/rp.ts';
import { webauthnChallengesQueries } from '$db/queries/webauthnChallenges.ts';
import { webauthnCredentialsQueries } from '$db/queries/webauthnCredentials.ts';
import { defaultCredentialName, toCredentialSummary } from '$lib/server/webauthn/ceremonies.ts';
import { logger } from '$logger/logger.ts';

type ErrorResponse = { error: string };

const CHALLENGE_COOKIE = 'webauthn_challenge';
const MAX_NAME_LENGTH = 100;

/**
 * POST /api/v1/auth/webauthn/registration/verify
 *
 * Complete passkey registration: consume the single-use challenge, verify the attestation, and
 * persist the credential for the authenticated local user. Requires AUTH=on + a real local user.
 */
export const POST: RequestHandler = async (event) => {
  if (config.authMode !== 'on') {
    return json({ error: 'Passkeys require AUTH=on' } satisfies ErrorResponse, { status: 409 });
  }

  const user = event.locals.user;
  if (!user || user.id <= 0 || user.username.startsWith('oidc:')) {
    return json({ error: 'Unauthorized' } satisfies ErrorResponse, { status: 401 });
  }

  const handle = event.cookies.get(CHALLENGE_COOKIE);
  event.cookies.delete(CHALLENGE_COOKIE, { path: '/' });
  if (!handle) {
    return json({ error: 'Challenge expired or not found' } satisfies ErrorResponse, { status: 400 });
  }

  let body: { response?: RegistrationResponseJSON; name?: string };
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'Invalid request body' } satisfies ErrorResponse, { status: 400 });
  }
  if (!body?.response) {
    return json({ error: 'Missing registration response' } satisfies ErrorResponse, { status: 400 });
  }

  const consumed = webauthnChallengesQueries.consume(handle, 'register');
  if (!consumed) {
    return json({ error: 'Challenge expired or not found' } satisfies ErrorResponse, { status: 400 });
  }

  let rp;
  try {
    rp = resolveWebAuthnRp(event);
  } catch (error) {
    await logger.error('WebAuthn RP resolution failed (registration/verify)', {
      source: 'Auth:WebAuthn',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'WebAuthn RP resolution failed' } satisfies ErrorResponse, { status: 500 });
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: consumed.challenge,
      expectedOrigin: rp.allowedOrigins,
      expectedRPID: rp.rpID,
      requireUserVerification: false,
    });
  } catch (error) {
    await logger.warn('Passkey registration verification failed', {
      source: 'Auth:WebAuthn',
      meta: { username: user.username, error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Registration verification failed' } satisfies ErrorResponse, { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return json({ error: 'Registration could not be verified' } satisfies ErrorResponse, { status: 400 });
  }

  const { credential, credentialDeviceType, credentialBackedUp, aaguid } = verification.registrationInfo;

  if (body.name !== undefined && typeof body.name !== 'string') {
    return json({ error: 'Invalid name' } satisfies ErrorResponse, { status: 400 });
  }
  const requestedName = (body.name ?? '').trim();
  const name = requestedName || defaultCredentialName(event.request.headers.get('user-agent') ?? '');
  if (name.length > MAX_NAME_LENGTH) {
    return json({ error: `Name must be ${MAX_NAME_LENGTH} characters or fewer` } satisfies ErrorResponse, {
      status: 400,
    });
  }
  if (webauthnCredentialsQueries.existsByNameForUser(user.id, name)) {
    return json({ error: `A passkey named "${name}" already exists` } satisfies ErrorResponse, { status: 409 });
  }

  const webauthnUserId = isoBase64URL.fromBuffer(new TextEncoder().encode(String(user.id)));

  let row;
  try {
    row = webauthnCredentialsQueries.create({
      id: credential.id,
      userId: user.id,
      publicKey: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? null,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      webauthnUserId,
      aaguid: aaguid || null,
      name,
    });
  } catch (error) {
    // UNIQUE(id) — the same authenticator is already registered.
    await logger.warn('Passkey already registered', {
      source: 'Auth:WebAuthn',
      meta: { username: user.username, error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'This passkey is already registered' } satisfies ErrorResponse, { status: 409 });
  }

  await logger.info(`Passkey '${name}' registered for '${user.username}'`, {
    source: 'Auth:WebAuthn',
    meta: { username: user.username, credentialId: credential.id.slice(0, 8) + '...' },
  });

  return json({ verified: true, credential: toCredentialSummary(row) });
};
