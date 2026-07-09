import type { Actions, ServerLoad } from '@sveltejs/kit';
import { fail } from '@sveltejs/kit';
import { usersQueries } from '$db/queries/users.ts';
import { sessionsQueries } from '$db/queries/sessions.ts';
import { authSettingsQueries } from '$db/queries/authSettings.ts';
import { hashPassword, verifyPassword } from '$auth/password.ts';
import { logger } from '$logger/logger.ts';
import { maskApiKey } from '$shared/utils/masking.ts';
import { config } from '$config';
import { webauthnCredentialsQueries } from '$db/queries/webauthnCredentials.ts';
import { toCredentialSummary } from '$lib/server/webauthn/ceremonies.ts';

export const load: ServerLoad = async ({ cookies, locals }) => {
  const currentSessionId = cookies.get('session');
  const user = usersQueries.getByUsername('admin') ?? usersQueries.getById(1);

  const authedUser = locals.user;
  const passkeysEnabled =
    config.authMode === 'on' && !!authedUser && authedUser.id > 0 && !authedUser.username.startsWith('oidc:');
  const passkeys =
    passkeysEnabled && authedUser
      ? webauthnCredentialsQueries.listByUserId(authedUser.id).map(toCredentialSummary)
      : [];

  if (!user) {
    return {
      sessions: [],
      apiKeyMasked: '',
      hasApiKey: false,
      currentSessionId: null,
      passkeys,
      passkeysEnabled,
    };
  }

  const sessions = sessionsQueries.getByUserId(user.id);
  const apiKey = authSettingsQueries.getApiKey();
  const apiKeyMasked = maskApiKey(apiKey);

  return {
    sessions: sessions.map((s) => ({
      id: s.id,
      created_at: s.created_at,
      expires_at: s.expires_at,
      last_active_at: s.last_active_at,
      ip_address: s.ip_address,
      browser: s.browser,
      os: s.os,
      device_type: s.device_type,
      isCurrent: s.id === currentSessionId,
    })),
    apiKeyMasked,
    hasApiKey: Boolean(apiKey),
    currentSessionId,
    passkeys,
    passkeysEnabled,
  };
};

export const actions: Actions = {
  changePassword: async ({ request, cookies }) => {
    const formData = await request.formData();
    const currentPassword = formData.get('currentPassword') as string;
    const newPassword = formData.get('newPassword') as string;
    const confirmPassword = formData.get('confirmPassword') as string;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return fail(400, { passwordError: 'All fields are required' });
    }

    if (newPassword.length < 8) {
      return fail(400, { passwordError: 'New password must be at least 8 characters' });
    }

    if (newPassword !== confirmPassword) {
      return fail(400, { passwordError: 'Passwords do not match' });
    }

    // Get current user from session
    const sessionId = cookies.get('session');
    if (!sessionId) {
      return fail(401, { passwordError: 'Not authenticated' });
    }

    const session = sessionsQueries.getValidById(sessionId);
    if (!session) {
      return fail(401, { passwordError: 'Invalid session' });
    }

    const user = usersQueries.getById(session.user_id);
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

  regenerateApiKey: async () => {
    const newKey = authSettingsQueries.regenerateApiKey();

    await logger.info('API key regenerated', {
      source: 'Auth:APIKey',
    });

    return { apiKey: newKey, apiKeyRegenerated: true };
  },

  revealAuthKey: async () => {
    try {
      const apiKey = authSettingsQueries.getApiKey();

      if (!apiKey) {
        return fail(404, { error: 'Unable to retrieve API key' });
      }

      return { revealedAuthKey: apiKey };
    } catch {
      await logger.error('Failed to reveal auth API key', {
        source: 'Auth:APIKey',
      });

      return fail(500, { error: 'Unable to retrieve API key' });
    }
  },

  revokeSession: async ({ request, cookies }) => {
    const formData = await request.formData();
    const sessionId = formData.get('sessionId') as string;
    const currentSessionId = cookies.get('session');

    if (!sessionId) {
      return fail(400, { sessionError: 'Session ID required' });
    }

    if (sessionId === currentSessionId) {
      return fail(400, { sessionError: 'Cannot revoke current session' });
    }

    sessionsQueries.deleteById(sessionId);

    await logger.info('Session revoked', {
      source: 'Auth:Session',
      meta: { revokedSessionId: sessionId.slice(0, 8) + '...' },
    });

    return { sessionRevoked: true };
  },

  revokeOtherSessions: async ({ cookies }) => {
    const currentSessionId = cookies.get('session');
    if (!currentSessionId) {
      return fail(401, { sessionError: 'Not authenticated' });
    }

    const session = sessionsQueries.getValidById(currentSessionId);
    if (!session) {
      return fail(401, { sessionError: 'Invalid session' });
    }

    const count = sessionsQueries.deleteOthersByUserId(session.user_id, currentSessionId);

    if (count > 0) {
      await logger.info(`Revoked ${count} other session${count === 1 ? '' : 's'}`, {
        source: 'Auth:Session',
        meta: { userId: session.user_id, count },
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
