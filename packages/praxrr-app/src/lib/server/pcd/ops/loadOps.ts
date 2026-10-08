/**
 * PCD Operations Loader (DB-first)
 * Loads base/user ops from the database and schema/tweaks from files.
 *
 * Schema and tweaks layers are SQL-backed runtime boundaries and remain required for cache
 * compilation and validation.
 */

import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import type { PcdOp, PcdOpState } from '$db/queries/pcdOps.ts';
import { loadOperationsFromDir } from '../utils/operations.ts';
import type { Operation } from '../core/types.ts';

const DRAFT_SEQUENCE_BASE = 3_000_000_000;

function toOperation(op: PcdOp, layer: 'base' | 'user', orderOffset = 0): Operation {
  const order = (op.sequence ?? op.id) + orderOffset;
  const filename = op.filename ?? `pcd_op_${op.id}.sql`;
  return {
    filename,
    filepath: `pcd_ops:${op.id}`,
    sql: op.sql,
    order,
    layer,
  };
}

function parseOpIdFromFilepath(filepath: string): number {
  return Number(filepath.slice('pcd_ops:'.length));
}

function compareOperations(a: Operation, b: Operation): number {
  if (a.order !== b.order) return a.order - b.order;
  if (a.filename !== b.filename) return a.filename.localeCompare(b.filename);
  if (a.filepath === b.filepath) return 0;

  return a.filepath.localeCompare(b.filepath);
}

function loadDbOps(databaseId: number, origin: 'base' | 'user', states: PcdOpState[], orderOffset = 0): Operation[] {
  const rows = pcdOpsQueries.listByDatabaseAndOrigin(databaseId, origin, { states });
  const operations = rows.map((op) => toOperation(op, origin, orderOffset));
  return operations.sort(compareOperations);
}

/**
 * Load exactly the ops whose raw `pcd_ops.id` is in `ids`, regardless of their CURRENT
 * state. Used by point-in-time snapshot replay (rollback, issue #16): membership is the
 * reconstructed published-op set for a snapshot, so every member is mapped as a published
 * Operation (no draft-sequence offset). Filtering is on raw `op.id`, never `Operation.order`,
 * so base-draft high-sequence rows cannot leak in.
 */
function loadDbOpsByIds(databaseId: number, origin: 'base' | 'user', ids: ReadonlySet<number>): Operation[] {
  if (ids.size === 0) {
    return [];
  }
  const rows = pcdOpsQueries.listByDatabaseAndOrigin(databaseId, origin);
  const operations = rows.filter((op) => ids.has(op.id)).map((op) => toOperation(op, origin));
  return operations.sort(compareOperations);
}

/**
 * Resolve the schema dependency ops path.
 * Supports both "deps/schema" (upstream) and "deps/praxrr-schema" (fork) layouts.
 */
async function resolveSchemaOpsPath(pcdPath: string): Promise<string> {
  const depsPath = `${pcdPath}/deps`;
  try {
    for await (const entry of Deno.readDir(depsPath)) {
      if (entry.isDirectory && entry.name.includes('schema')) {
        return `${depsPath}/${entry.name}/ops`;
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      // deps directory doesn't exist
    } else {
      throw new Error(`Failed to resolve schema ops path: cannot read ${depsPath}: ${String(error)}`);
    }
  }
  // Fallback to original hardcoded path
  return `${pcdPath}/deps/schema/ops`;
}

export interface LoadOperationsOptions {
  /**
   * Point-in-time snapshot replay (rollback, issue #16): when present, the base and user
   * layers are loaded as EXACTLY the ops whose id is in this set (the reconstructed
   * published-op set for a snapshot), ignoring current op state and base drafts. Schema and
   * tweaks file layers are still loaded normally — the snapshot fingerprint only covers
   * `pcd_ops` base+user, so file layers use their current on-disk content.
   */
  snapshotOpIds?: ReadonlySet<number>;
  /**
   * Published base op ids to leave out of the normal (non-snapshot) base layer load.
   * Used by the base-op import cache so refreshed entities look absent while every other
   * published/draft base op keeps its normal ordering (YAN-461). Ignored with `snapshotOpIds`.
   */
  excludeBaseOpIds?: ReadonlySet<number>;
  /**
   * When present (non-snapshot load), the base layer is published ops followed by EXACTLY the
   * non-published base ops whose id is in this set (instead of all drafts). Used by the export
   * snapshot cache to replay published base + the drafts being exported, and by the legacy
   * export-batch repair to replay one orphaned op. Ignored with `snapshotOpIds`.
   */
  replayBaseOpIds?: ReadonlySet<number>;
}

/**
 * Load all operations for a PCD in layer order:
 * 1. Schema layer (from dependency)
 * 2. Base layer (published, then drafts)
 * 3. Tweaks layer (from PCD, optional)
 * 4. User ops layer (local user modifications)
 *
 * When `options.snapshotOpIds` is provided the base/user layers instead replay exactly that
 * id set (all as published, no base drafts) for point-in-time snapshot reconstruction.
 */
export async function loadAllOperations(
  pcdPath: string,
  databaseInstanceId: number,
  options?: LoadOperationsOptions
): Promise<Operation[]> {
  const allOperations: Operation[] = [];
  const snapshotOpIds = options?.snapshotOpIds;

  // 1. Load schema layer from dependency (files)
  const schemaPath = await resolveSchemaOpsPath(pcdPath);
  const schemaOps = await loadOperationsFromDir(schemaPath, 'schema');
  allOperations.push(...schemaOps);

  // 2. Load base layer from DB
  if (snapshotOpIds) {
    allOperations.push(...loadDbOpsByIds(databaseInstanceId, 'base', snapshotOpIds));
  } else {
    // published, then drafts
    const excludeBaseOpIds = options?.excludeBaseOpIds;
    const basePublished = loadDbOps(databaseInstanceId, 'base', ['published']).filter(
      (operation) => !excludeBaseOpIds?.has(parseOpIdFromFilepath(operation.filepath))
    );
    allOperations.push(...basePublished);
    const replayBaseOpIds = options?.replayBaseOpIds;
    const baseDrafts = replayBaseOpIds
      ? pcdOpsQueries
          .listByDatabaseAndOrigin(databaseInstanceId, 'base')
          .filter((op) => op.state !== 'published' && replayBaseOpIds.has(op.id))
          .map((op) => toOperation(op, 'base', DRAFT_SEQUENCE_BASE))
          .sort(compareOperations)
      : loadDbOps(databaseInstanceId, 'base', ['draft'], DRAFT_SEQUENCE_BASE);
    allOperations.push(...baseDrafts);
  }

  // 3. Load tweaks layer (files, optional)
  const tweaksPath = `${pcdPath}/tweaks`;
  const tweakOps = await loadOperationsFromDir(tweaksPath, 'tweaks');
  allOperations.push(...tweakOps);

  // 4. User ops layer (DB)
  if (snapshotOpIds) {
    allOperations.push(...loadDbOpsByIds(databaseInstanceId, 'user', snapshotOpIds));
  } else {
    const userOps = loadDbOps(databaseInstanceId, 'user', ['published']);
    allOperations.push(...userOps);
  }

  return allOperations;
}
