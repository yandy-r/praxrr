/**
 * PCD Operations Loader (DB-first)
 * Loads base/user ops from the database and schema/tweaks from files.
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
  } catch {
    // deps directory doesn't exist
  }
  // Fallback to original hardcoded path
  return `${pcdPath}/deps/schema/ops`;
}

/**
 * Load all operations for a PCD in layer order:
 * 1. Schema layer (from dependency)
 * 2. Base layer (published, then drafts)
 * 3. Tweaks layer (from PCD, optional)
 * 4. User ops layer (local user modifications)
 */
export async function loadAllOperations(pcdPath: string, databaseInstanceId: number): Promise<Operation[]> {
  const allOperations: Operation[] = [];

  // 1. Load schema layer from dependency (files)
  const schemaPath = await resolveSchemaOpsPath(pcdPath);
  const schemaOps = await loadOperationsFromDir(schemaPath, 'schema');
  allOperations.push(...schemaOps);

  // 2. Load base layer from DB: published, then drafts
  const basePublished = loadDbOps(databaseInstanceId, 'base', ['published']);
  allOperations.push(...basePublished);
  const baseDrafts = loadDbOps(databaseInstanceId, 'base', ['draft'], DRAFT_SEQUENCE_BASE);
  allOperations.push(...baseDrafts);

  // 3. Load tweaks layer (files, optional)
  const tweaksPath = `${pcdPath}/tweaks`;
  const tweakOps = await loadOperationsFromDir(tweaksPath, 'tweaks');
  allOperations.push(...tweakOps);

  // 4. User ops layer (DB)
  const userOps = loadDbOps(databaseInstanceId, 'user', ['published']);
  allOperations.push(...userOps);

  return allOperations;
}
