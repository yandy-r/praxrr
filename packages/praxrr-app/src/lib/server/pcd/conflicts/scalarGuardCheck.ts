/**
 * Post-execution conflict detection for scalar field guards.
 *
 * A user op is one multi-statement SQL blob (guarded UPDATE + tag/link
 * INSERT/DELETEs). The aggregate rowcount covers the whole blob, so when the
 * guarded UPDATE matches 0 rows but a side statement changes rows, rowcount > 0
 * and the op is recorded applied while the edit is silently lost.
 *
 * This module detects such misses by comparing the DB row after execution
 * against the op's desired "to" state, mirroring conflicts/fullListCheck.ts.
 */

import type { Database } from '@jsr/db__sqlite';
import { AUTO_ALIGN_ENTITIES } from '$pcd/entities/registry.ts';
import type { ParsedOpMetadata } from './autoAlign/types.ts';
import { fetchRow, isFromTo, resolveCurrentRow, valuesEqual } from './autoAlign/shared.ts';

const SKIPPED_KEYS = new Set(['name', 'ordered_items', 'conditions', 'tags']);

/**
 * Check if a user update op with scalar desiredState actually achieved its
 * desired "to" state. Returns true if a conflict is detected (row missing or
 * any scalar field does not match "to").
 */
export function checkScalarGuardConflict(
  db: Database,
  metadata: ParsedOpMetadata | null,
  desiredState: Record<string, unknown> | null
): boolean {
  const entityConfig = metadata?.entity ? AUTO_ALIGN_ENTITIES.get(metadata.entity) : undefined;
  if (!entityConfig) return false;

  // Delete: side statements (tag links) can change rows while the guarded parent DELETE
  // misses. If the target row is still present after the op, the guard did not match.
  if (metadata?.operation === 'delete') {
    const key = metadata.stableKey?.value ?? metadata.name;
    return !!key && fetchRow(db, entityConfig.table, entityConfig.keyColumn, key) !== null;
  }

  if (metadata?.operation !== 'update') return false;
  if (!desiredState) return false;

  const scalarEntries: Array<{ field: string; to: unknown }> = [];
  for (const [field, value] of Object.entries(desiredState)) {
    if (SKIPPED_KEYS.has(field)) continue;
    if (!entityConfig.fields.includes(field)) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    if (!Object.hasOwn(record, 'from') || !Object.hasOwn(record, 'to')) continue;
    if ('mode' in record || 'add' in record || 'remove' in record) continue;
    scalarEntries.push({ field, to: record.to });
  }

  if (scalarEntries.length === 0) return false;

  // An unresolvable row is ambiguous (e.g. rename lookups). Never force a conflict on it:
  // under `align` a false positive would drop a valid user edit.
  // Renames resolve by the post-op name only: the old name may now belong to another entity.
  const rename = desiredState.name;
  const row =
    isFromTo(rename) && typeof rename.to === 'string'
      ? fetchRow(db, entityConfig.table, entityConfig.keyColumn, rename.to)
      : resolveCurrentRow(db, entityConfig, metadata, desiredState);
  if (!row) return false;

  return scalarEntries.some(({ field, to }) => !valuesEqual(to, row[field]));
}
