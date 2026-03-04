import { error, fail, redirect, type ServerLoad } from '@sveltejs/kit';
import type { Actions } from '@sveltejs/kit';
import { arrInstancesQueries, type ArrInstance, type ArrInstanceSource } from '$db/queries/arrInstances.ts';
import { arrInstanceCredentialsQueries } from '$db/queries/arrInstanceCredentials.ts';
import { loadSectionModes } from '$lib/server/disclosure/loadSectionModes.ts';
import { ARR_CONNECTION_DETAILS } from '$shared/disclosure/sectionKeys.ts';
import { cleanupJobsForArrInstance } from '$lib/server/jobs/cleanup.ts';
import { logger } from '$logger/logger.ts';
import { parseOptionalAbsoluteHttpUrl } from '$utils/validation/url.ts';
import { decryptArrInstanceApiKey, encryptArrInstanceApiKey } from '$server/utils/encryption/arr-credentials.ts';
import { maskApiKey } from '$shared/utils/masking.ts';

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

async function getInstanceApiKeyState(instanceId: number): Promise<{ hasApiKey: boolean; apiKeyMasked: string }> {
  const credential = arrInstanceCredentialsQueries.getByInstanceId(instanceId);
  if (!credential) {
    return { hasApiKey: false, apiKeyMasked: '' };
  }

  try {
    const apiKey = await decryptArrInstanceApiKey({
      keyVersion: credential.key_version,
      nonce: credential.nonce,
      ciphertext: credential.ciphertext,
    });

    return {
      hasApiKey: Boolean(apiKey),
      apiKeyMasked: maskApiKey(apiKey),
    };
  } catch (error) {
    await logger.warn('Failed to load arr API key mask', {
      source: 'arr/[id]/settings',
      meta: { id: instanceId, error: error instanceof Error ? error.message : String(error) },
    });

    return { hasApiKey: false, apiKeyMasked: '' };
  }
}

export const load: ServerLoad = async ({ parent, locals }) => {
  const parentData = await parent();
  const rawInstance = parentData.instance;

  if (!rawInstance) {
    error(404, 'Instance not found');
  }

  const instance = rawInstance as ArrInstance;
  const source: ArrInstanceSource = instance.source ?? 'ui';
  const apiKeyState = await getInstanceApiKeyState(instance.id);
  const arrSettingsSectionModes = loadSectionModes(locals.user?.id, [ARR_CONNECTION_DETAILS]);

  return {
    instance: {
      ...instance,
      source,
      api_key: '',
    },
    canEditCoreConnectionFields: source === 'ui',
    hasApiKey: apiKeyState.hasApiKey,
    apiKeyMasked: apiKeyState.apiKeyMasked,
    arrSettingsSectionModes,
  };
};

export const actions: Actions = {
  revealApiKey: async ({ params }) => {
    const id = parseInt(params.id || '', 10);
    if (isNaN(id)) {
      return fail(400, { error: 'Invalid instance ID' });
    }

    const instance = arrInstancesQueries.getById(id);
    if (!instance) {
      return fail(404, { error: 'Instance not found' });
    }

    const credential = arrInstanceCredentialsQueries.getByInstanceId(id);
    if (!credential) {
      return fail(404, { error: 'Unable to retrieve API key' });
    }

    try {
      const apiKey = await decryptArrInstanceApiKey({
        keyVersion: credential.key_version,
        nonce: credential.nonce,
        ciphertext: credential.ciphertext,
      });

      if (!apiKey) {
        return fail(404, { error: 'Unable to retrieve API key' });
      }

      return { revealedApiKey: apiKey };
    } catch (error) {
      await logger.error('Failed to reveal arr API key', {
        source: 'arr/[id]/settings',
        meta: { id, error: error instanceof Error ? error.message : String(error) },
      });

      return fail(500, {
        error: getArrCredentialProcessingErrorMessage(error),
      });
    }
  },

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

    if (!isEnvManaged && apiKeyFingerprint) {
      if (arrInstancesQueries.apiKeyExists(apiKeyFingerprint.value, id)) {
        return fail(400, { error: 'This instance is already connected' });
      }

      const matchedCredential = arrInstanceCredentialsQueries.getByFingerprint(apiKeyFingerprint.value);
      if (matchedCredential && matchedCredential.instance_id !== id) {
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
      const updated = arrInstancesQueries.update(
        id,
        {
          name,
          url,
          externalUrl: externalUrl.value,
          apiKey: isEnvManaged ? undefined : apiKey,
          tags,
          enabled,
        },
        encryptedApiKey
          ? {
              ciphertext: encryptedApiKey.credential.ciphertext,
              nonce: encryptedApiKey.credential.nonce,
              keyVersion: encryptedApiKey.credential.keyVersion,
              fingerprint: encryptedApiKey.fingerprint.value,
            }
          : undefined
      );

      if (!updated) {
        throw new Error('Failed to update arr instance');
      }

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
