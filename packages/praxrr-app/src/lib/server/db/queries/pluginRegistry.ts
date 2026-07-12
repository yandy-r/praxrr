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

/**
 * Maximum missing-plugin decisions retained across scans. The newest tombstones win, so recently
 * removed plugins can reappear with their prior enablement while durable management work remains
 * bounded by the current discovery set plus this historical allowance.
 */
export const PLUGIN_REGISTRY_TOMBSTONE_LIMIT = 256;

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

const SQLITE_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
const RFC3339_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Normalize SQLite's UTC timestamp format to the RFC 3339 shape promised by OpenAPI. */
function normalizeTimestamp(value: string, column: string, pluginId: string): string {
  const candidate = SQLITE_UTC_TIMESTAMP.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  if (!RFC3339_TIMESTAMP.test(candidate)) {
    throw new Error(`Persisted ${column} for plugin '${pluginId}' is not a valid timestamp`);
  }

  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Persisted ${column} for plugin '${pluginId}' is not a valid timestamp`);
  }
  return parsed.toISOString();
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
    registeredAt: normalizeTimestamp(row.registered_at, 'registered_at', row.plugin_id),
    createdAt: normalizeTimestamp(row.created_at, 'created_at', row.plugin_id),
    updatedAt: normalizeTimestamp(row.updated_at, 'updated_at', row.plugin_id),
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
   * Atomically reconcile a successful scan. Missing rows become bounded tombstones ordered by the
   * time they became missing (or their enablement was last changed); current manifests are upserted
   * without changing an existing administrator enablement decision and are never pruned.
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

      db.execute(
        `DELETE FROM plugin_registry
			 WHERE discovered = 0
			   AND rowid NOT IN (
			     SELECT rowid
			     FROM plugin_registry
			     WHERE discovered = 0
			     ORDER BY updated_at DESC, api_version, plugin_id COLLATE NOCASE
			     LIMIT ?
			   )`,
        PLUGIN_REGISTRY_TOMBSTONE_LIMIT
      );

      return this.list();
    });
  },
};
