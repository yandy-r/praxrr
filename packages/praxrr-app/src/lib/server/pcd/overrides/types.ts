/**
 * Local overrides manager types.
 *
 * A "local override" is any published `origin='user'` op in `pcd_ops`. These types describe
 * the entity-level view of those ops (identity, delta against upstream, undo unit).
 */

import type { PcdOp } from '$db/queries/pcdOps.ts';
import type { PcdOpHistoryStatus } from '$db/queries/pcdOpHistory.ts';
import type { ArrAppType } from '$shared/pcd/types.ts';
import type { FieldChange } from '$sync/preview/types.ts';
import type { ResolvedEntityType } from '../resolved/types.ts';

/** `pcd_ops.metadata` JSON key stamped by the writer on every user-layer op (the undo unit). */
export const USER_OP_ACTION_ID_KEY = 'action_id';

/** Identity of an overridden entity: `arrType` is `null` for arr-agnostic entity types. */
export interface EntityRef {
  entityType: ResolvedEntityType;
  arrType: ArrAppType | null;
  name: string;
}

export type OverrideKind = 'modified' | 'created' | 'deleted';

export interface OverrideOp {
  id: number;
  operation: string;
  title: string;
  summary: string | null;
  changedFields: string[];
  actionId: string | null;
  groupId: string | null;
  /** Latest `pcd_op_history.status` for the op, `null` when it has no history rows. */
  status: PcdOpHistoryStatus | null;
  createdAt: string;
}

export interface OverrideEntity extends EntityRef {
  kind: OverrideKind;
  /** Entity exists in the resolved (base + user) layer. */
  present: boolean;
  /** Entity exists in the base-only layer. */
  existsInBase: boolean;
  /** Field-level delta between base and resolved. */
  overrides: FieldChange[];
  hasPendingConflict: boolean;
  ops: OverrideOp[];
}

export interface LastAction {
  /** The id part of the action key (`action:<id>` | `group:<id>` | `op:<id>`). */
  actionId: string;
  /** Full action key as produced by `actionKeyOf`. */
  key: string;
  opIds: number[];
  entities: EntityRef[];
  createdAt: string;
}

export interface OverridesSnapshot {
  entities: OverrideEntity[];
  lastAction: LastAction | null;
  /** Published user ops whose entity could not be mapped to a resolved entity type. */
  unmappedOpCount: number;
}

/** `arrType` is `undefined` for arr-agnostic entity types. */
export type LocallyModifiedLookup = (
  entityType: ResolvedEntityType,
  arrType: ArrAppType | undefined,
  name: string
) => boolean;

/** All user ops attributed to one entity (by its current name). */
export interface EntityGroup {
  ref: EntityRef;
  /**
   * Name the entity had before any user op (the base-layer name for entities that existed
   * upstream). Differs from `ref.name` only for user-renamed entities.
   */
  originName: string;
  /** Ops in ascending id order. */
  ops: PcdOp[];
  hasCreate: boolean;
  hasDelete: boolean;
  hasRename: boolean;
}
