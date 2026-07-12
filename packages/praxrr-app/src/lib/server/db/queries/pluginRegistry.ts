import { type PluginLifecycleState, type PluginManifest, validatePluginManifest } from '$shared/plugins/index.ts';
import { db } from '../db.ts';

/** Raw SQLite row for `plugin_registry`. INTEGER flags are mapped at the repository boundary. */
export interface PluginRegistryRow {
  api_version: string;
  plugin_id: string;
  manifest_json: string;
  enabled: number;
  discovered: number;
  lifecycle_state: PluginLifecycleState;
  last_error: string | null;
  registered_at: string;
  created_at: string;
  updated_at: string;
}

/** Validated durable plugin state returned to the host and response boundary. */
export interface PluginRegistryRecord {
  readonly apiVersion: string;
  readonly pluginId: string;
  readonly manifest: PluginManifest;
  readonly enabled: boolean;
  readonly discovered: boolean;
  readonly state: PluginLifecycleState;
  readonly lastError: string | null;
  readonly registeredAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One validated plugin discovered by the current scan. */
export interface ReconcilePluginInput {
  readonly manifest: PluginManifest;
  readonly state?: PluginLifecycleState;
  readonly lastError?: string | null;
}

function parseManifest(row: PluginRegistryRow): PluginManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(row.manifest_json);
  } catch (error) {
    throw new Error(`Persisted manifest for plugin '${row.plugin_id}' is not valid JSON`, { cause: error });
  }

  const result = validatePluginManifest(raw);
  if (!result.ok) {
    throw new Error(`Persisted manifest for plugin '${row.plugin_id}' failed validation`);
  }
  if (result.manifest.apiVersion !== row.api_version || result.manifest.id !== row.plugin_id) {
    throw new Error(`Persisted manifest identity does not match plugin registry row '${row.plugin_id}'`);
  }
  return result.manifest;
}

function rowToRecord(row: PluginRegistryRow): PluginRegistryRecord {
  return {
    apiVersion: row.api_version,
    pluginId: row.plugin_id,
    manifest: parseManifest(row),
    enabled: row.enabled === 1,
    discovered: row.discovered === 1,
    state: row.lifecycle_state,
    lastError: row.last_error,
    registeredAt: row.registered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateReconcileInputs(inputs: readonly ReconcilePluginInput[]): void {
  const identities = new Set<string>();
  for (const input of inputs) {
    const result = validatePluginManifest(input.manifest);
    if (!result.ok) {
      throw new Error(`Cannot reconcile invalid manifest for plugin '${input.manifest.id}'`);
    }

    const identity = `${input.manifest.apiVersion}\u0000${input.manifest.id.toLowerCase()}`;
    if (identities.has(identity)) {
      throw new Error(`Duplicate plugin id '${input.manifest.id}' within apiVersion '${input.manifest.apiVersion}'`);
    }
    identities.add(identity);
  }
}

/** Durable plugin queries keyed by exact API version and case-insensitive plugin id. */
export const pluginRegistryQueries = {
  /** List every durable plugin, optionally within one exact API-version namespace. */
  list(apiVersion?: string): readonly PluginRegistryRecord[] {
    const rows =
      apiVersion === undefined
        ? db.query<PluginRegistryRow>('SELECT * FROM plugin_registry ORDER BY api_version, plugin_id COLLATE NOCASE')
        : db.query<PluginRegistryRow>(
            `SELECT * FROM plugin_registry
				 WHERE api_version = ?
				 ORDER BY plugin_id COLLATE NOCASE`,
            apiVersion
          );
    return rows.map(rowToRecord);
  },

  /** Get one plugin by namespace-qualified identity. */
  get(apiVersion: string, pluginId: string): PluginRegistryRecord | undefined {
    const row = db.queryFirst<PluginRegistryRow>(
      `SELECT * FROM plugin_registry
			 WHERE api_version = ? AND plugin_id = ? COLLATE NOCASE`,
      apiVersion,
      pluginId
    );
    return row ? rowToRecord(row) : undefined;
  },

  /** Update an existing enablement decision and return the fresh row. */
  setEnabled(apiVersion: string, pluginId: string, enabled: boolean): PluginRegistryRecord | undefined {
    const affected = db.execute(
      `UPDATE plugin_registry
			 SET enabled = ?, updated_at = CURRENT_TIMESTAMP
			 WHERE api_version = ? AND plugin_id = ? COLLATE NOCASE`,
      enabled ? 1 : 0,
      apiVersion,
      pluginId
    );
    return affected > 0 ? this.get(apiVersion, pluginId) : undefined;
  },

  /**
   * Atomically reconcile a successful scan. Missing rows remain durable but become undiscovered;
   * current manifests are upserted without changing an existing administrator enablement decision.
   */
  async reconcile(inputs: readonly ReconcilePluginInput[]): Promise<readonly PluginRegistryRecord[]> {
    validateReconcileInputs(inputs);

    return await db.transaction(() => {
      db.execute(
        `UPDATE plugin_registry
			 SET discovered = 0,
			     lifecycle_state = 'unloaded',
			     last_error = NULL,
			     updated_at = CURRENT_TIMESTAMP
			 WHERE discovered != 0 OR lifecycle_state != 'unloaded' OR last_error IS NOT NULL`
      );

      for (const input of inputs) {
        const state = input.state ?? 'registered';
        db.execute(
          `INSERT INTO plugin_registry
				 (api_version, plugin_id, manifest_json, discovered, lifecycle_state, last_error)
			 VALUES (?, ?, ?, 1, ?, ?)
			 ON CONFLICT (api_version, plugin_id COLLATE NOCASE) DO UPDATE SET
			   api_version = excluded.api_version,
			   plugin_id = excluded.plugin_id,
			   manifest_json = excluded.manifest_json,
			   discovered = 1,
			   lifecycle_state = excluded.lifecycle_state,
			   last_error = excluded.last_error,
			   updated_at = CURRENT_TIMESTAMP`,
          input.manifest.apiVersion,
          input.manifest.id,
          JSON.stringify(input.manifest),
          state,
          input.lastError ?? null
        );
      }

      return this.list();
    });
  },
};
