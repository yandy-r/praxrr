import type { Actions, ServerLoad } from '@sveltejs/kit';
import { fail } from '@sveltejs/kit';
import { usersQueries } from '$db/queries/users.ts';
import { sessionsQueries } from '$db/queries/sessions.ts';
import { apiTokensQueries } from '$db/queries/apiTokens.ts';
import { ApiTokenValidationError, createApiToken } from '$auth/apiTokens.ts';
import type { ApiTokenSummary } from '$shared/auth/apiTokenScopes.ts';
import { hashPassword, verifyPassword } from '$auth/password.ts';
import { logger } from '$logger/logger.ts';
import { config } from '$config';
import { webauthnCredentialsQueries } from '$db/queries/webauthnCredentials.ts';
import { toCredentialSummary } from '$lib/server/webauthn/ceremonies.ts';

const PUBLIC_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Trusted live principal for personal session/password actions. Requires a real user (no bypass,
 * no API-key id 0), a session cookie principal that matches the user, and the session row still
 * being valid in the DB. Never reads the cookie value from `cookies`.
 */
function getSessionPrincipal(locals: App.Locals): { user: NonNullable<App.Locals['user']>; sessionId: string } | null {
  if (locals.authBypass || !locals.user || locals.user.id <= 0 || !locals.session) {
    return null;
  }
  if (locals.session.user_id !== locals.user.id) {
    return null;
  }
  const session = sessionsQueries.getValidById(locals.session.id);
  if (!session || session.user_id !== locals.user.id) {
    return null;
  }
  return { user: locals.user, sessionId: locals.session.id };
}

/** Token management needs an interactive principal (a signed-in session or an auth bypass). */
function canManageApiTokens(locals: App.Locals): boolean {
  const kind = locals.principal?.kind;
  return kind === 'session' || kind === 'bypass';
}

/** Parses a single positive integer form value; null when missing, repeated, or malformed. */
function parsePositiveId(values: FormDataEntryValue[]): number | null {
  if (values.length !== 1 || typeof values[0] !== 'string' || !/^[1-9][0-9]*$/.test(values[0])) {
    return null;
  }
  const id = Number(values[0]);
  return Number.isSafeInteger(id) ? id : null;
}

export const load: ServerLoad = async ({ locals, setHeaders }) => {
  setHeaders({ 'cache-control': 'no-store' });

  const principal = getSessionPrincipal(locals);

  const authedUser = locals.user;
  const passkeysEnabled =
    config.authMode === 'on' && !!authedUser && authedUser.id > 0 && !authedUser.username.startsWith('oidc:');
  const passkeys =
    passkeysEnabled && authedUser
      ? webauthnCredentialsQueries.listByUserId(authedUser.id).map(toCredentialSummary)
      : [];

  return {
    sessions: principal ? sessionsQueries.listSummariesByUserId(principal.user.id, principal.sessionId) : [],
    apiTokens: apiTokensQueries.list(),
    hasLegacyApiToken: apiTokensQueries.hasActiveLegacy(),
    canManageSessions: !!principal,
    passwordEnabled: !!principal && !principal.user.username.startsWith('oidc:'),
    passkeys,
    passkeysEnabled,
  };
};

export const actions: Actions = {
  changePassword: async ({ request, locals }) => {
    const principal = getSessionPrincipal(locals);
    if (!principal) {
      return fail(401, { passwordError: 'Not authenticated' });
    }

    if (principal.user.username.startsWith('oidc:')) {
      return fail(403, { passwordError: 'Password change is not available for this account' });
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return fail(400, { passwordError: 'All fields are required' });
    }

    const currentPassword = formData.get('currentPassword');
    const newPassword = formData.get('newPassword');
    const confirmPassword = formData.get('confirmPassword');

    if (
      typeof currentPassword !== 'string' ||
      typeof newPassword !== 'string' ||
      typeof confirmPassword !== 'string' ||
      !currentPassword ||
      !newPassword ||
      !confirmPassword
    ) {
      return fail(400, { passwordError: 'All fields are required' });
    }

    if (newPassword.length < 8) {
      return fail(400, { passwordError: 'New password must be at least 8 characters' });
    }

    if (newPassword !== confirmPassword) {
      return fail(400, { passwordError: 'Passwords do not match' });
    }

    // Re-check the principal after awaiting form parsing (session may have been revoked meanwhile)
    const livePrincipal = getSessionPrincipal(locals);
    if (!livePrincipal) {
      return fail(401, { passwordError: 'Not authenticated' });
    }

    const user = usersQueries.getById(livePrincipal.user.id);
    if (!user) {
      return fail(401, { passwordError: 'User not found' });
    }

    // Verify current password
    const valid = await verifyPassword(currentPassword, user.password_hash);
    if (!valid) {
      return fail(400, { passwordError: 'Current password is incorrect' });
    }

    // Update password
    const newHash = await hashPassword(newPassword);
    usersQueries.updatePassword(user.id, newHash);

    await logger.info(`Password changed for '${user.username}'`, {
      source: 'Auth',
      meta: { userId: user.id, username: user.username },
    });

    return { passwordSuccess: true };
  },

  createApiToken: async ({ request, locals }) => {
    if (!canManageApiTokens(locals)) {
      return fail(403, { apiTokenError: 'Not allowed' });
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return fail(400, { apiTokenError: 'Invalid form submission' });
    }

    let token: ApiTokenSummary;
    let secret: string;
    try {
      ({ token, secret } = createApiToken({
        name: formData.get('name'),
        scopes: formData.getAll('scopes'),
        expiresInDays: formData.get('expiresInDays'),
      }));
    } catch (error) {
      if (error instanceof ApiTokenValidationError) {
        return fail(400, { apiTokenError: error.message });
      }
      throw error;
    }

    await logger.info(`API token '${token.name}' created`, {
      source: 'Auth:APIToken',
      meta: { id: token.id, name: token.name, scopes: token.scopes, expiresAt: token.expiresAt },
    });

    return { createdApiToken: { secret, token } };
  },

  revokeApiToken: async ({ request, locals }) => {
    if (!canManageApiTokens(locals)) {
      return fail(403, { apiTokenError: 'Not allowed' });
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return fail(400, { apiTokenError: 'Token ID required' });
    }

    const id = parsePositiveId(formData.getAll('id'));
    if (id === null) {
      return fail(400, { apiTokenError: 'Token ID required' });
    }

    if (!apiTokensQueries.revoke(id)) {
      return fail(404, { apiTokenError: 'Token not found or already revoked' });
    }

    await logger.info('API token revoked', {
      source: 'Auth:APIToken',
      meta: { id },
    });

    return { apiTokenRevoked: true };
  },

  revokeSession: async ({ request, locals }) => {
    const principal = getSessionPrincipal(locals);
    if (!principal) {
      return fail(401, { sessionError: 'Not authenticated' });
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return fail(400, { sessionError: 'Session ID required' });
    }

    const values = formData.getAll('public_id');
    const publicId = values.length === 1 && typeof values[0] === 'string' ? values[0] : null;

    if (!publicId || !PUBLIC_ID_PATTERN.test(publicId)) {
      return fail(400, { sessionError: 'Session ID required' });
    }

    // Re-check the principal after awaiting form parsing (session may have been revoked meanwhile)
    const livePrincipal = getSessionPrincipal(locals);
    if (!livePrincipal) {
      return fail(401, { sessionError: 'Not authenticated' });
    }

    const deleted = sessionsQueries.deleteOtherByPublicId(
      livePrincipal.user.id,
      publicId.toLowerCase(),
      livePrincipal.sessionId
    );

    if (!deleted) {
      // Uniform miss: foreign owner, unknown id, or the current session
      return fail(404, { sessionError: 'Session not found or cannot be revoked' });
    }

    await logger.info('Session revoked', {
      source: 'Auth:Session',
      meta: { userId: livePrincipal.user.id, publicId },
    });

    return { sessionRevoked: true };
  },

  revokeOtherSessions: async ({ locals }) => {
    const principal = getSessionPrincipal(locals);
    if (!principal) {
      return fail(401, { sessionError: 'Not authenticated' });
    }

    const count = sessionsQueries.deleteOthersByUserId(principal.user.id, principal.sessionId);

    if (count > 0) {
      await logger.info(`Revoked ${count} other session${count === 1 ? '' : 's'}`, {
        source: 'Auth:Session',
        meta: { userId: principal.user.id, count },
      });
    }

    return { sessionsRevoked: count };
  },

  deletePasskey: async ({ request, locals }) => {
    const user = locals.user;
    if (!user || user.id <= 0 || user.username.startsWith('oidc:')) {
      return fail(401, { passkeyError: 'Not authenticated' });
    }

    const formData = await request.formData();
    const credentialId = formData.get('credentialId') as string;

    if (!credentialId) {
      return fail(400, { passkeyError: 'Credential id required' });
    }

    webauthnCredentialsQueries.deleteById(credentialId, user.id);

    await logger.info('Passkey removed', {
      source: 'Auth:Passkey',
      meta: { userId: user.id, credentialId: credentialId.slice(0, 8) + '...' },
    });

    return { passkeyDeleted: true };
  },

  renamePasskey: async ({ request, locals }) => {
    const user = locals.user;
    if (!user || user.id <= 0 || user.username.startsWith('oidc:')) {
      return fail(401, { passkeyError: 'Not authenticated' });
    }

    const formData = await request.formData();
    const credentialId = formData.get('credentialId') as string;
    const name = ((formData.get('name') as string) ?? '').trim();

    if (!credentialId) {
      return fail(400, { passkeyError: 'Credential id required' });
    }

    if (!name) {
      return fail(400, { passkeyError: 'Passkey name is required' });
    }

    if (name.length > 100) {
      return fail(400, { passkeyError: 'Passkey name must be 100 characters or fewer' });
    }

    try {
      const updated = webauthnCredentialsQueries.rename(credentialId, user.id, name);
      if (updated === 0) {
        return fail(404, { passkeyError: 'Passkey not found' });
      }
    } catch {
      return fail(409, { passkeyError: 'A passkey with that name already exists' });
    }

    await logger.info('Passkey renamed', {
      source: 'Auth:Passkey',
      meta: { userId: user.id, credentialId: credentialId.slice(0, 8) + '...' },
    });

    return { passkeyRenamed: true };
  },
};
