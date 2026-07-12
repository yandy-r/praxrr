/**
 * Plugin registry — in-memory, apiVersion-namespaced store of registered plugins (issue #35, Phase-1).
 *
 * Holds the validated manifests the plugin host accepts, keyed by
 * `Map<apiVersion, Map<lowercased id, RegisteredPlugin>>`. Namespacing by `apiVersion` is a parser
 * cache-safety analog: a toggle/rollback across an incompatible contract version cannot resurrect a
 * plugin registered under a different `apiVersion`. Id uniqueness is case-insensitive within a single
 * namespace. The registry remains a pure in-memory container; the host publishes complete snapshots
 * after durable reconciliation succeeds.
 *
 * Imports only the pure `$shared/plugins` contract — nothing from the executor or host — so it sits at
 * the base of the server plugin layer with no runtime import cycle.
 *
 * See docs/plans/35-wasm-plugin-system/plan.md for the authoritative Phase-1 spec.
 */

import type { ExtensionPointId, PluginLifecycleState, PluginManifest } from '$shared/plugins/index.ts';

/**
 * A plugin that passed manifest validation and holds a slot in the registry. `registeredAt` is an ISO-8601
 * timestamp; `lastError` records a non-fatal issue for a plugin left in a degraded lifecycle state.
 */
export interface RegisteredPlugin {
  readonly manifest: PluginManifest;
  readonly sourceDir: string;
  readonly enabled: boolean;
  readonly discovered: boolean;
  readonly state: PluginLifecycleState;
  readonly registeredAt: string;
  readonly lastError?: string;
}

type PluginSnapshot = Map<string, Map<string, RegisteredPlugin>>;

function addToSnapshot(snapshot: PluginSnapshot, plugin: RegisteredPlugin): void {
  const apiVersion = plugin.manifest.apiVersion;
  let namespace = snapshot.get(apiVersion);
  if (!namespace) {
    namespace = new Map<string, RegisteredPlugin>();
    snapshot.set(apiVersion, namespace);
  }

  const key = plugin.manifest.id.toLowerCase();
  if (namespace.has(key)) {
    throw new Error(`Duplicate plugin id '${plugin.manifest.id}' within apiVersion '${apiVersion}'`);
  }
  namespace.set(key, plugin);
}

/**
 * In-memory registry over `Map<apiVersion, Map<lowercased id, RegisteredPlugin>>`. Registration is
 * fail-fast on a case-insensitive duplicate id within an `apiVersion` namespace; the same id may
 * coexist under two different `apiVersion` namespaces, fully isolated.
 */
export class PluginRegistry {
  private byApiVersion = new Map<string, Map<string, RegisteredPlugin>>();

  /**
   * Register a validated manifest, keyed by `(apiVersion, lowercased id)` with `state: 'registered'`.
   * Throws when an id (case-insensitively) is already registered within the same `apiVersion` namespace.
   */
  register(sourceDir: string, manifest: PluginManifest): RegisteredPlugin {
    const namespace = this.namespaceFor(manifest.apiVersion);
    const key = manifest.id.toLowerCase();
    if (namespace.has(key)) {
      throw new Error(`Duplicate plugin id '${manifest.id}' within apiVersion '${manifest.apiVersion}'`);
    }
    const entry: RegisteredPlugin = {
      manifest,
      sourceDir,
      enabled: true,
      discovered: true,
      state: 'registered',
      registeredAt: new Date().toISOString(),
    };
    namespace.set(key, entry);
    return entry;
  }

  /** Remove a plugin by `(apiVersion, id)` (case-insensitive). Returns whether an entry was removed. */
  unregister(apiVersion: string, id: string): boolean {
    const namespace = this.byApiVersion.get(apiVersion);
    if (!namespace) {
      return false;
    }
    const removed = namespace.delete(id.toLowerCase());
    if (namespace.size === 0) {
      this.byApiVersion.delete(apiVersion);
    }
    return removed;
  }

  /** Look up a plugin by `(apiVersion, id)` (case-insensitive). A wrong-namespace lookup returns `undefined`. */
  get(apiVersion: string, id: string): RegisteredPlugin | undefined {
    return this.byApiVersion.get(apiVersion)?.get(id.toLowerCase());
  }

  /** Every plugin registered under an `apiVersion` namespace (empty when the namespace is unknown). */
  listByApiVersion(apiVersion: string): readonly RegisteredPlugin[] {
    const namespace = this.byApiVersion.get(apiVersion);
    return namespace ? Array.from(namespace.values()) : [];
  }

  /** Plugins in an `apiVersion` namespace whose manifest declares the given extension point. */
  listForPoint(apiVersion: string, point: ExtensionPointId): readonly RegisteredPlugin[] {
    return this.listByApiVersion(apiVersion).filter(
      (plugin) => plugin.enabled && plugin.discovered && plugin.manifest.extensionPoints.includes(point)
    );
  }

  /**
   * Atomically replace every namespace with a complete candidate snapshot. The candidate is fully
   * indexed and checked for case-insensitive duplicate ids before the current snapshot is mutated.
   */
  replaceSnapshot(plugins: readonly RegisteredPlugin[]): void {
    const candidate: PluginSnapshot = new Map();

    for (const plugin of plugins) {
      addToSnapshot(candidate, plugin);
    }

    this.byApiVersion = candidate;
  }

  /** Drop every registered plugin across all namespaces (host `reset()` / re-scan / shutdown). */
  clear(): void {
    this.byApiVersion.clear();
  }

  private namespaceFor(apiVersion: string): Map<string, RegisteredPlugin> {
    let namespace = this.byApiVersion.get(apiVersion);
    if (!namespace) {
      namespace = new Map<string, RegisteredPlugin>();
      this.byApiVersion.set(apiVersion, namespace);
    }
    return namespace;
  }
}

/** Process-wide singleton registry shared by the plugin host and tests. */
export const pluginRegistry = new PluginRegistry();
