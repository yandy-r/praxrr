import { db } from '../db.ts';

/**
 * Types for arr_instances table
 */
export interface ArrInstance {
  id: number;
  name: string;
  type: string;
  url: string;
  external_url: string | null;
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
  apiKey?: string;
  tags?: string[];
  enabled?: boolean;
  source?: ArrInstanceSource;
}

/**
 * Normalize optional external URL values by trimming and converting blank/whitespace
 * input to NULL for stable DB storage.
 */
function normalizeExternalUrl(externalUrl: string | null | undefined): string | null {
  return externalUrl?.trim() || null;
}

/**
 * All queries for arr_instances table
 */
export const arrInstancesQueries = {
  /**
   * Create a new arr instance
   */
  create(input: CreateArrInstanceInput): number {
    const tagsJson = input.tags && input.tags.length > 0 ? JSON.stringify(input.tags) : null;
    const enabled = input.enabled !== false ? 1 : 0;
    const externalUrl = normalizeExternalUrl(input.externalUrl);
    const source = input.source ?? 'ui';

    db.execute(
      `INSERT INTO arr_instances (name, type, url, external_url, api_key, tags, enabled, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      input.name,
      input.type,
      input.url,
      externalUrl,
      input.apiKey,
      tagsJson,
      enabled,
      source
    );

    // Get the last inserted ID
    const result = db.queryFirst<{ id: number }>('SELECT last_insert_rowid() as id');
    return result?.id ?? 0;
  },

  /**
   * Get an arr instance by ID
   */
  getById(id: number): ArrInstance | undefined {
    return db.queryFirst<ArrInstance>('SELECT * FROM arr_instances WHERE id = ?', id);
  },

  /**
   * Get all arr instances
   */
  getAll(): ArrInstance[] {
    return db.query<ArrInstance>('SELECT * FROM arr_instances ORDER BY name');
  },

  /**
   * Get arr instances by type
   */
  getByType(type: string): ArrInstance[] {
    return db.query<ArrInstance>('SELECT * FROM arr_instances WHERE type = ? ORDER BY name', type);
  },

  /**
   * Get arr instances by source
   */
  getBySource(source: ArrInstanceSource): ArrInstance[] {
    return db.query<ArrInstance>('SELECT * FROM arr_instances WHERE source = ? ORDER BY id', source);
  },

  /**
   * Get an arr instance by API key
   */
  getByApiKey(apiKey: string): ArrInstance | undefined {
    return db.queryFirst<ArrInstance>('SELECT * FROM arr_instances WHERE api_key = ? ORDER BY id LIMIT 1', apiKey);
  },

  /**
   * Update an env-sourced arr instance by API key
   */
  updateEnvInstanceByApiKey(apiKey: string, patch: UpdateArrInstanceInput): boolean {
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

    if (updates.length === 0) {
      return false;
    }

    const envInstance = db.queryFirst<{ id: number }>(
      "SELECT id FROM arr_instances WHERE api_key = ? AND source = 'env' ORDER BY id LIMIT 1",
      apiKey
    );

    if (!envInstance) {
      return false;
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(envInstance.id);

    const affected = db.execute(`UPDATE arr_instances SET ${updates.join(', ')} WHERE id = ?`, ...params);

    return affected > 0;
  },

  /**
   * Disable env-sourced arr instances that are not active
   */
  disableEnvInstancesMissingApiKeys(activeApiKeys: string[]): number {
    if (activeApiKeys.length === 0) {
      return db.execute("UPDATE arr_instances SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE source = 'env'");
    }

    const placeholders = activeApiKeys.map(() => '?').join(', ');
    return db.execute(
      `UPDATE arr_instances SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE source = 'env' AND api_key NOT IN (${placeholders})`,
      ...activeApiKeys
    );
  },

  /**
   * Get enabled arr instances
   */
  getEnabled(): ArrInstance[] {
    return db.query<ArrInstance>('SELECT * FROM arr_instances WHERE enabled = 1 ORDER BY name');
  },

  /**
   * Update an arr instance
   */
  update(id: number, input: UpdateArrInstanceInput): boolean {
    const updates: string[] = [];
    const params: (string | number | null)[] = [];

    if (input.name !== undefined) {
      updates.push('name = ?');
      params.push(input.name);
    }
    if (input.type !== undefined) {
      updates.push('type = ?');
      params.push(input.type);
    }
    if (input.url !== undefined) {
      updates.push('url = ?');
      params.push(input.url);
    }
    if (input.externalUrl !== undefined) {
      updates.push('external_url = ?');
      params.push(normalizeExternalUrl(input.externalUrl));
    }
    if (input.apiKey !== undefined) {
      updates.push('api_key = ?');
      params.push(input.apiKey);
    }
    if (input.tags !== undefined) {
      updates.push('tags = ?');
      params.push(input.tags.length > 0 ? JSON.stringify(input.tags) : null);
    }
    if (input.enabled !== undefined) {
      updates.push('enabled = ?');
      params.push(input.enabled ? 1 : 0);
    }

    if (updates.length === 0) {
      return false;
    }

    // Add updated_at
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    const affected = db.execute(`UPDATE arr_instances SET ${updates.join(', ')} WHERE id = ?`, ...params);

    return affected > 0;
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
   * Check if an instance with the same API key already exists
   */
  apiKeyExists(apiKey: string, excludeId?: number): boolean {
    if (excludeId !== undefined) {
      const result = db.queryFirst<{ count: number }>(
        'SELECT COUNT(*) as count FROM arr_instances WHERE api_key = ? AND id != ?',
        apiKey,
        excludeId
      );
      return (result?.count ?? 0) > 0;
    }

    const result = db.queryFirst<{ count: number }>(
      'SELECT COUNT(*) as count FROM arr_instances WHERE api_key = ?',
      apiKey
    );
    return (result?.count ?? 0) > 0;
  },
};
