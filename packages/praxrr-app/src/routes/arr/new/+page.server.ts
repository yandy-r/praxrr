import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { logger } from '$logger/logger.ts';
import { encryptArrInstanceApiKey } from '$server/utils/encryption/arr-credentials.ts';
import { parseOptionalAbsoluteHttpUrl } from '$utils/validation/url.ts';

const VALID_TYPES = ['radarr', 'sonarr', 'lidarr'];

export const actions = {
  default: async ({ request }) => {
    const formData = await request.formData();

    const name = formData.get('name')?.toString().trim();
    const type = formData.get('type')?.toString().trim();
    const url = formData.get('url')?.toString().trim();
    const apiKey = formData.get('api_key')?.toString().trim();
    const rawExternalUrl = formData.get('external_url')?.toString();
    const tagsJson = formData.get('tags')?.toString().trim();
    const enabled = formData.get('enabled')?.toString() === '1';
    const externalUrl = parseOptionalAbsoluteHttpUrl(rawExternalUrl);

    // Validation
    if (!name || !type || !url || !apiKey) {
      await logger.warn('Attempted to create instance with missing required fields', {
        source: 'arr/new',
        meta: { name, type, url, hasApiKey: !!apiKey },
      });

      return fail(400, {
        error: 'Name, type, URL, and API key are required',
        values: { name, type, url },
      });
    }

    if (!VALID_TYPES.includes(type)) {
      await logger.warn('Attempted to create instance with invalid type', {
        source: 'arr/new',
        meta: { name, type, url },
      });

      return fail(400, {
        error: 'Invalid arr type',
        values: { name, type, url },
      });
    }

    if (!externalUrl.isValid) {
      return fail(400, {
        error: 'External URL must be a valid absolute http(s) URL',
        values: { name, type, url },
      });
    }

    // Check if name already exists
    if (arrInstancesQueries.nameExists(name)) {
      await logger.warn('Attempted to create instance with duplicate name', {
        source: 'arr/new',
        meta: { name, type },
      });

      return fail(400, {
        error: 'An instance with this name already exists',
        values: { name, type, url },
      });
    }

    // Check if API key fingerprint already exists (each Arr instance has a unique API key)
    let encryptedApiKey;
    try {
      encryptedApiKey = await encryptArrInstanceApiKey(apiKey);
    } catch (error) {
      await logger.error('Failed to encrypt arr api key', {
        source: 'arr/new',
        meta: { error },
      });

      return fail(500, {
        error: 'Failed to process API key',
        values: { name, type, url },
      });
    }

    if (arrInstanceCredentialsQueries.getByFingerprint(encryptedApiKey.fingerprint.value)) {
      await logger.warn('Attempted to create duplicate instance', {
        source: 'arr/new',
        meta: { name, type, url },
      });

      return fail(400, {
        error: 'This instance is already connected',
        values: { name, type, url },
      });
    }

    // Parse tags
    let tags: string[] = [];
    if (tagsJson) {
      try {
        const parsed = JSON.parse(tagsJson);
        if (Array.isArray(parsed)) {
          tags = parsed;
        }
      } catch (error) {
        await logger.warn('Failed to parse tags JSON', {
          source: 'arr/new',
          meta: { tagsJson, error },
        });
      }
    }

    let id: number;
    try {
      const insertedId = arrInstancesQueries.create(
        {
          name,
          type,
          url,
          externalUrl: externalUrl.value,
          apiKey,
          tags,
          enabled,
        },
        {
          ciphertext: encryptedApiKey.credential.ciphertext,
          nonce: encryptedApiKey.credential.nonce,
          keyVersion: encryptedApiKey.credential.keyVersion,
          fingerprint: encryptedApiKey.fingerprint.value,
        }
      );

      id = insertedId;
      if (!id) {
        throw new Error('Failed to create arr instance');
      }
      await logger.info(`Created new ${type} instance: ${name}`, {
        source: 'arr/new',
        meta: { id, name, type, url },
      });
    } catch (error) {
      await logger.error('Failed to create arr instance', {
        source: 'arr/new',
        meta: error,
      });

      return fail(500, {
        error: 'Failed to create instance',
        values: { name, type, url },
      });
    }

    // Redirect to the new instance page (outside try-catch since redirect throws)
    redirect(303, `/arr/${id}/settings`);
  },
} satisfies Actions;
