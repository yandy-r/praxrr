/**
 * Pure op builder for `quality_profile_qualities` (extracted from `updateQualities`).
 *
 * Given a desired ordered list, diff it against the current ladder (read from the supplied cache)
 * and produce guarded INSERT/UPDATE/DELETE queries. This mirrors the `buildScoringOps`/`updateScoring`
 * split: the pure builder is shared by the persister (`updateQualities`), the goal-apply path, and the
 * preview sandbox, so preview and apply can never drift from persist SQL semantics (value guards,
 * clear-before-set cutoff ordering).
 */

import type { PCDCache } from '$pcd/index.ts';
import type { OperationLayer } from '$pcd/index.ts';
import type { OrderedItem } from '$shared/pcd/display.ts';
import { qualities as readQualities } from './read.ts';
import type { CompiledQuery } from 'kysely';

export interface UpdateQualitiesInput {
  orderedItems: OrderedItem[];
}

type RowChangeMode = 'add' | 'remove' | 'update';

export interface QualityLadderRowOp {
  description: string;
  queries: CompiledQuery[];
  desiredState: Record<string, unknown>;
  changedFields: string[];
  summary: string;
  title: string;
}

export interface BuiltQualityLadder {
  /** Ordered per-row ops: removes, adds, then updates sorted so upgrade_until clears precede sets. */
  ops: QualityLadderRowOp[];
  /** Single-writeOperation payload; null when the ladder is a no-op. */
  batched: {
    queries: CompiledQuery[];
    desiredState: Record<string, unknown>;
    changedFields: string[];
  } | null;
}

export interface BuildQualityLadderOptions {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  profileName: string;
  input: UpdateQualitiesInput;
  /** Goal path only: reject a ladder that would REMOVE any current row (defensive full-coverage guard). */
  forbidRemovals?: boolean;
}

function esc(str: string): string {
  return str.replace(/'/g, "''");
}

function rowKey(item: OrderedItem): string {
  return `${item.type}:${item.name}`;
}

function rowFieldKey(item: OrderedItem): string {
  return `quality_item:${item.type}:${item.name}`;
}

function getMembers(item: OrderedItem): string[] {
  if (item.type !== 'group') return [];
  return Array.from(new Set((item.members ?? []).map((member) => member.name).filter(Boolean))).sort();
}

function cloneItem(item: OrderedItem): OrderedItem {
  const cloned: OrderedItem = {
    type: item.type,
    name: item.name,
    position: item.position,
    enabled: item.enabled,
    upgradeUntil: item.upgradeUntil
  };
  if (item.type === 'group') {
    cloned.members = getMembers(item).map((name) => ({ name }));
  }
  return cloned;
}

function sameRow(current: OrderedItem, next: OrderedItem): boolean {
  if (
    current.type !== next.type ||
    current.name !== next.name ||
    current.position !== next.position ||
    current.enabled !== next.enabled ||
    current.upgradeUntil !== next.upgradeUntil
  ) {
    return false;
  }

  if (current.type !== 'group') {
    return true;
  }

  const currentMembers = getMembers(current);
  const nextMembers = getMembers(next);
  if (currentMembers.length !== nextMembers.length) return false;
  return currentMembers.every((member, index) => member === nextMembers[index]);
}

function buildDeleteQueries(profileName: string, item: OrderedItem): CompiledQuery[] {
  const queries: CompiledQuery[] = [];

  if (item.type === 'quality') {
    queries.push({
      sql: `DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '${esc(profileName)}'
  AND quality_name = '${esc(item.name)}'
  AND quality_group_name IS NULL
  AND position = ${item.position}
  AND enabled = ${item.enabled ? 1 : 0}
  AND upgrade_until = ${item.upgradeUntil ? 1 : 0}`,
      parameters: [],
      query: {} as never
    });
    return queries;
  }

  queries.push({
    sql: `DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '${esc(profileName)}'
  AND quality_group_name = '${esc(item.name)}'
  AND quality_name IS NULL
  AND position = ${item.position}
  AND enabled = ${item.enabled ? 1 : 0}
  AND upgrade_until = ${item.upgradeUntil ? 1 : 0}`,
    parameters: [],
    query: {} as never
  });

  for (const member of getMembers(item)) {
    queries.push({
      sql: `DELETE FROM quality_group_members
WHERE quality_profile_name = '${esc(profileName)}'
  AND quality_group_name = '${esc(item.name)}'
  AND quality_name = '${esc(member)}'`,
      parameters: [],
      query: {} as never
    });
  }

  queries.push({
    sql: `DELETE FROM quality_groups
WHERE quality_profile_name = '${esc(profileName)}'
  AND name = '${esc(item.name)}'`,
    parameters: [],
    query: {} as never
  });

  return queries;
}

function buildAddQueries(profileName: string, item: OrderedItem): CompiledQuery[] {
  const queries: CompiledQuery[] = [];
  const enabled = item.enabled ? 1 : 0;
  const upgradeUntil = item.upgradeUntil ? 1 : 0;

  if (item.type === 'group') {
    queries.push({
      sql: `INSERT INTO quality_groups (quality_profile_name, name)
SELECT '${esc(profileName)}', '${esc(item.name)}'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_groups
  WHERE quality_profile_name = '${esc(profileName)}'
    AND name = '${esc(item.name)}'
)`,
      parameters: [],
      query: {} as never
    });

    for (const member of getMembers(item)) {
      queries.push({
        sql: `INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '${esc(profileName)}', '${esc(item.name)}', '${esc(member)}'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '${esc(profileName)}'
    AND quality_group_name = '${esc(item.name)}'
    AND quality_name = '${esc(member)}'
)`,
        parameters: [],
        query: {} as never
      });
    }

    queries.push({
      sql: `INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '${esc(profileName)}', NULL, '${esc(item.name)}', ${item.position}, ${enabled}, ${upgradeUntil}
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '${esc(profileName)}'
    AND quality_name IS NULL
    AND quality_group_name = '${esc(item.name)}'
)`,
      parameters: [],
      query: {} as never
    });

    return queries;
  }

  queries.push({
    sql: `INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '${esc(profileName)}', '${esc(item.name)}', NULL, ${item.position}, ${enabled}, ${upgradeUntil}
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '${esc(profileName)}'
    AND quality_name = '${esc(item.name)}'
    AND quality_group_name IS NULL
)`,
    parameters: [],
    query: {} as never
  });

  return queries;
}

function buildUpdateQueries(profileName: string, current: OrderedItem, next: OrderedItem): CompiledQuery[] {
  const queries: CompiledQuery[] = [];

  const parts: string[] = [];
  if (current.position !== next.position) {
    parts.push(`position = ${next.position}`);
  }
  if (current.enabled !== next.enabled) {
    parts.push(`enabled = ${next.enabled ? 1 : 0}`);
  }
  if (current.upgradeUntil !== next.upgradeUntil) {
    parts.push(`upgrade_until = ${next.upgradeUntil ? 1 : 0}`);
  }

  if (parts.length > 0) {
    if (current.type === 'quality') {
      queries.push({
        sql: `UPDATE quality_profile_qualities
SET ${parts.join(', ')}
WHERE quality_profile_name = '${esc(profileName)}'
  AND quality_name = '${esc(current.name)}'
  AND quality_group_name IS NULL
  AND position = ${current.position}
  AND enabled = ${current.enabled ? 1 : 0}
  AND upgrade_until = ${current.upgradeUntil ? 1 : 0}`,
        parameters: [],
        query: {} as never
      });
    } else {
      queries.push({
        sql: `UPDATE quality_profile_qualities
SET ${parts.join(', ')}
WHERE quality_profile_name = '${esc(profileName)}'
  AND quality_group_name = '${esc(current.name)}'
  AND quality_name IS NULL
  AND position = ${current.position}
  AND enabled = ${current.enabled ? 1 : 0}
  AND upgrade_until = ${current.upgradeUntil ? 1 : 0}`,
        parameters: [],
        query: {} as never
      });
    }
  }

  if (current.type === 'group') {
    const currentMembers = getMembers(current);
    const nextMembers = getMembers(next);
    const toRemove = currentMembers.filter((member) => !nextMembers.includes(member));
    const toAdd = nextMembers.filter((member) => !currentMembers.includes(member));

    for (const member of toRemove) {
      queries.push({
        sql: `DELETE FROM quality_group_members
WHERE quality_profile_name = '${esc(profileName)}'
  AND quality_group_name = '${esc(current.name)}'
  AND quality_name = '${esc(member)}'`,
        parameters: [],
        query: {} as never
      });
    }

    for (const member of toAdd) {
      queries.push({
        sql: `INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '${esc(profileName)}', '${esc(current.name)}', '${esc(member)}'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '${esc(profileName)}'
    AND quality_group_name = '${esc(current.name)}'
    AND quality_name = '${esc(member)}'
)`,
        parameters: [],
        query: {} as never
      });
    }
  }

  return queries;
}

function rowDesiredState(
  mode: RowChangeMode,
  key: string,
  fromItem: OrderedItem | null,
  toItem: OrderedItem | null
): Record<string, unknown> {
  return {
    ordered_items: {
      mode,
      key,
      from: fromItem ? [cloneItem(fromItem)] : [],
      to: toItem ? [cloneItem(toItem)] : []
    }
  };
}

/**
 * Build the guarded op set for a desired quality ladder against the current one in `cache`.
 *
 * Throws when more than one row is marked `upgrade_until` (partial unique index invariant). Returns
 * `{ error }` when `forbidRemovals` is set and the desired list would drop a current row. Returns
 * `batched: null` when there is nothing to change.
 */
export async function buildQualityLadderOps(options: BuildQualityLadderOptions): Promise<BuiltQualityLadder | { error: string }> {
  const { databaseId, cache, profileName, input, forbidRemovals } = options;

  const upgradeUntilCount = input.orderedItems.filter((item) => item.upgradeUntil).length;
  if (upgradeUntilCount > 1) {
    throw new Error('Only one quality can be marked as "upgrade until"');
  }

  const currentData = await readQualities(cache, databaseId, profileName);
  const currentByKey = new Map(currentData.orderedItems.map((item) => [rowKey(item), item]));
  const nextByKey = new Map(input.orderedItems.map((item) => [rowKey(item), item]));

  const removedItems = currentData.orderedItems.filter((item) => !nextByKey.has(rowKey(item)));
  const addedItems = input.orderedItems.filter((item) => !currentByKey.has(rowKey(item)));
  const updatedItems: Array<{ current: OrderedItem; next: OrderedItem }> = [];

  for (const [key, next] of nextByKey.entries()) {
    const current = currentByKey.get(key);
    if (!current) continue;
    if (!sameRow(current, next)) {
      updatedItems.push({ current, next });
    }
  }

  if (forbidRemovals && removedItems.length > 0) {
    return {
      error: `Quality ladder for "${profileName}" would remove ${removedItems.length} row(s); goal ladders must preserve every existing quality row.`
    };
  }

  const ops: QualityLadderRowOp[] = [];

  for (const item of removedItems) {
    ops.push({
      description: `remove-quality-profile-row-${profileName}-${item.type}-${item.name}`,
      queries: buildDeleteQueries(profileName, item),
      desiredState: rowDesiredState('remove', rowKey(item), item, null),
      changedFields: [rowFieldKey(item)],
      summary: 'Remove quality profile quality row',
      title: `Remove ${item.type} "${item.name}" from quality profile "${profileName}"`
    });
  }

  for (const item of addedItems) {
    ops.push({
      description: `add-quality-profile-row-${profileName}-${item.type}-${item.name}`,
      queries: buildAddQueries(profileName, item),
      desiredState: rowDesiredState('add', rowKey(item), null, item),
      changedFields: [rowFieldKey(item)],
      summary: 'Add quality profile quality row',
      title: `Add ${item.type} "${item.name}" to quality profile "${profileName}"`
    });
  }

  // Sort updates so rows clearing upgrade_until (→false) come before rows setting it (→true). The
  // partial UNIQUE index idx_one_upgrade_until_per_profile only allows one upgrade_until=1 per profile,
  // so the clear must run first.
  const sortedUpdates = [...updatedItems].sort((a, b) => {
    if (a.next.upgradeUntil === b.next.upgradeUntil) return 0;
    return a.next.upgradeUntil ? 1 : -1;
  });

  for (const change of sortedUpdates) {
    const queries = buildUpdateQueries(profileName, change.current, change.next);
    if (queries.length === 0) continue;

    ops.push({
      description: `update-quality-profile-row-${profileName}-${change.next.type}-${change.next.name}`,
      queries,
      desiredState: rowDesiredState('update', rowKey(change.next), change.current, change.next),
      changedFields: [rowFieldKey(change.next)],
      summary: 'Update quality profile quality row',
      title: `Update ${change.next.type} "${change.next.name}" on quality profile "${profileName}"`
    });
  }

  if (ops.length === 0) {
    return { ops, batched: null };
  }

  // Batch all row changes into a single atomic payload so the entire qualities update conflicts (or
  // doesn't) as one unit against the value guard, and recompiles once.
  const batched = {
    queries: ops.flatMap((op) => op.queries),
    changedFields: ops.flatMap((op) => op.changedFields),
    desiredState: {
      ordered_items: {
        from: currentData.orderedItems.map(cloneItem),
        to: input.orderedItems.map(cloneItem)
      }
    }
  };

  return { ops, batched };
}
