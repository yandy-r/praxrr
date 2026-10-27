/**
 * Local overrides: revert one entity's user ops, or undo the most recent user action.
 *
 * Both are soft drops (`pcd_ops.state = 'dropped'` plus an audit history row under one shared
 * batch id) followed by a recompile, executed as one all-or-nothing attempt under the
 * per-database override lock:
 *
 * 1. Snapshot every op of the database.
 * 2. Drop (and, for undo, reactivate) ops and recompile with auto-override suppressed.
 * 3. Verify the published user op set is exactly the expected one and no remaining op became
 *    newly `conflicted`. Otherwise restore the snapshot and fail closed with a 409.
 */

import { withOpCreationRecorder, type CreatedOpRecord } from '$db/opCreationRecorder.ts';
import {
  databaseInstancesQueries,
  disableDatabaseInstance,
  type DatabaseInstance,
} from '$db/queries/databaseInstances.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import { pcdOpsQueries, type PcdOp } from '$db/queries/pcdOps.ts';
import { logger } from '$logger/logger.ts';
import { uuid } from '$shared/utils/uuid.ts';
import type { ArrAppType } from '$shared/pcd/types.ts';
import { dropOp } from '../conflicts/overrideUtils.ts';
import { compile, invalidate, withAutoOverrideSuppressed } from '../database/compiler.ts';
import { getCache } from '../database/registry.ts';
import { inverseOpMetadataEntity, resolveLayerState } from '../resolved/layerDiff.ts';
import { ResolvedConfigDatabaseNotFoundError } from '../resolved/layers.ts';
import { isResolvedEntityNotFoundError } from '../resolved/readers.ts';
import type { ResolvedEntityType } from '../resolved/types.ts';
import {
  actionKeyOf,
  entityKeyOf,
  parseUserOpMetadata,
  resolveUserOpEntities,
  type ParsedUserOpMetadata,
} from './identity.ts';
import type { EntityGroup, EntityRef } from './types.ts';

export type OverrideRevertErrorReason =
  | 'entity_not_found'
  | 'op_not_found'
  | 'nothing_to_undo'
  | 'group_dependency'
  | 'dependent_ops'
  | 'selection_blocked'
  | 'op_not_revertible'
  | 'conflict_after_revert'
  | 'collateral_ops'
  | 'stale_action';

/** Expected, user-actionable failure of a revert/undo (404 or 409); anything else is a plain Error. */
export class OverrideRevertError extends Error {
  readonly status: 404 | 409;
  readonly reason: OverrideRevertErrorReason;
  readonly blockingOpIds?: number[];
  readonly entities?: EntityRef[];

  constructor(
    status: 404 | 409,
    reason: OverrideRevertErrorReason,
    message: string,
    details: { blockingOpIds?: number[]; entities?: EntityRef[] } = {}
  ) {
    super(message);
    this.name = 'OverrideRevertError';
    this.status = status;
    this.reason = reason;
    if (details.blockingOpIds) this.blockingOpIds = details.blockingOpIds;
    if (details.entities) this.entities = details.entities;
  }
}

export function isOverrideRevertError(error: unknown): error is OverrideRevertError {
  return error instanceof OverrideRevertError;
}

export interface RevertEntityOverridesInput {
  databaseId: number;
  entityType: ResolvedEntityType;
  /** Required by the caller for arr-scoped entity types; `undefined` for arr-agnostic ones. */
  arrType?: ArrAppType;
  /** The entity's CURRENT name. */
  name: string;
  /** Revert only these ops; omitted = every published user op of the entity. */
  opIds?: number[];
  /** Also drop ops that share a `group_id` with the selection but belong to other entities. */
  cascadeGroup?: boolean;
}

export interface RevertResult extends EntityRef {
  databaseId: number;
  revertedOpIds: number[];
  cascadedEntities: EntityRef[];
  remainingOpIds: number[];
  /** Only computed for a full revert; `null` when not comparable (partial, or absent in both layers). */
  resolvedMatchesBase: boolean | null;
}

export interface UndoLastActionInput {
  databaseId: number;
  /** Value guard: the action id the caller displayed; mismatch fails with 409 `stale_action`. */
  expectedActionId?: string;
}

export interface UndoResult {
  databaseId: number;
  undoneActionId: string;
  revertedOpIds: number[];
  reactivatedOpIds: number[];
  entities: EntityRef[];
}

// ── Shared helpers ──

const sortedUnique = (ids: Iterable<number>): number[] => [...new Set(ids)].sort((a, b) => a - b);

function listPublishedUserOps(databaseId: number): PcdOp[] {
  return pcdOpsQueries.listByDatabaseAndOrigin(databaseId, 'user', { states: ['published'] });
}

function distinctRefs(refs: Iterable<EntityRef>): EntityRef[] {
  const byKey = new Map<string, EntityRef>();
  for (const ref of refs) {
    byKey.set(entityKeyOf(ref.entityType, ref.arrType, ref.name), { ...ref });
  }
  return [...byKey.values()];
}

function buildOpRefIndex(entities: ReadonlyMap<string, EntityGroup>): Map<number, EntityRef> {
  const index = new Map<number, EntityRef>();
  for (const group of entities.values()) {
    for (const op of group.ops) index.set(op.id, group.ref);
  }
  return index;
}

function requireReadyDatabase(databaseId: number): DatabaseInstance {
  const instance = databaseInstancesQueries.getById(databaseId);
  // A missing, disabled or unbuilt database maps to 400 `Database not found` per the API contract.
  if (!instance || !instance.enabled || !getCache(databaseId)?.isBuilt()) {
    throw new ResolvedConfigDatabaseNotFoundError(databaseId);
  }
  return instance;
}

/**
 * Dynamic import is required: `conflicts/override.ts` imports `$pcd/index.ts`, which re-exports this
 * module, so a static import would create a load-order cycle (same pattern as `database/compiler.ts`).
 */
async function withLock<T>(databaseId: number, fn: () => Promise<T>): Promise<T> {
  const { withDatabaseOverrideLock } = await import('../conflicts/override.ts');
  return withDatabaseOverrideLock(databaseId, fn);
}

// ── Atomic attempt ──

interface AttemptInput {
  databaseId: number;
  instance: DatabaseInstance;
  dropIds: readonly number[];
  reactivateIds: readonly number[];
  batchId: string;
}

/** Ops whose latest history is a conflict or an `error` (a published op that silently stopped applying). */
function latestConflictedOpIds(databaseId: number): Set<number> {
  return new Set(
    pcdOpHistoryQueries
      .listLatestByDatabaseWithOps(databaseId, ['conflicted', 'conflicted_pending', 'error'])
      .map((entry) => entry.history.op_id)
  );
}

/**
 * Drops `dropIds`, reactivates `reactivateIds`, recompiles and verifies. On any failure the
 * op table is restored to its pre-attempt state (YAN-465 pattern from `conflicts/override.ts`).
 *
 * @throws OverrideRevertError 409 `collateral_ops` | `conflict_after_revert` after a restore.
 */
async function runAttempt(input: AttemptInput): Promise<void> {
  const { databaseId, instance, dropIds, reactivateIds, batchId } = input;

  const snapshot = pcdOpsQueries.listByDatabase(databaseId);
  const beforePublished = new Set(
    snapshot.filter((op) => op.origin === 'user' && op.state === 'published').map((op) => op.id)
  );
  const beforeConflicted = latestConflictedOpIds(databaseId);
  const expectedPublished = new Set(beforePublished);
  for (const id of dropIds) expectedPublished.delete(id);
  for (const id of reactivateIds) expectedPublished.add(id);

  const created: CreatedOpRecord = { opIds: [], historyIds: [], updatedOpIds: [] };

  /**
   * Undo the whole attempt: restore pre-existing rows verbatim, delete rows it created, rebuild.
   * @returns true when the op rows could not be restored (database disabled, state unknown).
   */
  const restore = async (reason: string): Promise<boolean> => {
    const wroteNothing =
      created.opIds.length === 0 && created.historyIds.length === 0 && created.updatedOpIds.length === 0;

    let restoreError: unknown = null;
    if (!wroteNothing) {
      try {
        pcdOpsQueries.restoreImportSnapshot(databaseId, snapshot, created);
      } catch (error) {
        restoreError = error;
      }
    }

    await logger.error('Override revert failed; restoring operations', {
      source: 'PCDOverrides',
      meta: { databaseId, dropIds, reactivateIds, error: reason },
    });

    if (restoreError !== null) {
      // The rows may be a hybrid: disable the database (same signal as a failed cache build).
      let disabled = false;
      try {
        disabled = disableDatabaseInstance(databaseId);
      } catch {
        // Best effort: never let this replace the original error.
      }
      invalidate(databaseId);
      await logger.error('Failed to restore operations after failed override revert', {
        source: 'PCDOverrides',
        meta: { databaseId, disabled, error: String(restoreError) },
      });
      return true;
    }

    if (wroteNothing) return false;

    const current = databaseInstancesQueries.getById(databaseId);
    if (!current?.enabled) {
      invalidate(databaseId);
      return false;
    }
    try {
      await withAutoOverrideSuppressed(databaseId, () => compile(current.local_path, databaseId));
    } catch (compileError) {
      invalidate(databaseId);
      await logger.error('Failed to recompile after restoring failed override revert', {
        source: 'PCDOverrides',
        meta: { databaseId, error: String(compileError) },
      });
    }
    return false;
  };

  const restoreFailedError = (cause: unknown): Error =>
    new Error(
      `Failed to restore local operations for database ${databaseId} after a failed revert; the database was disabled`,
      { cause }
    );

  let failure: OverrideRevertError | null = null;
  try {
    await withAutoOverrideSuppressed(databaseId, () =>
      withOpCreationRecorder(created, async () => {
        for (const id of dropIds) {
          if (!(await dropOp(databaseId, id, batchId))) throw new Error(`Failed to drop operation ${id}`);
        }
        for (const id of reactivateIds) {
          const updated = pcdOpsQueries.update(id, { state: 'published', supersededByOpId: null });
          if (!updated) throw new Error(`Failed to reactivate operation ${id}`);
          // Neutralize stale history so the recompile applies the op instead of re-dropping it.
          pcdOpHistoryQueries.create({
            opId: id,
            databaseId,
            batchId,
            status: 'applied',
            rowcount: null,
            conflictReason: 'override_undo',
          });
        }
        await compile(instance.local_path, databaseId);
      })
    );

    const afterPublished = new Set(listPublishedUserOps(databaseId).map((op) => op.id));
    const unexpected = [...afterPublished].filter((id) => !expectedPublished.has(id));
    const missing = [...expectedPublished].filter((id) => !afterPublished.has(id));
    if (unexpected.length > 0 || missing.length > 0) {
      failure = new OverrideRevertError(
        409,
        'collateral_ops',
        'Reverting would also drop other local operations; nothing was changed',
        { blockingOpIds: sortedUnique([...unexpected, ...missing]) }
      );
    } else {
      const newlyConflicted = [...latestConflictedOpIds(databaseId)].filter(
        (id) => expectedPublished.has(id) && !beforeConflicted.has(id)
      );
      if (newlyConflicted.length > 0) {
        failure = new OverrideRevertError(
          409,
          'conflict_after_revert',
          'Reverting would make other local operations conflict; nothing was changed',
          { blockingOpIds: sortedUnique(newlyConflicted) }
        );
      }
    }
  } catch (error) {
    if (await restore(error instanceof Error ? error.message : String(error))) {
      throw restoreFailedError(error);
    }
    throw error;
  }

  if (failure) {
    if (await restore(failure.message)) throw restoreFailedError(failure);
    throw failure;
  }
}

// ── Revert ──

function isRenameMetadata(metadata: ParsedUserOpMetadata): boolean {
  return (
    metadata.changedFields.includes('name') ||
    (metadata.previousName !== null && metadata.previousName !== metadata.name)
  );
}

/** Whether a (non-published) op addressed `group`'s entity, by entity vocabulary and name. */
function opAddressesEntity(op: PcdOp, group: EntityGroup): boolean {
  const metadata = parseUserOpMetadata(op.metadata);
  if (!metadata.entity) return false;
  const mapped = inverseOpMetadataEntity(metadata.entity);
  if (!mapped || mapped.entityType !== group.ref.entityType || mapped.arrType !== group.ref.arrType) return false;
  const names = new Set([group.ref.name, group.originName]);
  return [metadata.name, metadata.previousName, metadata.stableKeyValue].some(
    (candidate) => candidate !== null && names.has(candidate)
  );
}

interface RevertPlan {
  group: EntityGroup;
  dropIds: number[];
  cascadedEntities: EntityRef[];
  remainingOpIds: number[];
}

function planRevert(databaseId: number, input: RevertEntityOverridesInput, userOps: readonly PcdOp[]): RevertPlan {
  const { entityType, arrType, name } = input;
  const { entities } = resolveUserOpEntities(userOps);
  const targetKey = entityKeyOf(entityType, arrType ?? null, name);
  const group = entities.get(targetKey);
  if (!group) {
    throw new OverrideRevertError(404, 'entity_not_found', `No local overrides found for ${entityType} "${name}"`);
  }

  const groupOpIds = new Set(group.ops.map((op) => op.id));
  let selectedIds: Set<number>;
  if (input.opIds === undefined) {
    selectedIds = new Set(groupOpIds);
  } else {
    if (input.opIds.length === 0) throw new Error('opIds must not be empty');
    selectedIds = new Set(input.opIds);
    for (const id of selectedIds) {
      if (groupOpIds.has(id)) continue;
      const op = pcdOpsQueries.getById(id);
      if (op && op.database_id === databaseId && op.origin === 'user' && op.state !== 'published') {
        if (opAddressesEntity(op, group)) {
          throw new OverrideRevertError(
            409,
            'op_not_revertible',
            `Operation ${id} is ${op.state} and cannot be reverted`,
            { blockingOpIds: [id] }
          );
        }
      }
      throw new OverrideRevertError(404, 'op_not_found', `Operation ${id} is not a local override of this entity`);
    }
  }

  // Closed-set rule for partial selections: later ops' SQL guards were built against the result
  // of earlier ones, so only a disjoint, plain field edit may be taken out from under them.
  const remainingInGroup = group.ops.filter((op) => !selectedIds.has(op.id));
  if (remainingInGroup.length > 0) {
    const blocking = new Set<number>();
    for (const selected of group.ops.filter((op) => selectedIds.has(op.id))) {
      const selectedMeta = parseUserOpMetadata(selected.metadata);
      const structural =
        selectedMeta.operation === 'create' || selectedMeta.operation === 'delete' || isRenameMetadata(selectedMeta);
      const selectedFields = new Set(selectedMeta.changedFields);
      for (const later of remainingInGroup) {
        if (later.id <= selected.id) continue;
        const laterMeta = parseUserOpMetadata(later.metadata);
        if (
          structural ||
          selectedMeta.changedFields.length === 0 ||
          laterMeta.changedFields.length === 0 ||
          laterMeta.changedFields.some((field) => selectedFields.has(field))
        ) {
          blocking.add(later.id);
        }
      }
    }
    if (blocking.size > 0) {
      throw new OverrideRevertError(
        409,
        'selection_blocked',
        'The selected operations cannot be reverted without the later operations that build on them',
        { blockingOpIds: sortedUnique(blocking) }
      );
    }
  }

  // Group rule: ops sharing an explicit group_id with the selection are one logical change.
  const opRefs = buildOpRefIndex(entities);
  const selectedGroupIds = new Set<string>();
  for (const op of userOps) {
    if (!selectedIds.has(op.id)) continue;
    const groupId = parseUserOpMetadata(op.metadata).groupId;
    if (groupId) selectedGroupIds.add(groupId);
  }
  const dropIds = new Set(selectedIds);
  const cascaded: PcdOp[] = [];
  if (selectedGroupIds.size > 0) {
    for (const op of userOps) {
      if (selectedIds.has(op.id)) continue;
      const groupId = parseUserOpMetadata(op.metadata).groupId;
      if (groupId && selectedGroupIds.has(groupId)) cascaded.push(op);
    }
  }
  if (cascaded.length > 0) {
    if (!input.cascadeGroup) {
      const refs = cascaded.map((op) => opRefs.get(op.id)).filter((ref): ref is EntityRef => ref !== undefined);
      throw new OverrideRevertError(
        409,
        'group_dependency',
        'Some of the selected operations were saved together with operations of other entities or selections',
        { blockingOpIds: sortedUnique(cascaded.map((op) => op.id)), entities: distinctRefs(refs) }
      );
    }
    for (const op of cascaded) dropIds.add(op.id);
  }
  const cascadedEntities = distinctRefs(
    cascaded
      .map((op) => opRefs.get(op.id))
      .filter(
        (ref): ref is EntityRef => ref !== undefined && entityKeyOf(ref.entityType, ref.arrType, ref.name) !== targetKey
      )
  );

  // Dependents rule: a create or rename removes a name other remaining ops may still reference.
  const droppedNames = new Map<string, Set<string>>();
  for (const op of userOps) {
    if (!dropIds.has(op.id)) continue;
    const metadata = parseUserOpMetadata(op.metadata);
    if (!metadata.entity || !metadata.name) continue;
    if (metadata.operation !== 'create' && !isRenameMetadata(metadata)) continue;
    const names = droppedNames.get(metadata.entity) ?? new Set<string>();
    names.add(metadata.name);
    droppedNames.set(metadata.entity, names);
  }
  if (droppedNames.size > 0) {
    const blocking = new Set<number>();
    for (const op of userOps) {
      if (dropIds.has(op.id)) continue;
      const metadata = parseUserOpMetadata(op.metadata);
      const referencesDropped =
        metadata.dependsOn.some((dependency) => droppedNames.get(dependency.entity)?.has(dependency.value)) ||
        (metadata.entity !== null &&
          metadata.stableKeyValue !== null &&
          droppedNames.get(metadata.entity)?.has(metadata.stableKeyValue) === true);
      if (referencesDropped) blocking.add(op.id);
    }
    if (blocking.size > 0) {
      throw new OverrideRevertError(
        409,
        'dependent_ops',
        'Other local operations depend on an entity name that this revert would remove',
        { blockingOpIds: sortedUnique(blocking) }
      );
    }
  }

  return {
    group,
    dropIds: sortedUnique(dropIds),
    cascadedEntities,
    remainingOpIds: group.ops.filter((op) => !dropIds.has(op.id)).map((op) => op.id),
  };
}

async function computeResolvedMatchesBase(databaseId: number, group: EntityGroup): Promise<boolean | null> {
  // A user-created entity has no upstream counterpart; anything else is back under its base name.
  const name = group.hasCreate ? group.ref.name : group.originName;
  try {
    const state = await resolveLayerState({
      databaseId,
      entityType: group.ref.entityType,
      arrType: group.ref.arrType ?? undefined,
      name,
      layer: 'user',
    });
    if (state.layer !== 'user') return null;
    return state.present && state.overrides.length === 0;
  } catch (error) {
    if (!isResolvedEntityNotFoundError(error)) {
      await logger.warn('Could not compare reverted entity with its base state', {
        source: 'PCDOverrides',
        meta: { databaseId, entityType: group.ref.entityType, name, error: String(error) },
      });
    }
    return null;
  }
}

/**
 * Reverts a locally overridden entity (all of its published user ops, or the selected `opIds`)
 * back to upstream.
 *
 * @throws OverrideRevertError 404 (`entity_not_found` | `op_not_found`) or 409
 *   (`op_not_revertible` | `selection_blocked` | `group_dependency` | `dependent_ops` |
 *   `collateral_ops` | `conflict_after_revert`); the op table is unchanged in every case.
 * @throws ResolvedConfigDatabaseNotFoundError when the database is missing, disabled or not built.
 */
export function revertEntityOverrides(input: RevertEntityOverridesInput): Promise<RevertResult> {
  const { databaseId } = input;
  return withLock(databaseId, async () => {
    const instance = requireReadyDatabase(databaseId);
    const plan = planRevert(databaseId, input, listPublishedUserOps(databaseId));

    await runAttempt({ databaseId, instance, dropIds: plan.dropIds, reactivateIds: [], batchId: uuid() });

    await logger.info('Reverted local overrides', {
      source: 'PCDOverrides',
      meta: {
        databaseId,
        entityType: input.entityType,
        name: input.name,
        revertedOpIds: plan.dropIds,
        cascadedEntities: plan.cascadedEntities,
      },
    });

    return {
      databaseId,
      ...plan.group.ref,
      name: input.name,
      revertedOpIds: plan.dropIds,
      cascadedEntities: plan.cascadedEntities,
      remainingOpIds: plan.remainingOpIds,
      resolvedMatchesBase:
        plan.remainingOpIds.length === 0 ? await computeResolvedMatchesBase(databaseId, plan.group) : null,
    };
  });
}

// ── Undo ──

/**
 * Ops the writer superseded on behalf of `dropIds` whose last pre-supersede state was `applied`
 * (excludes ops the conflict-override flow superseded after dropping them, and ops written by
 * the undone action itself).
 */
function findReactivatableOps(databaseId: number, dropIds: ReadonlySet<number>, undoneKey: string): number[] {
  const superseded = pcdOpsQueries.listByDatabaseAndOrigin(databaseId, 'user', { states: ['superseded'] });
  const reactivate: number[] = [];
  for (const op of superseded) {
    if (op.superseded_by_op_id === null || !dropIds.has(op.superseded_by_op_id)) continue;
    // Superseded within the undone action itself: the pre-action state never included it.
    if (actionKeyOf(op) === undoneKey) continue;
    const lastState = pcdOpHistoryQueries.listByOp(op.id).find((row) => row.status !== 'superseded');
    if (lastState?.status === 'applied') reactivate.push(op.id);
  }
  return sortedUnique(reactivate);
}

/**
 * Undoes the most recent user action: drops every published user op sharing the latest op's
 * action key and reactivates the earlier edits that action's writes had superseded.
 *
 * @throws OverrideRevertError 404 `nothing_to_undo`; 409 `stale_action` | `collateral_ops` |
 *   `conflict_after_revert`.
 * @throws ResolvedConfigDatabaseNotFoundError when the database is missing, disabled or not built.
 */
export function undoLastAction(input: UndoLastActionInput): Promise<UndoResult> {
  const { databaseId, expectedActionId } = input;
  return withLock(databaseId, async () => {
    const instance = requireReadyDatabase(databaseId);
    const userOps = listPublishedUserOps(databaseId);
    if (userOps.length === 0) {
      throw new OverrideRevertError(404, 'nothing_to_undo', 'There are no local operations to undo');
    }

    let lastOp = userOps[0];
    for (const op of userOps) {
      if (op.id > lastOp.id) lastOp = op;
    }
    const key = actionKeyOf(lastOp);
    const actionId = key.slice(key.indexOf(':') + 1);
    if (expectedActionId !== undefined && expectedActionId !== actionId) {
      throw new OverrideRevertError(
        409,
        'stale_action',
        'The most recent action changed since it was displayed; refresh and try again'
      );
    }

    const dropIds = sortedUnique(userOps.filter((op) => actionKeyOf(op) === key).map((op) => op.id));
    const reactivateIds = findReactivatableOps(databaseId, new Set(dropIds), key);

    const { entities } = resolveUserOpEntities(userOps);
    const dropSet = new Set(dropIds);
    const refs = [...entities.values()]
      .filter((group) => group.ops.some((op) => dropSet.has(op.id)))
      .map((group) => group.ref);

    await runAttempt({ databaseId, instance, dropIds, reactivateIds, batchId: uuid() });

    await logger.info('Undid last local action', {
      source: 'PCDOverrides',
      meta: { databaseId, actionKey: key, revertedOpIds: dropIds, reactivatedOpIds: reactivateIds },
    });

    return {
      databaseId,
      undoneActionId: actionId,
      revertedOpIds: dropIds,
      reactivatedOpIds: reactivateIds,
      entities: distinctRefs(refs),
    };
  });
}
