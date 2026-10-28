/**
 * Bundle dependency closure.
 *
 * Walks the forward dependency edges of the requested root entities (quality profile -> custom
 * formats, custom format -> regular expressions) and serializes every reachable entity into
 * portable bundle entries, ordered dependency-first. Other entity types are leaves and export
 * standalone. Uses the shared graph edge catalog so there is exactly one definition of each edge.
 */

import type { PCDCache } from '$pcd/database/cache.ts';
import { getOutgoingEdges } from '$pcd/graph/edges.ts';
import type { NodeKind, NodeRef } from '$pcd/graph/types.ts';
import * as serialize from '$pcd/entities/serialize.ts';
import type { PcdBundleEntry, PcdBundleMissingRef } from '$shared/pcd/bundle.ts';
import { BUNDLE_MAX_ENTITIES, bundleEntityKey } from '$shared/pcd/bundle.ts';
import type { EntityType, PortableEntityData } from '$shared/pcd/portable.ts';

export interface BundleRoot {
  entityType: EntityType;
  name: string;
}

export interface BundleClosure {
  entries: PcdBundleEntry[];
  /** Dependencies referenced by an exported entity that do not exist in the source database. */
  missing: PcdBundleMissingRef[];
  /** True when the serialized-entry cap was reached and the traversal stopped expanding. */
  truncated: boolean;
}

/** Dependency-first export order: regular expressions, custom formats, quality profiles, leaves. */
export function bundleEntityRank(entityType: EntityType): number {
  switch (entityType) {
    case 'regular_expression':
      return 0;
    case 'custom_format':
      return 1;
    case 'quality_profile':
      return 2;
    default:
      return 3;
  }
}

/** Stable sort of entries into dependency-first order. */
export function sortBundleEntries<T extends { entityType: EntityType }>(entries: readonly T[]): T[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => bundleEntityRank(a.entry.entityType) - bundleEntityRank(b.entry.entityType) || a.index - b.index)
    .map(({ entry }) => entry);
}

/** Serialize one entity into its portable payload. Throws `<Type> "<name>" not found` when absent. */
export async function serializeEntityByType(
  cache: PCDCache,
  entityType: EntityType,
  name: string
): Promise<PortableEntityData> {
  switch (entityType) {
    case 'delay_profile':
      return serialize.serializeDelayProfile(cache, name);
    case 'regular_expression':
      return serialize.serializeRegularExpression(cache, name);
    case 'custom_format':
      return serialize.serializeCustomFormat(cache, name);
    case 'quality_profile':
      return serialize.serializeQualityProfile(cache, name);
    case 'radarr_naming':
      return serialize.serializeRadarrNaming(cache, name);
    case 'sonarr_naming':
      return serialize.serializeSonarrNaming(cache, name);
    case 'lidarr_naming':
      return serialize.serializeLidarrNaming(cache, name);
    case 'radarr_media_settings':
      return serialize.serializeRadarrMediaSettings(cache, name);
    case 'sonarr_media_settings':
      return serialize.serializeSonarrMediaSettings(cache, name);
    case 'lidarr_media_settings':
      return serialize.serializeLidarrMediaSettings(cache, name);
    case 'radarr_quality_definitions':
      return serialize.serializeRadarrQualityDefinitions(cache, name);
    case 'sonarr_quality_definitions':
      return serialize.serializeSonarrQualityDefinitions(cache, name);
    case 'lidarr_quality_definitions':
      return serialize.serializeLidarrQualityDefinitions(cache, name);
    case 'lidarr_metadata_profile':
      return serialize.serializeLidarrMetadataProfile(cache, name);
    default: {
      const exhaustive: never = entityType;
      throw new Error(`Unsupported entity type: ${exhaustive}`);
    }
  }
}

function nodeKindOf(entityType: EntityType): NodeKind | null {
  switch (entityType) {
    case 'quality_profile':
    case 'custom_format':
    case 'regular_expression':
      return entityType;
    default:
      return null;
  }
}

/**
 * Collect the dependency closure of `roots`. Roots missing from `cache` throw
 * `Error('<entityType> "<name>" not found')` (route maps to 404). A missing dependency is
 * reported in `missing` instead of throwing.
 */
export async function collectBundleClosure(cache: PCDCache, roots: ReadonlyArray<BundleRoot>): Promise<BundleClosure> {
  const entries = new Map<string, PcdBundleEntry>();
  const missing: PcdBundleMissingRef[] = [];
  const queued = new Set<string>();
  let truncated = false;

  interface QueueItem {
    entityType: EntityType;
    name: string;
    isRoot: boolean;
    from?: { entityType: EntityType; name: string };
  }
  const queue: QueueItem[] = [];

  for (const root of roots) {
    const key = bundleEntityKey(root.entityType, root.name);
    if (queued.has(key)) continue;
    queued.add(key);
    queue.push({ entityType: root.entityType, name: root.name, isRoot: true });
  }

  for (let head = 0; head < queue.length; head++) {
    const item = queue[head];
    if (entries.size >= BUNDLE_MAX_ENTITIES) {
      truncated = true;
      break;
    }

    let data: PortableEntityData;
    try {
      data = await serializeEntityByType(cache, item.entityType, item.name);
    } catch (error) {
      if (item.isRoot) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message.includes('not found') ? message : `${item.entityType} "${item.name}" not found`);
      }
      if (item.from) {
        missing.push({
          fromType: item.from.entityType,
          fromName: item.from.name,
          toType: item.entityType,
          toName: item.name,
        });
      }
      continue;
    }

    entries.set(bundleEntityKey(item.entityType, item.name), { entityType: item.entityType, data });

    const kind = nodeKindOf(item.entityType);
    if (!kind) continue;
    const node: NodeRef = { kind, name: item.name };
    const edges = await getOutgoingEdges(cache, node);
    for (const edge of edges) {
      if (edge.to.kind !== 'custom_format' && edge.to.kind !== 'regular_expression') continue;
      const toType: EntityType = edge.to.kind;
      const key = bundleEntityKey(toType, edge.to.name);
      if (queued.has(key)) continue;
      queued.add(key);
      queue.push({
        entityType: toType,
        name: edge.to.name,
        isRoot: false,
        from: { entityType: item.entityType, name: item.name },
      });
    }
  }

  return { entries: sortBundleEntries([...entries.values()]), missing, truncated };
}
