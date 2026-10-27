/**
 * Local overrides: full read (entities + field deltas + last undoable action).
 *
 * The delta is the same base-vs-resolved diff used by `resolveLayerState({layer:'user'})`,
 * so "differs from upstream" has a single definition. The base-only cache is built once per
 * call; the resolved side comes from the registered cache.
 */

import type { PcdOp } from '$db/queries/pcdOps.ts';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import { pcdOpHistoryQueries, type PcdOpHistoryStatus } from '$db/queries/pcdOpHistory.ts';
import { sqliteUtcToIso } from '$lib/server/timeline/time.ts';
import type { ArrAppType } from '$shared/pcd/types.ts';
import { getCache } from '../database/registry.ts';
import { buildPendingConflictIndex, computeUserOverrides, readEntityOrNull } from '../resolved/layerDiff.ts';
import { withBaseOnlyCache } from '../resolved/layers.ts';
import type { ResolvedEntityType } from '../resolved/types.ts';
import { actionKeyOf, entityKeyOf, parseUserOpMetadata, resolveUserOpEntities } from './identity.ts';
import type { EntityRef, LastAction, OverrideEntity, OverrideKind, OverrideOp, OverridesSnapshot } from './types.ts';

function compareText(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left < right) return -1;
  if (left > right) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function toOverrideOp(op: PcdOp, statusByOpId: ReadonlyMap<number, PcdOpHistoryStatus>): OverrideOp {
  const metadata = parseUserOpMetadata(op.metadata);
  const operation = metadata.operation ?? 'unknown';
  return {
    id: op.id,
    operation,
    title: metadata.title ?? `${operation} ${metadata.name ?? `op ${op.id}`}`,
    summary: metadata.summary,
    changedFields: metadata.changedFields,
    actionId: metadata.actionId,
    groupId: metadata.groupId,
    status: statusByOpId.get(op.id) ?? null,
    createdAt: sqliteUtcToIso(op.created_at),
  };
}

function computeKind(existsInBase: boolean, present: boolean, hasDelete: boolean): OverrideKind {
  if (!existsInBase && present) return 'created';
  if (existsInBase && !present) return 'deleted';
  if (!existsInBase && !present) return hasDelete ? 'deleted' : 'created';
  return 'modified';
}

/**
 * Lists the entities that carry published user ops, with their delta against upstream, and the
 * most recent undoable action.
 *
 * `filter.arrType` is an exact match against the entity's `arrType` (arr-agnostic entities have
 * `arrType: null` and therefore never match an `arrType` filter).
 *
 * @throws Error when entities were selected but the database cache is not built.
 */
export async function listOverrides(
  databaseId: number,
  filter?: { entityType?: ResolvedEntityType; arrType?: ArrAppType }
): Promise<OverridesSnapshot> {
  const userOps = pcdOpsQueries.listByDatabaseAndOrigin(databaseId, 'user', { states: ['published'] });
  const { entities, unmapped } = resolveUserOpEntities(userOps);

  const selected = [...entities.values()].filter((group) => {
    if (filter?.entityType && group.ref.entityType !== filter.entityType) return false;
    if (filter?.arrType && group.ref.arrType !== filter.arrType) return false;
    return true;
  });
  selected.sort(
    (a, b) =>
      compareText(a.ref.entityType, b.ref.entityType) ||
      compareText(a.ref.arrType ?? '', b.ref.arrType ?? '') ||
      compareText(a.ref.name, b.ref.name)
  );

  const result: OverrideEntity[] = [];
  if (selected.length > 0) {
    const cache = getCache(databaseId);
    if (!cache?.isBuilt()) {
      throw new Error(`Database ${databaseId} cache is not built`);
    }

    const statusByOpId = new Map<number, PcdOpHistoryStatus>();
    for (const row of pcdOpHistoryQueries.listLatestByDatabaseWithOps(databaseId)) {
      statusByOpId.set(row.op.id, row.history.status);
    }
    const hasPendingConflict = buildPendingConflictIndex(databaseId);

    await withBaseOnlyCache(databaseId, async (baseCache) => {
      for (const group of selected) {
        const { entityType, name } = group.ref;
        const arrType = group.ref.arrType ?? undefined;
        // A user-renamed base entity is compared against its base counterpart (original name),
        // so a rename reads as `modified` with a `name` delta rather than as a new entity.
        // User-created entities never had an upstream name, so they compare by current name.
        const baseName = group.hasCreate ? name : group.originName;
        const baseEntity = await readEntityOrNull(baseCache, entityType, arrType, baseName);
        const resolvedEntity = await readEntityOrNull(cache, entityType, arrType, name);
        const existsInBase = baseEntity !== null;
        const present = resolvedEntity !== null;

        result.push({
          ...group.ref,
          kind: computeKind(existsInBase, present, group.hasDelete),
          present,
          existsInBase,
          overrides: computeUserOverrides(baseEntity, resolvedEntity),
          hasPendingConflict: hasPendingConflict(entityType, arrType, name),
          ops: group.ops.map((op) => toOverrideOp(op, statusByOpId)),
        });
      }
    });
  }

  return {
    entities: result,
    lastAction: computeLastAction(userOps, entities),
    unmappedOpCount: unmapped.length,
  };
}

/**
 * The latest published user op overall (mapped or not) defines the undo unit; its action key
 * selects every published user op sharing it.
 */
function computeLastAction(
  userOps: readonly PcdOp[],
  entities: ReadonlyMap<string, { ref: EntityRef; ops: PcdOp[] }>
): LastAction | null {
  if (userOps.length === 0) return null;

  let lastOp = userOps[0];
  for (const op of userOps) {
    if (op.id > lastOp.id) lastOp = op;
  }
  const key = actionKeyOf(lastOp);
  const opIds: number[] = [];
  let createdAt = lastOp.created_at;
  for (const op of userOps) {
    if (actionKeyOf(op) !== key) continue;
    opIds.push(op.id);
    if (op.created_at > createdAt) createdAt = op.created_at;
  }
  opIds.sort((a, b) => a - b);
  const actionOpIds = new Set(opIds);

  const refs = new Map<string, EntityRef>();
  for (const group of entities.values()) {
    if (group.ops.some((op) => actionOpIds.has(op.id))) {
      refs.set(entityKeyOf(group.ref.entityType, group.ref.arrType, group.ref.name), group.ref);
    }
  }

  return {
    actionId: key.slice(key.indexOf(':') + 1),
    key,
    opIds,
    entities: [...refs.values()].map((ref) => ({ ...ref })),
    createdAt: sqliteUtcToIso(createdAt),
  };
}
