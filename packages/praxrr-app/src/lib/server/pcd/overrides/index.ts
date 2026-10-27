/**
 * Local overrides manager: identity, modified lookup, read/delta.
 */

export { USER_OP_ACTION_ID_KEY } from './types.ts';
export type {
  EntityGroup,
  EntityRef,
  LastAction,
  LocallyModifiedLookup,
  OverrideEntity,
  OverrideKind,
  OverrideOp,
  OverridesSnapshot,
} from './types.ts';
export { actionKeyOf, resolveUserOpEntities } from './identity.ts';
export { buildLocallyModifiedLookup, listLocallyModifiedEntities } from './modified.ts';
export { listOverrides } from './read.ts';
export { isOverrideRevertError, OverrideRevertError, revertEntityOverrides, undoLastAction } from './revert.ts';
export type {
  OverrideRevertErrorReason,
  RevertEntityOverridesInput,
  RevertResult,
  UndoLastActionInput,
  UndoResult,
} from './revert.ts';
