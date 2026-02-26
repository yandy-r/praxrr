import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import { uuid } from '$shared/utils/uuid.ts';
import { AUTO_ALIGN_ENTITIES } from '$pcd/entities/registry.ts';

// ── Types ──

export type StoredOpMetadata = {
  operation?: string;
  entity?: string;
  name?: string;
  previousName?: string;
  summary?: string;
  title?: string;
  stable_key?: { key?: string; value?: string };
  changed_fields?: string[];
};

export type StoredDesiredState = Record<string, unknown>;

// ── Parsing ──

/**
 * Safely parse a JSON string into a typed value.
 *
 * @param raw - Raw JSON string to parse, or null
 * @returns Parsed value cast to `T`, or null if the input is empty or unparseable
 */
export function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Extract the numeric op ID from a `pcd_ops:<id>` filepath string.
 *
 * @param path - Filepath string of the form `pcd_ops:<id>`, or null/undefined
 * @returns The numeric op ID, or null if the path is absent or malformed
 */
export function parseOpIdFromFilepath(path?: string | null): number | null {
  if (!path) return null;
  if (!path.startsWith('pcd_ops:')) return null;
  const opId = Number(path.slice('pcd_ops:'.length));
  return Number.isFinite(opId) ? opId : null;
}

// ── Op lifecycle ──

/**
 * Mark an op as superseded by a newer op and record the transition in history.
 *
 * @param databaseId - The PCD database instance ID
 * @param oldOpId - ID of the op to supersede
 * @param newOpId - ID of the replacement op, or null (no-op when null)
 * @returns `true` if the op was successfully updated, `false` otherwise
 */
export async function supersedeOp(databaseId: number, oldOpId: number, newOpId: number | null): Promise<boolean> {
  if (!newOpId) return false;
  const updated = pcdOpsQueries.update(oldOpId, {
    state: 'superseded',
    supersededByOpId: newOpId,
  });
  if (!updated) return false;

  pcdOpHistoryQueries.create({
    opId: oldOpId,
    databaseId,
    batchId: uuid(),
    status: 'superseded',
  });
  return true;
}

/**
 * Mark an op as dropped and record the transition in history.
 *
 * @param databaseId - The PCD database instance ID
 * @param opId - ID of the op to drop
 * @returns `true` if the op was successfully updated, `false` otherwise
 */
export async function dropOp(databaseId: number, opId: number): Promise<boolean> {
  const updated = pcdOpsQueries.update(opId, { state: 'dropped' });
  if (!updated) return false;
  pcdOpHistoryQueries.create({
    opId,
    databaseId,
    batchId: uuid(),
    status: 'dropped',
  });
  return true;
}

// ── Rename chain ──

/**
 * Follow the rename chain through published base ops to find the current name
 * of an entity. When upstream renames an entity, the user's op still references
 * the old name. This scans base ops for rename operations and follows the chain
 * until it lands on a name that exists (or runs out of renames).
 *
 * Returns the resolved name, or the original name if no renames were found.
 */
export function followRenameChain(
  databaseId: number,
  entityType: string,
  oldName: string,
  maxDepth: number = 10
): string {
  const ops = pcdOpsQueries.listByDatabase(databaseId, 'base');
  // Build a rename map: oldName → newName from published base ops
  const renameMap = new Map<string, string>();

  // Resolve table name for batch SQL parsing
  const registryEntry = AUTO_ALIGN_ENTITIES.get(entityType);
  const tableName = registryEntry?.table;

  for (const op of ops) {
    if (op.state !== 'published') continue;
    const meta = parseJson<StoredOpMetadata>(op.metadata);
    if (!meta) continue;

    // Individual entity ops: metadata has entity + operation
    if (meta.entity === entityType && meta.operation === 'update') {
      const ds = parseJson<StoredDesiredState>(op.desired_state);
      if (!ds) continue;
      const nameField = ds.name;
      if (nameField && typeof nameField === 'object' && 'from' in nameField && 'to' in nameField) {
        const from = (nameField as { from: unknown }).from;
        const to = (nameField as { to: unknown }).to;
        if (typeof from === 'string' && typeof to === 'string' && from !== to) {
          renameMap.set(from, to);
        }
      }
      continue;
    }

    // Batch ops: parse SQL for UPDATE renames on the entity's table
    if (meta.entity === 'batch' && tableName && op.sql) {
      extractRenamesFromSql(op.sql, tableName, renameMap);
    }
  }

  // Follow the chain
  let current = oldName;
  const visited = new Set<string>();
  for (let i = 0; i < maxDepth; i++) {
    const next = renameMap.get(current);
    if (!next || visited.has(next)) break;
    visited.add(current);
    current = next;
  }

  return current;
}

/**
 * Extract rename mappings from batch SQL by looking for UPDATE statements
 * that set the "name" column on a specific table.
 *
 * Matches patterns like:
 *   UPDATE "custom_formats" SET "name" = 'New Name' WHERE "name" = 'Old Name';
 */
function extractRenamesFromSql(sql: string, tableName: string, renameMap: Map<string, string>): void {
  // Regex: UPDATE "tableName" SET "name" = 'newName' WHERE "name" = 'oldName'
  // SQL single-quote escaping: '' represents a literal '
  const escaped = tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `update\\s+"${escaped}"\\s+set\\s+"name"\\s*=\\s*'((?:[^']|'')*)'\\s+where\\s+"name"\\s*=\\s*'((?:[^']|'')*)'`,
    'gi'
  );
  for (const match of sql.matchAll(pattern)) {
    const newName = match[1].replace(/''/g, "'");
    const oldName = match[2].replace(/''/g, "'");
    if (oldName !== newName) {
      renameMap.set(oldName, newName);
    }
  }
}

// ── Value helpers ──

/**
 * Type guard that checks whether a value has a `to` property (i.e. is a from/to change record).
 *
 * @param value - Value to inspect
 * @returns `true` if `value` is a non-null object containing a `to` key
 */
export function isFromTo(value: unknown): value is { to: unknown } {

/**
 * Extract the `to` value from a from/to change record, returning `undefined` when absent.
 *
 * @param value - The value to inspect
 * @returns The `to` field cast to `T`, or `undefined` if `value` is not a from/to record
 */
export function getDesiredTo<T = unknown>(value: unknown): T | undefined {
  if (!isFromTo(value)) return undefined;
  return value.to as T;
}

/**
 * Coerce a value to a trimmed string, returning an empty string for null/undefined.
 *
 * @param value - Value to normalize
 * @returns String representation of `value`, or `''` if null or undefined
 */
export function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

/**
 * Normalize a tag array to a deduplicated, sorted list of non-empty strings.
 *
 * @param value - Raw value to normalize (non-arrays return an empty list)
 * @returns Sorted, deduplicated array of tag strings
 */
export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const set = new Set<string>();
  for (const item of value) {
    const name = String(item).trim();
    if (name) set.add(name);
  }
  return Array.from(set).sort();
}

/**
 * Compare two tag arrays for equality regardless of order.
 *
 * @param a - First tag array
 * @param b - Second tag array
 * @returns `true` if both arrays contain the same tags after sorting
 */
export function tagsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, idx) => value === sortedB[idx]);
}

/**
 * Normalize a raw ordered-items array to a stable, position-sorted structure.
 *
 * Handles flexible input shapes (camelCase/snake_case, member strings vs. objects) and sorts
 * group members alphabetically.
 *
 * @param items - Raw items value (non-arrays return an empty list)
 * @returns Normalized array of ordered-item objects sorted by position
 */
export function normalizeOrderedItems(items: unknown): Array<{
  type?: string;
  name?: string;
  position?: number;
  enabled?: boolean;
  upgradeUntil?: boolean;
  members?: string[];
}> {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const typed = item as {
        type?: string;
        name?: string;
        position?: number;
        enabled?: boolean;
        upgradeUntil?: boolean;
        members?: Array<{ name?: string } | string>;
      };
      const members = Array.isArray(typed.members)
        ? typed.members
            .map((member) => (typeof member === 'string' ? member : (member?.name ?? '')))
            .filter(Boolean)
            .sort()
        : [];
      return {
        type: typed.type,
        name: typed.name,
        position: typed.position,
        enabled: typed.enabled,
        upgradeUntil: typed.upgradeUntil,
        members,
      };
    })
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/**
 * Compare two ordered-items arrays for equality using normalized, position-sorted comparison.
 *
 * @param a - First ordered-items value
 * @param b - Second ordered-items value
 * @returns `true` if the normalized representations are identical
 */
export function orderedItemsEqual(a: unknown, b: unknown): boolean {
  const left = normalizeOrderedItems(a);
  const right = normalizeOrderedItems(b);
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Compare an expected value to an actual DB value with type coercion for booleans and numbers.
 *
 * @param expected - The desired target value
 * @param actual - The current value from the database row
 * @returns `true` if the values are semantically equal after coercion
 */
export function valuesEqual(expected: unknown, actual: unknown): boolean {
  if (expected === null || expected === undefined) {
    return actual === null || actual === undefined;
  }
  if (typeof expected === 'boolean') {
    if (typeof actual === 'boolean') return expected === actual;
    if (typeof actual === 'number') return actual === (expected ? 1 : 0);
    if (typeof actual === 'string') return actual === (expected ? '1' : '0');
    return false;
  }
  if (typeof expected === 'number') {
    if (typeof actual === 'number') return expected === actual;
    if (typeof actual === 'bigint') return expected === Number(actual);
    if (typeof actual === 'string') return expected === Number(actual);
    return false;
  }
  if (typeof expected === 'string') {
    return String(actual) === expected;
  }
  return false;
}
