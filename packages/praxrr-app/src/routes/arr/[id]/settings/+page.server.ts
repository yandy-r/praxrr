import { error, fail, redirect, type ServerLoad } from '@sveltejs/kit';
import type { Actions } from '@sveltejs/kit';
import { db } from '$db/db.ts';
import { arrInstancesQueries, type ArrInstance, type ArrInstanceSource } from '$db/queries/arrInstances.ts';
import { arrInstanceCredentialsQueries } from '$db/queries/arrInstanceCredentials.ts';
import { cleanupJobsForArrInstance } from '$lib/server/jobs/cleanup.ts';
import { logger } from '$logger/logger.ts';
import { parseOptionalAbsoluteHttpUrl } from '$utils/validation/url.ts';
import { encryptArrInstanceApiKey } from '$server/utils/encryption/arr-credentials.ts';

function getArrCredentialProcessingErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (
    message.includes('ARR_CREDENTIAL_MASTER_KEY') ||
    message.includes('No Arr credential key configured for version') ||
    message.includes('Arr credential key version must be a non-empty value') ||
    message.includes('Arr credential key version is required')
  ) {
    return 'ARR credential configuration is missing or invalid. Set ARR_CREDENTIAL_MASTER_KEY and ARR_CREDENTIAL_MASTER_KEY_VERSION, then retry.';
  }

  if (message.includes('Unable to decrypt Arr API key')) {
    return 'Unable to process API key; key decryption failed. Verify Arr credential key settings and retry.';
  }

  return 'Failed to process API key';
}

export const load: ServerLoad = async ({ parent }) => {
  const parentData = await parent();
  const rawInstance = parentData.instance;

  if (!rawInstance) {
    error(404, 'Instance not found');
  }

  const instance = rawInstance as ArrInstance;
  const source: ArrInstanceSource = instance.source ?? 'ui';

  return {
    instance: {
      ...instance,
      source,
      api_key: '',
    },
    canEditCoreConnectionFields: source === 'ui',
  };
};

export const actions: Actions = {
  update: async ({ params, request }) => {
    const id = parseInt(params.id || '', 10);

    // Validate ID
    if (isNaN(id)) {
      return fail(400, { error: 'Invalid instance ID' });
    }

    // Fetch the instance to verify it exists
    const instance = arrInstancesQueries.getById(id);

    if (!instance) {
      return fail(404, { error: 'Instance not found' });
    }

    const isEnvManaged = (instance.source ?? 'ui') === 'env';

    const formData = await request.formData();
    const name = isEnvManaged ? instance.name : formData.get('name')?.toString().trim();
    const url = isEnvManaged ? instance.url : formData.get('url')?.toString().trim();
    const apiKey = formData.get('api_key')?.toString().trim() ?? '';
    const rawExternalUrl = formData.get('external_url')?.toString();
    const externalUrl = parseOptionalAbsoluteHttpUrl(rawExternalUrl);
    const tagsJson = formData.get('tags')?.toString() || '';
    const enabled = formData.get('enabled')?.toString() === '1';
    let encryptedApiKey: Awaited<ReturnType<typeof encryptArrInstanceApiKey>> | undefined;

    // Validate required fields
    if (!name) {
      return fail(400, { error: 'Name is required' });
    }

    if (!url) {
      return fail(400, { error: 'URL is required' });
    }

    if (!isEnvManaged && !apiKey) {
      return fail(400, { error: 'API Key is required' });
    }

    if (!externalUrl.isValid) {
      return fail(400, { error: 'External URL must be a valid absolute http(s) URL' });
    }

    // Check for duplicate name
    if (arrInstancesQueries.nameExists(name, id)) {
      return fail(400, { error: 'An instance with this name already exists' });
    }

    // Check if API key already exists (each Arr instance has a unique API key)
    let apiKeyFingerprint: { keyVersion: string; value: string } | undefined;
    try {
      if (!isEnvManaged) {
        encryptedApiKey = await encryptArrInstanceApiKey(apiKey);
        apiKeyFingerprint = encryptedApiKey.fingerprint;
      }
    } catch (error) {
      await logger.error('Failed to process arr api key', {
        source: 'arr/[id]/settings',
        meta: { error: error instanceof Error ? error.message : String(error) },
      });

      return fail(500, {
        error: getArrCredentialProcessingErrorMessage(error),
      });
    }

    if (!isEnvManaged && apiKeyFingerprint && arrInstanceCredentialsQueries.getByFingerprint(apiKeyFingerprint.value)) {
      const matched = arrInstanceCredentialsQueries.getByFingerprint(apiKeyFingerprint.value);
      if (matched.instance_id !== id) {
        return fail(400, { error: 'This instance is already connected' });
      }
    }

    // Parse tags
    let tags: string[] = [];
    if (tagsJson) {
      try {
        tags = JSON.parse(tagsJson);
      } catch {
        // Ignore parse errors, use empty array
      }
    }

    try {
      db.transaction(() => {
        const updated = arrInstancesQueries.update(id, {
          name,
          url,
          externalUrl: externalUrl.value,
          apiKey: isEnvManaged ? undefined : apiKey,
          tags,
          enabled,
        });

        if (!updated) {
          throw new Error('Failed to update arr instance');
        }

        if (encryptedApiKey) {
          arrInstanceCredentialsQueries.upsert({
            instanceId: id,
            ciphertext: encryptedApiKey.credential.ciphertext,
            nonce: encryptedApiKey.credential.nonce,
            keyVersion: encryptedApiKey.credential.keyVersion,
            fingerprint: encryptedApiKey.fingerprint.value,
          });
        }
      });

      await logger.info(`Updated arr instance: ${name}`, {
        source: 'arr/[id]/settings',
        meta: { id, name, type: instance.type, url },
      });

      return { success: true };
    } catch (err) {
      await logger.error('Failed to update arr instance', {
        source: 'arr/[id]/settings',
        meta: { error: err instanceof Error ? err.message : String(err) },
      });

      return fail(500, { error: 'Failed to update instance' });
    }
  },

  delete: async ({ params }) => {
    const id = parseInt(params.id || '', 10);

    // Validate ID
    if (isNaN(id)) {
      await logger.warn('Delete failed: Invalid instance ID', {
        source: 'arr/[id]/settings',
        meta: { id: params.id },
      });
      return fail(400, { error: 'Invalid instance ID' });
    }

    // Fetch the instance to verify it exists
    const instance = arrInstancesQueries.getById(id);

    if (!instance) {
      await logger.warn('Delete failed: Instance not found', {
        source: 'arr/[id]/settings',
        meta: { id },
      });
      return fail(404, { error: 'Instance not found' });
    }

    if ((instance.source ?? 'ui') === 'env') {
      return fail(403, {
        error: 'Environment-managed instances cannot be deleted. Remove the environment variables and restart.',
      });
    }

    cleanupJobsForArrInstance(id);

    // Delete the instance
    const deleted = arrInstancesQueries.delete(id);

    if (!deleted) {
      await logger.error('Failed to delete instance', {
        source: 'arr/[id]/settings',
        meta: { id, name: instance.name, type: instance.type },
      });
      return fail(500, { error: 'Failed to delete instance' });
    }

    await logger.info(`Deleted ${instance.type} instance: ${instance.name}`, {
      source: 'arr/[id]/settings',
      meta: { id, name: instance.name, type: instance.type, url: instance.url },
    });

    // Redirect to the arr landing page
    redirect(303, '/arr');
  },
};
