import type { Database } from '@jsr/db__sqlite';
import type { AutoAlignEntity } from '$pcd/entities/registry.ts';
import { AUTO_ALIGN_ENTITIES } from '$pcd/entities/registry.ts';
import type { ParsedOpMetadata } from './types.ts';

/**
 * Type guard that checks whether a value has a `to` property (i.e. is a from/to change record).
 *
 * @param value - Value to inspect
 * @returns `true` if `value` is an object with a `to` key
 */
export function isFromTo(value: unknown): value is { to: unknown } {
  if (!value || typeof value !== 'object') return false;
  return 'to' in value;
}

/**
 * Compare an expected desired value to an actual DB value with type coercion for booleans and numbers.
 *
 * @param expected - The desired target value (from the op's `to` field)
 * @param actual - The current value from the database row
 * @returns `true` if the values are semantically equal
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

/**
 * Fetch a single row from a cache table by primary key.
 *
 * @param db - In-memory PCD cache database
 * @param table - Table name to query
 * @param keyColumn - Column name to match against
 * @param keyValue - Value to look up
 * @returns The row as an untyped record, or null if not found or the query fails
 */
export function fetchRow(
  db: Database,
  table: string,
  keyColumn: string,
  keyValue: string
): Record<string, unknown> | null {
  try {
    const row = db.prepare(`SELECT * FROM ${table} WHERE ${keyColumn} = ? LIMIT 1`).get(keyValue);
    return (row as Record<string, unknown> | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve the current database row for an entity referenced by an op's metadata or desired state.
 *
 * Looks up by stable key first, then by entity name, then by the `to` value in `desiredState.name`.
 *
 * @param db - In-memory PCD cache database
 * @param entity - Auto-align entity config with table and key column
 * @param metadata - Parsed op metadata for name/stable-key resolution
 * @param desiredState - Parsed desired state for fallback name resolution
 * @returns The current row as an untyped record, or null if not found
 */
export function resolveCurrentRow(
  db: Database,
  entity: AutoAlignEntity,
  metadata: ParsedOpMetadata | null,
  desiredState: Record<string, unknown> | null
): Record<string, unknown> | null {
  const stableKey = metadata?.stableKey?.value;
  if (stableKey) {
    const row = fetchRow(db, entity.table, entity.keyColumn, stableKey);
    if (row) return row;
  }

  const nameKey = metadata?.name;
  if (nameKey) {
    const row = fetchRow(db, entity.table, entity.keyColumn, nameKey);
    if (row) return row;
  }

  const desiredName = desiredState?.name;
  if (isFromTo(desiredName) && typeof desiredName.to === 'string') {
    return fetchRow(db, entity.table, entity.keyColumn, desiredName.to);
  }

  return null;
}

/**
 * Check whether the target entity row referenced by an op's metadata is absent from the cache.
 *
 * @param db - In-memory PCD cache database
 * @param entityName - Entity type name used to look up the auto-align config
 * @param metadata - Parsed op metadata providing the stable key or entity name
 * @returns `true` if no matching row exists in the cache table
 */
export function isMissingTargetRow(
  db: Database,
  entityName: string | undefined,
  metadata: ParsedOpMetadata | null
): boolean {
  if (!entityName) return false;
  const entityConfig = AUTO_ALIGN_ENTITIES.get(entityName);
  if (!entityConfig) return false;

  const stableKey = metadata?.stableKey?.value ?? metadata?.name;
  if (!stableKey) return false;

  const row = fetchRow(db, entityConfig.table, entityConfig.keyColumn, stableKey);
  return !row;
}
