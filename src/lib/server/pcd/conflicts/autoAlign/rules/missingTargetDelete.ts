import { isMissingTargetRow } from '../shared.ts';
import type { DeleteRule } from '../types.ts';

export const missingTargetDeleteRule: DeleteRule = {
  name: 'missing_target',
  matches: ({ entityName }) => !!entityName,
  shouldAlign: ({ db, entityName, metadata }) => isMissingTargetRow(db, entityName, metadata),
};
