/**
 * Bundle export: serialize one or more entities (optionally with their dependency closure)
 * into a portable `PcdBundle`.
 */

import { getCache } from '$pcd/database/registry.ts';
import { BUNDLE_MAX_ENTITIES, BUNDLE_VERSION, bundleEntityKey, type PcdBundle } from '$shared/pcd/bundle.ts';
import type { EntityType } from '$shared/pcd/portable.ts';
import { collectBundleClosure, serializeEntityByType, sortBundleEntries, type BundleClosure } from './closure.ts';

export class BundleExportLimitError extends Error {
  constructor(count: number) {
    super(`Bundle would exceed the maximum of ${BUNDLE_MAX_ENTITIES} entities (got ${count})`);
    this.name = 'BundleExportLimitError';
  }
}

/**
 * Export `names` of `entityType` from database `databaseId` as a bundle.
 *
 * - `includeDependencies=true`: roots plus every custom format / regular expression they reference.
 * - `includeDependencies=false`: exactly the named entities.
 *
 * Entries are ordered dependency-first. Throws an error containing `not found` when a root does
 * not exist, and `BundleExportLimitError` when the bundle would exceed `BUNDLE_MAX_ENTITIES`.
 */
export interface BundleExportResult {
  bundle: PcdBundle;
  missing: BundleClosure['missing'];
  truncated: boolean;
}

export async function exportBundle(
  databaseId: number,
  entityType: EntityType,
  names: readonly string[],
  includeDependencies: boolean
): Promise<BundleExportResult> {
  const cache = getCache(databaseId);
  if (!cache) {
    throw new Error('Database cache not available');
  }

  const seen = new Set<string>();
  const roots: Array<{ entityType: EntityType; name: string }> = [];
  for (const name of names) {
    const key = bundleEntityKey(entityType, name);
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push({ entityType, name });
  }
  if (roots.length > BUNDLE_MAX_ENTITIES) {
    throw new BundleExportLimitError(roots.length);
  }

  if (!includeDependencies) {
    const entries = [];
    for (const root of roots) {
      entries.push({ entityType, data: await serializeEntityByType(cache, entityType, root.name) });
    }
    return { bundle: { version: BUNDLE_VERSION, entities: sortBundleEntries(entries) }, missing: [], truncated: false };
  }

  const closure = await collectBundleClosure(cache, roots);
  return {
    bundle: { version: BUNDLE_VERSION, entities: closure.entries },
    missing: closure.missing,
    truncated: closure.truncated,
  };
}
