import { db } from '../db.ts';
import { arrInstanceCredentialsQueries, type ArrInstanceCredentialWriteInput } from './arrInstanceCredentials.ts';

/**
 * Types for arr_instances table
 */
export interface ArrInstance {
  id: number;
  name: string;
  type: string;
  url: string;
  external_url: string | null;
  api_key_fingerprint: string | null;
  api_key: string;
  tags: string | null;
  enabled: number;
  source?: ArrInstanceSource;
  created_at: string;
  updated_at: string;
}

export type ArrInstanceSource = 'ui' | 'env';

export interface CreateArrInstanceInput {
  name: string;
  type: string;
  url: string;
  apiKey: string;
  apiKeyFingerprint?: string | null;
  externalUrl?: string | null;
  tags?: string[];
  enabled?: boolean;
  source?: ArrInstanceSource;
}

export interface UpdateArrInstanceInput {
  name?: string;
  type?: string;
  url?: string;
  externalUrl?: string | null;
  apiKeyFingerprint?: string | null;
  apiKey?: string;
  tags?: string[];
  enabled?: boolean;
  source?: ArrInstanceSource;
}

const arrInstanceSelect = `
  SELECT
    id,
    name,
    type,
    url,
    external_url,
    '' AS api_key,
    api_key_fingerprint,
    tags,
    enabled,
    source,
    created_at,
    updated_at
  FROM arr_instances`;

/**
 * Normalize optional external URL values by trimming and converting blank/whitespace
 * input to NULL for stable DB storage.
 */
function normalizeExternalUrl(externalUrl: string | null | undefined): string | null {
  return externalUrl?.trim() || null;
}

function buildApiKeyFingerprint(
  patchFingerprint: string | null | undefined,
  credentialFingerprint: string | undefined
): string | null | undefined {
  if (patchFingerprint !== undefined) {
    return patchFingerprint;
  }

  return credentialFingerprint;
}

function collectArrInstanceUpdates(
  patch: UpdateArrInstanceInput,
  credentialFingerprint: string | undefined
): { updates: string[]; params: (string | number | null)[] } {
  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (patch.name !== undefined) {
    updates.push('name = ?');
    params.push(patch.name);
  }
  if (patch.type !== undefined) {
    updates.push('type = ?');
    params.push(patch.type);
  }
  if (patch.url !== undefined) {
    updates.push('url = ?');
    params.push(patch.url);
  }
  if (patch.externalUrl !== undefined) {
    updates.push('external_url = ?');
    params.push(normalizeExternalUrl(patch.externalUrl));
  }

  const apiKeyFingerprint = buildApiKeyFingerprint(patch.apiKeyFingerprint, credentialFingerprint);
  if (apiKeyFingerprint !== undefined) {
    updates.push('api_key_fingerprint = ?');
    params.push(apiKeyFingerprint);
  }

  if (patch.apiKey !== undefined) {
    updates.push('api_key = ?');
    params.push(patch.apiKey);
  }
  if (patch.tags !== undefined) {
    updates.push('tags = ?');
    params.push(patch.tags.length > 0 ? JSON.stringify(patch.tags) : null);
  }
  if (patch.enabled !== undefined) {
    updates.push('enabled = ?');
    params.push(patch.enabled ? 1 : 0);
  }
  if (patch.source !== undefined) {
    updates.push('source = ?');
    params.push(patch.source);
  }

  return { updates, params };
}

function getArrInstanceByApiKeyFingerprint(apiKeyFingerprint: string): ArrInstance | undefined {
  return db.queryFirst<ArrInstance>(
    `${arrInstanceSelect} WHERE api_key_fingerprint = ? ORDER BY id LIMIT 1`,
    apiKeyFingerprint
  );
}

function updateArrInstance(
  instanceId: number,
  patch: UpdateArrInstanceInput,
  credentialInput?: ArrInstanceCredentialWriteInput
): boolean {
  const { updates, params } = collectArrInstanceUpdates(patch, credentialInput?.fingerprint);

  if (updates.length === 0 && credentialInput === undefined) {
    return false;
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(instanceId);

  db.beginTransaction();
  try {
    let updated = db.execute(`UPDATE arr_instances SET ${updates.join(', ')} WHERE id = ?`, ...params) > 0;

    if (credentialInput !== undefined) {
      arrInstanceCredentialsQueries.upsert({
        instanceId,
        ...credentialInput,
      });
      updated = true;
    }

    db.commit();
    return updated;
  } catch (error) {
    db.rollback();
    throw error;
  }
}

/**
 * All queries for arr_instances table
 */
export const arrInstancesQueries = {
  /**
   * Create a new arr instance
   */
  create(input: CreateArrInstanceInput, credentialInput?: ArrInstanceCredentialWriteInput): number {
    const apiKeyFingerprint = input.apiKeyFingerprint ?? credentialInput?.fingerprint ?? null;
    const tagsJson = input.tags && input.tags.length > 0 ? JSON.stringify(input.tags) : null;
    const enabled = input.enabled !== false ? 1 : 0;
    const externalUrl = normalizeExternalUrl(input.externalUrl);
    const source = input.source ?? 'ui';

    db.beginTransaction();
    try {
      db.execute(
        `INSERT INTO arr_instances (name, type, url, external_url, api_key, api_key_fingerprint, tags, enabled, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.name,
        input.type,
        input.url,
        externalUrl,
        input.apiKey,
        apiKeyFingerprint,
        tagsJson,
        enabled,
        source
      );

      // Get the last inserted ID
      const result = db.queryFirst<{ id: number }>('SELECT last_insert_rowid() as id');
      if (!result) {
        throw new Error('Failed to create arr instance');
      }

      if (credentialInput !== undefined) {
        arrInstanceCredentialsQueries.create({
          instanceId: result.id,
          ...credentialInput,
        });
      }

      db.commit();
      return result.id;
    } catch (error) {
      db.rollback();
      throw error;
    }
  },

  /**
   * Get an arr instance by ID
   */
  getById(id: number): ArrInstance | undefined {
    return db.queryFirst<ArrInstance>(`${arrInstanceSelect} WHERE id = ?`, id);
  },

  /**
   * Get all arr instances
   */
  getAll(): ArrInstance[] {
    return db.query<ArrInstance>(`${arrInstanceSelect} ORDER BY name`);
  },

  /**
   * Get arr instances by type
   */
  getByType(type: string): ArrInstance[] {
    return db.query<ArrInstance>(`${arrInstanceSelect} WHERE type = ? ORDER BY name`, type);
  },

  /**
   * Get arr instances by source
   */
  getBySource(source: ArrInstanceSource): ArrInstance[] {
    return db.query<ArrInstance>(`${arrInstanceSelect} WHERE source = ? ORDER BY id`, source);
  },

  /**
   * Get an arr instance by source and exact name
   */
  getBySourceAndName(source: ArrInstanceSource, name: string): ArrInstance | undefined {
    return db.queryFirst<ArrInstance>(
      `${arrInstanceSelect} WHERE source = ? AND name = ? ORDER BY id LIMIT 1`,
      source,
      name
    );
  },

  /**
   * Get an arr instance by API key fingerprint
   */
  getByApiKey(apiKeyFingerprint: string): ArrInstance | undefined {
    return getArrInstanceByApiKeyFingerprint(apiKeyFingerprint);
  },

  /**
   * Get an arr instance by API key fingerprint (explicit alias)
   */
  getByApiKeyFingerprint(apiKeyFingerprint: string): ArrInstance | undefined {
    return getArrInstanceByApiKeyFingerprint(apiKeyFingerprint);
  },

  /**
   * Update an env-sourced arr instance by API key fingerprint
   */
  updateEnvInstanceByApiKey(
    apiKeyFingerprint: string,
    patch: UpdateArrInstanceInput,
    credentialInput?: ArrInstanceCredentialWriteInput
  ): boolean {
    const envInstance = db.queryFirst<{ id: number }>(
      "SELECT id FROM arr_instances WHERE api_key_fingerprint = ? AND source = 'env' ORDER BY id LIMIT 1",
      apiKeyFingerprint
    );

    if (!envInstance) {
      return false;
    }

    return updateArrInstance(envInstance.id, patch, credentialInput);
  },

  /**
   * Update an env-sourced arr instance by ID
   */
  updateEnvInstanceById(
    id: number,
    patch: UpdateArrInstanceInput,
    credentialInput?: ArrInstanceCredentialWriteInput
  ): boolean {
    const envInstance = db.queryFirst<{ id: number }>(
      "SELECT id FROM arr_instances WHERE id = ? AND source = 'env' LIMIT 1",
      id
    );

    if (!envInstance) {
      return false;
    }

    return updateArrInstance(id, patch, credentialInput);
  },

  /**
   * Disable env-sourced arr instances that are not active
   */
  disableEnvInstancesMissingApiKeys(activeApiKeyFingerprints: string[]): number {
    if (activeApiKeyFingerprints.length === 0) {
      return db.execute("UPDATE arr_instances SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE source = 'env'");
    }

    const placeholders = activeApiKeyFingerprints.map(() => '?').join(', ');
    return db.execute(
      `UPDATE arr_instances SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE source = 'env' AND api_key_fingerprint NOT IN (${placeholders})`,
      ...activeApiKeyFingerprints
    );
  },

  /**
   * Get enabled arr instances
   */
  getEnabled(): ArrInstance[] {
    return db.query<ArrInstance>(`${arrInstanceSelect} WHERE enabled = 1 ORDER BY name`);
  },

  /**
   * Update an arr instance
   */
  update(id: number, input: UpdateArrInstanceInput, credentialInput?: ArrInstanceCredentialWriteInput): boolean {
    return updateArrInstance(id, input, credentialInput);
  },

  /**
   * Delete an arr instance
   */
  delete(id: number): boolean {
    const affected = db.execute('DELETE FROM arr_instances WHERE id = ?', id);
    return affected > 0;
  },

  /**
   * Check if an instance name already exists
   */
  nameExists(name: string, excludeId?: number): boolean {
    if (excludeId !== undefined) {
      const result = db.queryFirst<{ count: number }>(
        'SELECT COUNT(*) as count FROM arr_instances WHERE name = ? AND id != ?',
        name,
        excludeId
      );
      return (result?.count ?? 0) > 0;
    }

    const result = db.queryFirst<{ count: number }>('SELECT COUNT(*) as count FROM arr_instances WHERE name = ?', name);
    return (result?.count ?? 0) > 0;
  },

  /**
   * Check if an instance with the same API key fingerprint already exists
   */
  apiKeyExists(apiKeyFingerprint: string, excludeId?: number): boolean {
    if (excludeId !== undefined) {
      const result = db.queryFirst<{ count: number }>(
        'SELECT COUNT(*) as count FROM arr_instances WHERE api_key_fingerprint = ? AND id != ?',
        apiKeyFingerprint,
        excludeId
      );
      return (result?.count ?? 0) > 0;
    }

    const result = db.queryFirst<{ count: number }>(
      'SELECT COUNT(*) as count FROM arr_instances WHERE api_key_fingerprint = ?',
      apiKeyFingerprint
    );
    return (result?.count ?? 0) > 0;
  },
};
