import { fail } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { arrInstanceCredentialsQueries } from '$db/queries/arrInstanceCredentials.ts';
import { logger } from '$logger/logger.ts';
import {
  encryptArrInstanceApiKey,
  deriveArrInstanceApiKeyFingerprint,
} from '$server/utils/encryption/arr-credentials.ts';
import { getAllArrCredentialKeyVersions } from '$server/utils/encryption/keys.ts';
import { parseOptionalAbsoluteHttpUrl } from '$utils/validation/url.ts';

const VALID_TYPES = ['radarr', 'sonarr', 'lidarr'];

export interface CreateArrInstanceOptions {
  // Logger `source` tag; differs per caller (e.g. 'arr/new', 'setup/connect-arr').
  source: string;
}

export type CreateArrInstanceResult = { ok: true; id: number } | { ok: false; failure: ReturnType<typeof fail> };

/**
 * Shared instance-create action body for the standalone "Add Instance" flow
 * (arr/new) and the setup wizard's connect-arr step. Handles field
 * extraction, validation, name/fingerprint dedup, encryption, tag parsing,
 * and insert; callers own only their own post-create redirect/step.
 */
export async function createArrInstanceFromForm(
  formData: FormData,
  opts: CreateArrInstanceOptions
): Promise<CreateArrInstanceResult> {
  const { source } = opts;

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
      source,
      meta: { name, type, url, hasApiKey: !!apiKey },
    });

    return {
      ok: false,
      failure: fail(400, {
        error: 'Name, type, URL, and API key are required',
        values: { name, type, url },
      }),
    };
  }

  if (!VALID_TYPES.includes(type)) {
    await logger.warn('Attempted to create instance with invalid type', {
      source,
      meta: { name, type, url },
    });

    return {
      ok: false,
      failure: fail(400, {
        error: 'Invalid arr type',
        values: { name, type, url },
      }),
    };
  }

  if (!externalUrl.isValid) {
    return {
      ok: false,
      failure: fail(400, {
        error: 'External URL must be a valid absolute http(s) URL',
        values: { name, type, url },
      }),
    };
  }

  // Check if name already exists
  if (arrInstancesQueries.nameExists(name)) {
    await logger.warn('Attempted to create instance with duplicate name', {
      source,
      meta: { name, type },
    });

    return {
      ok: false,
      failure: fail(400, {
        error: 'An instance with this name already exists',
        values: { name, type, url },
      }),
    };
  }

  // Check if API key fingerprint already exists under any credential key version
  let candidateFingerprints: string[];
  try {
    const versions = getAllArrCredentialKeyVersions();
    candidateFingerprints = await Promise.all(
      versions.map((version) => deriveArrInstanceApiKeyFingerprint(apiKey, version).then((fp) => fp.value))
    );
  } catch (error) {
    await logger.error('Failed to derive API key fingerprints', {
      source,
      meta: { error },
    });

    return {
      ok: false,
      failure: fail(500, {
        error: 'Failed to process API key',
        values: { name, type, url },
      }),
    };
  }

  if (arrInstanceCredentialsQueries.getByAnyFingerprint(candidateFingerprints)) {
    await logger.warn('Attempted to create duplicate instance', {
      source,
      meta: { name, type, url },
    });

    return {
      ok: false,
      failure: fail(400, {
        error: 'This instance is already connected',
        values: { name, type, url },
      }),
    };
  }

  let encryptedApiKey;
  try {
    encryptedApiKey = await encryptArrInstanceApiKey(apiKey);
  } catch (error) {
    await logger.error('Failed to encrypt arr api key', {
      source,
      meta: { error },
    });

    return {
      ok: false,
      failure: fail(500, {
        error: 'Failed to process API key',
        values: { name, type, url },
      }),
    };
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
        source,
        meta: { tagsJson, error },
      });
    }
  }

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

    if (!insertedId) {
      throw new Error('Failed to create arr instance');
    }
    await logger.info(`Created new ${type} instance: ${name}`, {
      source,
      meta: { id: insertedId, name, type, url },
    });

    return { ok: true, id: insertedId };
  } catch (error) {
    await logger.error('Failed to create arr instance', {
      source,
      meta: error,
    });

    return {
      ok: false,
      failure: fail(500, {
        error: 'Failed to create instance',
        values: { name, type, url },
      }),
    };
  }
}
