/**
 * Shared PCD resolved-entity helpers used by both the tool and resource registries.
 *
 * The resolved-entity type union and the cache-lookup precedence (db exists? cache compiled?) are
 * identical for `list_resolved_entities`/`get_resolved_entity` and their `praxrr://` resource
 * equivalents, so they live here rather than being duplicated.
 */

import { pcdManager } from '$pcd/core/manager.ts';
import { ARR_AGNOSTIC_READERS, PER_ARR_READERS, type ResolvedEntityType } from '$pcd/index.ts';

/** The compiled per-database cache. Derived from the manager to avoid a direct cache-type import. */
export type PcdCache = NonNullable<ReturnType<typeof pcdManager.getCache>>;

/** Single source of truth for the resolved-entity type union: the readers' dispatch tables. */
const RESOLVED_ENTITY_TYPES = new Set<string>([...Object.keys(ARR_AGNOSTIC_READERS), ...Object.keys(PER_ARR_READERS)]);

/** The known resolved-entity type names, for tool/resource input schemas. */
export const RESOLVED_ENTITY_TYPE_VALUES: readonly string[] = [...RESOLVED_ENTITY_TYPES];

export function isKnownResolvedEntityType(value: string): value is ResolvedEntityType {
  return RESOLVED_ENTITY_TYPES.has(value);
}

export type CacheLookup = { ok: true; cache: PcdCache } | { ok: false; reason: string };

/**
 * Resolve a database's compiled cache. Distinguishes "no such database" from "cache not ready"
 * (a disabled or never-compiled DB returns a row but no cache). The caller decides whether the
 * failure is a domain error (tools) or an invalid-params protocol error (resources).
 */
export function lookupDatabaseCache(databaseId: number): CacheLookup {
  if (!pcdManager.getById(databaseId)) {
    return { ok: false, reason: `Database ${databaseId} not found` };
  }
  const cache = pcdManager.getCache(databaseId);
  if (!cache) {
    return { ok: false, reason: `Database ${databaseId} cache is not ready` };
  }
  return { ok: true, cache };
}
