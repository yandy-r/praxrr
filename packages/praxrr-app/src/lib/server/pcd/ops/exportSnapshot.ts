import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import { ENTITY_TYPES, type EntityType } from '$shared/pcd/portable.ts';
import { PCDCache } from '../database/cache.ts';
import type { PCDCache as PCDCacheType } from '$pcd/index.ts';

/**
 * Build an ephemeral read-only cache replaying schema + published base ops + exactly the
 * given non-published base ops (loader `replayBaseOpIds`: other drafts are left out, the
 * extras apply after the published ops in sequence order). Tweaks and user layers are never
 * replayed, so exported entity YAML carries only canonical base state, never local overrides.
 * Never registered; the caller must close it.
 */
export async function buildExportSnapshotCache(
  pcdPath: string,
  databaseId: number,
  replayOpIds: ReadonlySet<number>
): Promise<PCDCacheType> {
  const cache = new PCDCache(pcdPath, databaseId);
  try {
    await cache.buildReadOnly({
      layers: new Set<'schema' | 'base'>(['schema', 'base']),
      replayBaseOpIds: replayOpIds,
    });
    // Fail fast when the clone lacks the schema dependency: every base op would warn-skip and
    // serialization would silently emit near-empty YAML (name only) for live entities.
    const rawDb = cache.getRawDb();
    const schemaTables = rawDb
      ? (rawDb
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('custom_formats', 'quality_profiles')"
          )
          .all() as Array<{ name: string }>)
      : [];
    if (schemaTables.length < 2) {
      throw new Error('Export snapshot schema incomplete: expected custom_formats/quality_profiles tables');
    }
  } catch (error) {
    cache.close();
    throw error;
  }
  return cache;
}

export type ExportOpMetadata = {
  operation?: string;
  entity?: string;
  name?: string;
  previousName?: string;
};

export type EntityRef = { type: EntityType; name: string };

export function parseOpMetadata(raw: string | null | undefined): ExportOpMetadata | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as ExportOpMetadata) : null;
  } catch {
    return null;
  }
}

/** `metadata_profile` is the SQL-side entity name for the `lidarr_metadata_profile` portable type. */
function toEntityType(entity: string): EntityType | null {
  const mapped = entity === 'metadata_profile' ? 'lidarr_metadata_profile' : entity;
  return (ENTITY_TYPES as readonly string[]).includes(mapped) ? (mapped as EntityType) : null;
}

/**
 * Derive entities to (re)write and to remove from op metadata. Ops whose entity is not a
 * portable entity type (e.g. nested rows) are ignored; ops with no name are ignored.
 * Creates/updates write (type,name) (renames also remove previousName); deletes remove.
 */
export function deriveEntityChanges(metadatas: ReadonlyArray<ExportOpMetadata | null>): {
  toWrite: EntityRef[];
  toRemove: EntityRef[];
} {
  const write = new Map<string, EntityRef>();
  const remove = new Map<string, EntityRef>();
  const key = (r: EntityRef) => `${r.type}::${r.name}`;

  for (const metadata of metadatas) {
    if (!metadata?.entity || !metadata.name) continue;
    const type = toEntityType(metadata.entity);
    if (!type) continue;
    const ref = { type, name: metadata.name };
    if (metadata.operation === 'delete') {
      remove.set(key(ref), ref);
      write.delete(key(ref));
      continue;
    }
    if (metadata.previousName && metadata.previousName !== metadata.name) {
      const prev = { type, name: metadata.previousName };
      remove.set(key(prev), prev);
      write.delete(key(prev));
    }
    write.set(key(ref), ref);
    remove.delete(key(ref));
  }
  return { toWrite: [...write.values()], toRemove: [...remove.values()] };
}

/** Read upstream metadata from SQL op rows (id order) for the given ids. */
export function loadOpMetadatas(databaseId: number, ids: ReadonlySet<number>): Array<ExportOpMetadata | null> {
  return pcdOpsQueries
    .listByDatabaseAndOrigin(databaseId, 'base')
    .filter((op) => ids.has(op.id))
    .sort((a, b) => (a.sequence ?? a.id) - (b.sequence ?? b.id))
    .map((op) => parseOpMetadata(op.metadata));
}
