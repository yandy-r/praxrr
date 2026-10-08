/**
 * Repair legacy export batch ops (YAN-746): rows written before the export_batch
 * metadata flag existed. Marking them `export_batch: true` protects them from the next
 * base-sync orphan sweep; orphaned rows are additionally republished when the upstream
 * entity already reflects the exported change, so their SQL is replayed again and the
 * local cache stops silently reverting published changes.
 */
import { pcdOpsQueries, EXPORT_BATCH_METADATA_KEY, type PcdOp } from '$db/queries/pcdOps.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { logger } from '$logger/logger.ts';
import type { PCDCache } from '$pcd/index.ts';
import { formatDeterministicYaml } from '$pcd/migration/yamlFormatter.ts';
import { serializeEntityPortable } from '$pcd/migration/converter.ts';
import { buildExportSnapshotCache, parseOpMetadata } from './exportSnapshot.ts';
import { parseOpLabelLabels, type EntityRef } from './snapshotEntityFiles.ts';

export interface RepairExportBatchesResult {
  /** published rows that got export_batch:true set */
  flagged: number;
  /** orphaned rows safely flipped back to published (+flag) */
  republished: number;
  /** rows NOT repaired */
  skipped: { entity: string; name: string; reason: string }[];
  /** total matched pre-flag batch rows */
  inspected: number;
}

type BatchOp = { op: PcdOp; entityRefs: EntityRef[] };

function isExportBatchOp(op: PcdOp): boolean {
  if (op.origin !== 'base' || op.source !== 'repo') return false;
  const metadata = parseOpMetadata(op.metadata);
  if (metadata?.operation !== 'export' || metadata.entity !== 'batch') return false;
  return (metadata as { export_batch?: unknown }).export_batch !== true;
}

/** Serialize an entity from a cache to a deterministic YAML document; delete ops mean absent. */
async function serializeForCompare(cache: PCDCache, ref: EntityRef): Promise<string | null> {
  try {
    const portable = await serializeEntityPortable(ref.type, cache, ref.name);
    return formatDeterministicYaml(portable);
  } catch {
    return null;
  }
}

/**
 * Compare `op`'s intended changes against current published upstream state. Returns null when
 * the two caches serialize identically for every affected entity (upstream already reflects the
 * change); otherwise the first differing entity ref.
 */
async function findDivergedEntity(
  currentCache: PCDCache,
  replayedCache: PCDCache,
  entityRefs: EntityRef[]
): Promise<EntityRef | null> {
  for (const ref of entityRefs) {
    const before = await serializeForCompare(currentCache, ref);
    const after = await serializeForCompare(replayedCache, ref);
    if (before !== after) return ref;
  }
  return null;
}

export async function repairExportBatchOps(databaseId: number): Promise<RepairExportBatchesResult> {
  const result: RepairExportBatchesResult = { flagged: 0, republished: 0, skipped: [], inspected: 0 };
  const instance = databaseInstancesQueries.getById(databaseId);
  if (!instance) {
    result.skipped.push({ entity: 'database', name: String(databaseId), reason: 'database not found' });
    return result;
  }
  const pcdPath = instance.local_path;

  const candidates = pcdOpsQueries.listByDatabase(databaseId, 'base').filter(isExportBatchOp);
  result.inspected = candidates.length;

  for (const op of candidates) {
    const metadata = parseOpMetadata(op.metadata);
    const flaggedMetadata = JSON.stringify({ ...(metadata ?? {}), [EXPORT_BATCH_METADATA_KEY]: true });
    if (op.state === 'published') {
      if (pcdOpsQueries.update(op.id, { metadata: flaggedMetadata })) result.flagged += 1;
      continue;
    }
    if (op.state !== 'orphaned') continue;

    const entityRefs = parseOpLabelLabels(op.sql);
    if (entityRefs.length === 0) {
      result.skipped.push({
        entity: 'batch',
        name: `op ${op.id}`,
        reason: 'no parseable op labels in batch SQL',
      });
      continue;
    }

    let currentCache: PCDCache | null = null;
    let replayedCache: PCDCache | null = null;
    try {
      currentCache = await buildExportSnapshotCache(pcdPath, databaseId, new Set());
      replayedCache = await buildExportSnapshotCache(pcdPath, databaseId, new Set([op.id]));
      const diverged = await findDivergedEntity(currentCache, replayedCache, entityRefs);
      if (diverged) {
        result.skipped.push({
          entity: diverged.type,
          name: diverged.name,
          reason: 'upstream changed since export',
        });
        continue;
      }
      if (pcdOpsQueries.update(op.id, { state: 'published', metadata: flaggedMetadata })) {
        result.republished += 1;
      }
    } catch (error) {
      result.skipped.push({
        entity: 'batch',
        name: `op ${op.id}`,
        reason: `snapshot compare failed: ${String(error)}`,
      });
    } finally {
      replayedCache?.close();
      currentCache?.close();
    }
  }

  if (result.flagged || result.republished || result.skipped.length > 0) {
    await logger.info('Repaired legacy export batch ops', {
      source: 'PCDExporter',
      meta: {
        databaseId,
        inspected: result.inspected,
        flagged: result.flagged,
        republished: result.republished,
        skipped: result.skipped.length,
      },
    });
  }
  return result;
}
