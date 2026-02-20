import { redirect, fail } from '@sveltejs/kit';
import type { Actions, ServerLoad } from '@sveltejs/kit';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import type { ConflictStrategy } from '$db/queries/databaseInstances.ts';
import { databaseInstanceCredentialsQueries } from '$db/queries/databaseInstanceCredentials.ts';
import { pcdManager } from '$pcd/index.ts';
import { logger } from '$logger/logger.ts';
import { schedulePcdSyncForDatabase } from '$lib/server/jobs/init.ts';
import {
  decryptDatabasePersonalAccessToken,
  encryptDatabasePersonalAccessToken,
} from '$server/utils/encryption/database-credentials.ts';
import { maskApiKey } from '$shared/utils/masking.ts';

function getDatabaseCredentialProcessingErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (
    message.includes('ARR_CREDENTIAL_MASTER_KEY') ||
    message.includes('No Arr credential key configured for version') ||
    message.includes('Arr credential key version must be a non-empty value') ||
    message.includes('Arr credential key version is required')
  ) {
    return 'Credential configuration is missing or invalid. Set ARR_CREDENTIAL_MASTER_KEY and ARR_CREDENTIAL_MASTER_KEY_VERSION, then retry.';
  }

  if (message.includes('Unable to decrypt Arr API key')) {
    return 'Unable to process personal access token; decryption failed. Verify credential key settings and retry.';
  }

  return 'Failed to process personal access token';
}

export const load: ServerLoad = async ({ parent }) => {
  const parentData = await parent();
  const database = parentData.database;

  const credential = databaseInstanceCredentialsQueries.getByInstanceId(database.id);
  if (!credential) {
    const legacyToken = database.personal_access_token?.trim() || '';
    return {
      hasPersonalAccessToken: Boolean(legacyToken),
      personalAccessTokenMasked: maskApiKey(legacyToken),
    };
  }

  try {
    const personalAccessToken = await decryptDatabasePersonalAccessToken({
      keyVersion: credential.key_version,
      nonce: credential.nonce,
      ciphertext: credential.ciphertext,
    });

    return {
      hasPersonalAccessToken: Boolean(personalAccessToken),
      personalAccessTokenMasked: maskApiKey(personalAccessToken),
    };
  } catch (error) {
    await logger.warn('Failed to load database PAT mask', {
      source: 'databases/[id]/settings',
      meta: { id: database.id, error: error instanceof Error ? error.message : String(error) },
    });

    return {
      hasPersonalAccessToken: false,
      personalAccessTokenMasked: '',
    };
  }
};

export const actions: Actions = {
  revealPersonalAccessToken: async ({ params }) => {
    const id = parseInt(params.id || '', 10);
    if (isNaN(id)) {
      return fail(400, { error: 'Invalid database ID' });
    }

    const database = databaseInstancesQueries.getById(id);
    if (!database) {
      return fail(404, { error: 'Database not found' });
    }

    const credential = databaseInstanceCredentialsQueries.getByInstanceId(id);
    if (!credential) {
      const legacyToken = database.personal_access_token?.trim() || '';
      if (!legacyToken) {
        return fail(404, { error: 'Unable to retrieve personal access token' });
      }

      return { revealedPersonalAccessToken: legacyToken };
    }

    try {
      const personalAccessToken = await decryptDatabasePersonalAccessToken({
        keyVersion: credential.key_version,
        nonce: credential.nonce,
        ciphertext: credential.ciphertext,
      });

      if (!personalAccessToken) {
        return fail(404, { error: 'Unable to retrieve personal access token' });
      }

      return { revealedPersonalAccessToken: personalAccessToken };
    } catch (error) {
      await logger.error('Failed to reveal personal access token', {
        source: 'databases/[id]/settings',
        meta: { id, error: error instanceof Error ? error.message : String(error) },
      });

      return fail(500, { error: getDatabaseCredentialProcessingErrorMessage(error) });
    }
  },

  update: async ({ params, request }) => {
    const id = parseInt(params.id || '', 10);

    // Validate ID
    if (isNaN(id)) {
      await logger.warn('Update failed: Invalid database ID', {
        source: 'databases/[id]/settings',
        meta: { id: params.id },
      });
      return fail(400, { error: 'Invalid database ID' });
    }

    // Fetch the instance to verify it exists
    const instance = databaseInstancesQueries.getById(id);

    if (!instance) {
      await logger.warn('Update failed: Database not found', {
        source: 'databases/[id]/settings',
        meta: { id },
      });
      return fail(404, { error: 'Database not found' });
    }

    const formData = await request.formData();

    const name = formData.get('name')?.toString().trim();
    const syncStrategy = parseInt(formData.get('sync_strategy')?.toString() || '0', 10);
    const autoPull = formData.get('auto_pull') === '1';
    const localOpsEnabled = formData.get('local_ops_enabled') === '1';
    const personalAccessToken = formData.get('personal_access_token')?.toString().trim() || undefined;
    const gitUserName = formData.has('git_user_name')
      ? formData.get('git_user_name')?.toString().trim() || null
      : undefined;
    const gitUserEmail = formData.has('git_user_email')
      ? formData.get('git_user_email')?.toString().trim() || null
      : undefined;
    const conflictStrategyRaw = formData.get('conflict_strategy')?.toString().trim() || '';
    const validConflictStrategies: ConflictStrategy[] = ['override', 'align', 'ask'];
    const conflictStrategy = validConflictStrategies.includes(conflictStrategyRaw as ConflictStrategy)
      ? (conflictStrategyRaw as ConflictStrategy)
      : instance.conflict_strategy;

    if (conflictStrategyRaw && !validConflictStrategies.includes(conflictStrategyRaw as ConflictStrategy)) {
      await logger.warn('Attempted to update database with invalid conflict strategy', {
        source: 'databases/[id]/settings',
        meta: { id, conflictStrategy: conflictStrategyRaw },
      });
      return fail(400, { error: 'Invalid conflict strategy' });
    }

    // Validation
    if (!name) {
      await logger.warn('Attempted to update database with missing required fields', {
        source: 'databases/[id]/settings',
        meta: { id, name },
      });

      return fail(400, {
        error: 'Name is required',
        values: { name },
      });
    }
    const hasStoredPersonalAccessToken = !!instance.has_personal_access_token || !!instance.personal_access_token;
    const requiresGitIdentity = (!!personalAccessToken || hasStoredPersonalAccessToken) && !localOpsEnabled;
    if (requiresGitIdentity && (!gitUserName || !gitUserEmail)) {
      return fail(400, {
        error: 'Git author name and email are required when PAT is set and Local Ops Only is disabled',
        values: { name },
      });
    }

    // Check if name already exists (excluding current instance)
    if (databaseInstancesQueries.nameExists(name, id)) {
      await logger.warn('Attempted to update database with duplicate name', {
        source: 'databases/[id]/settings',
        meta: { id, name },
      });

      return fail(400, {
        error: 'A database with this name already exists',
        values: { name },
      });
    }

    try {
      let encryptedPersonalAccessToken: Awaited<ReturnType<typeof encryptDatabasePersonalAccessToken>> | undefined;
      if (personalAccessToken !== undefined) {
        encryptedPersonalAccessToken = await encryptDatabasePersonalAccessToken(personalAccessToken);
      }

      // Update the database
      const updated = databaseInstancesQueries.update(id, {
        name,
        syncStrategy,
        autoPull,
        personalAccessToken,
        localOpsEnabled,
        gitUserName,
        gitUserEmail,
        conflictStrategy,
      },
      encryptedPersonalAccessToken
        ? {
            ciphertext: encryptedPersonalAccessToken.credential.ciphertext,
            nonce: encryptedPersonalAccessToken.credential.nonce,
            keyVersion: encryptedPersonalAccessToken.credential.keyVersion,
          }
        : undefined);

      if (!updated) {
        throw new Error('Update returned false');
      }

      await logger.info(`Updated database: ${name}`, {
        source: 'databases/[id]/settings',
        meta: { id, name },
      });

      schedulePcdSyncForDatabase(id);

      return { success: true };
    } catch (err) {
      await logger.error('Failed to update database', {
        source: 'databases/[id]/settings',
        meta: { error: err instanceof Error ? err.message : String(err) },
      });

      return fail(500, {
        error: personalAccessToken !== undefined ? getDatabaseCredentialProcessingErrorMessage(err) : 'Failed to update database',
        values: { name },
      });
    }
  },

  delete: async ({ params }) => {
    const id = parseInt(params.id || '', 10);

    // Validate ID
    if (isNaN(id)) {
      await logger.warn('Delete failed: Invalid database ID', {
        source: 'databases/[id]/settings',
        meta: { id: params.id },
      });
      return fail(400, { error: 'Invalid database ID' });
    }

    // Fetch the instance to verify it exists
    const instance = databaseInstancesQueries.getById(id);

    if (!instance) {
      await logger.warn('Delete failed: Database not found', {
        source: 'databases/[id]/settings',
        meta: { id },
      });
      return fail(404, { error: 'Database not found' });
    }

    try {
      // Unlink the database
      await pcdManager.unlink(id);

      await logger.info(`Unlinked database: ${instance.name}`, {
        source: 'databases/[id]/settings',
        meta: { id, name: instance.name, repositoryUrl: instance.repository_url },
      });

      // Redirect to databases list
      redirect(303, '/databases');
    } catch (err) {
      // Re-throw redirect errors (they're not actual errors)
      if (err && typeof err === 'object' && 'status' in err && 'location' in err) {
        throw err;
      }

      await logger.error('Failed to unlink database', {
        source: 'databases/[id]/settings',
        meta: { error: err instanceof Error ? err.message : String(err) },
      });

      return fail(500, { error: 'Failed to unlink database' });
    }
  },
};
