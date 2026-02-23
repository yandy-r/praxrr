/**
 * Value-guard gate helpers for PCD operation replay
 *
 * These helpers provide deterministic conflict decisions from cache execution outcomes.
 * They intentionally avoid mutating database state; callers can apply side effects
 * (op drops/history writes/logging) from the returned decision.
 */

import type { Database } from '@jsr/db__sqlite';
import {
  type ConflictStrategy,
  evaluateAutoAlign,
  parseDesiredState,
  parseOpMetadata,
} from '$pcd/conflicts/autoAlign/index.ts';
import { checkFullListConflict } from '$pcd/conflicts/fullListCheck.ts';
import type { PcdOpHistoryStatus } from '$db/queries/pcdOpHistory.ts';
import type { OperationType } from '../core/types.ts';

export type ValueGuardApplyDecision =
  | 'applied'
  | 'skipped'
  | 'rowcount_zero_conflict'
  | 'full_list_conflict'
  | 'auto_align_rowcount_zero'
  | 'auto_align_full_list';

export interface ValueGuardApplyContext {
  db: Database;
  conflictStrategy: ConflictStrategy;
  isUserOp: boolean;
  rowcount: number;
  metadataJson: string | null;
  desiredStateJson: string | null;
  priorConflictReason: string | null;
}

type ValueGuardApplyDecisionMetadata = {
  conflictReason: string | null;
  needsRebuild: boolean;
  fallbackStatus: PcdOpHistoryStatus;
  fallbackConflictReason: string | null;
  shouldLogConflict: boolean;
};

type ValueGuardApplyDecisionNoAuto = ValueGuardApplyDecisionMetadata & {
  decision: Exclude<ValueGuardApplyDecision, 'auto_align_rowcount_zero' | 'auto_align_full_list'>;
  status: PcdOpHistoryStatus;
  shouldAttemptAutoDrop: false;
  shouldLogAutoAlign: false;
  autoAlignReason?: never;
  autoAlignRule?: never;
};

type ValueGuardApplyDecisionAutoAlign = ValueGuardApplyDecisionMetadata & {
  decision: Extract<ValueGuardApplyDecision, 'auto_align_rowcount_zero' | 'auto_align_full_list'>;
  status: PcdOpHistoryStatus;
  shouldAttemptAutoDrop: true;
  shouldLogAutoAlign: true;
  autoAlignReason: 'forced' | 'auto_delete' | 'auto_update' | null;
  autoAlignRule: string | null;
};

type ValueGuardApplyDecisionNoAutoResult = ValueGuardApplyDecisionNoAuto & {
  status: 'applied' | 'skipped';
};

const makeDefaultNoAutoResult = (status: 'applied' | 'skipped'): ValueGuardApplyDecisionNoAutoResult => {
  return {
    status,
    conflictReason: null,
    needsRebuild: false,
    shouldAttemptAutoDrop: false,
    fallbackStatus: status,
    fallbackConflictReason: null,
    shouldLogConflict: false,
    shouldLogAutoAlign: false,
    decision: status === 'applied' ? 'applied' : 'skipped',
  };
};

type ValueGuardApplyDecisionRowcountConflict = ValueGuardApplyDecisionNoAuto & {
  decision: 'rowcount_zero_conflict';
  status: PcdOpHistoryStatus;
};

type ValueGuardApplyDecisionFullListConflict = ValueGuardApplyDecisionNoAuto & {
  decision: 'full_list_conflict';
  status: PcdOpHistoryStatus;
};

type ValueGuardApplyDecisionAutoAlignRowcount = ValueGuardApplyDecisionAutoAlign & {
  decision: 'auto_align_rowcount_zero';
  status: 'dropped';
  conflictReason: 'aligned';
};

type ValueGuardApplyDecisionAutoAlignFullList = ValueGuardApplyDecisionAutoAlign & {
  decision: 'auto_align_full_list';
  status: 'dropped';
  conflictReason: 'aligned';
};

export type ValueGuardApplyDecisionResult =
  | ValueGuardApplyDecisionNoAutoResult
  | ValueGuardApplyDecisionRowcountConflict
  | ValueGuardApplyDecisionFullListConflict
  | ValueGuardApplyDecisionAutoAlignRowcount
  | ValueGuardApplyDecisionAutoAlignFullList;

export interface ValueGuardErrorContext {
  conflictStrategy: ConflictStrategy;
  error: string;
  isUserOp: boolean;
  trackHistory: boolean;
  priorConflictReason: string | null;
}

export interface ValueGuardErrorDecisionResult {
  status: PcdOpHistoryStatus;
  conflictReason: string | null;
  shouldRecordHistory: boolean;
  shouldLogConflict: boolean;
  errorCategory: 'duplicate_key' | 'missing_target' | 'non_conflict_error';
}

function resolveConflictStatus(conflictStrategy: ConflictStrategy): PcdOpHistoryStatus {
  return conflictStrategy === 'ask' ? 'conflicted_pending' : 'conflicted';
}

export function getConflictReason(operation?: OperationType): string {
  switch (operation) {
    case 'create':
      return 'duplicate_key';
    case 'delete':
      return 'missing_target';
    case 'update':
    default:
      return 'guard_mismatch';
  }
}

export function isUniqueConstraintError(error: string): boolean {
  return error.includes('UNIQUE constraint failed');
}

export function isForeignKeyConstraintError(error: string): boolean {
  return error.includes('FOREIGN KEY constraint failed');
}

function normalizeOperationType(operation?: string): OperationType | undefined {
  if (operation === 'create' || operation === 'update' || operation === 'delete') {
    return operation;
  }
  return undefined;
}

export function isValueGuardBlockingStatus(status: PcdOpHistoryStatus): boolean {
  return status === 'conflicted' || status === 'conflicted_pending';
}

/**
 * Evaluate whether a successfully executed operation should be recorded as
 * applied/skipped or should be treated as a conflict under cache semantics.
 */
export function evaluateValueGuardApply(input: ValueGuardApplyContext): ValueGuardApplyDecisionResult {
  const { conflictStrategy, isUserOp, rowcount, db, metadataJson, desiredStateJson, priorConflictReason } = input;

  const defaultNoConflictStatus: PcdOpHistoryStatus = rowcount === 0 ? 'skipped' : 'applied';
  const defaultResult = makeDefaultNoAutoResult(defaultNoConflictStatus === 'applied' ? 'applied' : 'skipped');

  if (!isUserOp) {
    return defaultResult;
  }

  const metadata = parseOpMetadata(metadataJson);
  const desiredState = parseDesiredState(desiredStateJson);
  const conflictStatus = resolveConflictStatus(conflictStrategy);

  if (defaultNoConflictStatus === 'skipped') {
    const autoAlignDecision = evaluateAutoAlign({
      db,
      conflictStrategy,
      metadata,
      desiredState,
    });

    if (autoAlignDecision.shouldAlign) {
      const normalizedOperation = normalizeOperationType(metadata?.operation);
      const conflictReason = getConflictReason(normalizedOperation);
      return {
        ...defaultResult,
        status: 'dropped',
        conflictReason: 'aligned',
        shouldAttemptAutoDrop: true,
        fallbackStatus: conflictStatus,
        fallbackConflictReason: conflictReason,
        shouldLogConflict: priorConflictReason !== conflictReason,
        shouldLogAutoAlign: true,
        autoAlignReason: autoAlignDecision.reason === 'none' ? null : autoAlignDecision.reason,
        autoAlignRule: autoAlignDecision.rule ?? null,
        decision: 'auto_align_rowcount_zero',
      };
    }

    const conflictReason = getConflictReason(normalizeOperationType(metadata?.operation));
    return {
      ...defaultResult,
      status: conflictStatus,
      conflictReason,
      shouldLogConflict: priorConflictReason !== conflictReason,
      shouldAttemptAutoDrop: false,
      decision: 'rowcount_zero_conflict',
    };
  }

  if (checkFullListConflict(db, metadata, desiredState)) {
    if (conflictStrategy === 'align') {
      return {
        ...defaultResult,
        status: 'dropped',
        conflictReason: 'aligned',
        needsRebuild: true,
        shouldAttemptAutoDrop: true,
        fallbackStatus: conflictStatus,
        fallbackConflictReason: 'guard_mismatch',
        shouldLogConflict: priorConflictReason !== 'guard_mismatch',
        shouldLogAutoAlign: true,
        autoAlignReason: 'forced',
        autoAlignRule: 'force_align_strategy',
        decision: 'auto_align_full_list',
      };
    }

    return {
      ...defaultResult,
      status: conflictStatus,
      conflictReason: 'guard_mismatch',
      shouldLogConflict: priorConflictReason !== 'guard_mismatch',
      decision: 'full_list_conflict',
    };
  }

  return {
    ...defaultResult,
    decision: 'applied',
  };
}

/**
 * Evaluate whether an execution error should be treated as a recoverable conflict
 * versus a hard replay error.
 */
export function evaluateValueGuardError(input: ValueGuardErrorContext): ValueGuardErrorDecisionResult {
  const { conflictStrategy, error, isUserOp, trackHistory, priorConflictReason } = input;

  if (!trackHistory) {
    return {
      status: 'error',
      conflictReason: null,
      shouldRecordHistory: false,
      shouldLogConflict: false,
      errorCategory: 'non_conflict_error',
    };
  }

  const isDuplicateKey = isUserOp && isUniqueConstraintError(error);
  const isMissingTarget = isUserOp && isForeignKeyConstraintError(error);
  if (!isDuplicateKey && !isMissingTarget) {
    return {
      status: 'error',
      conflictReason: null,
      shouldRecordHistory: true,
      shouldLogConflict: false,
      errorCategory: 'non_conflict_error',
    };
  }

  const conflictReason = isDuplicateKey ? 'duplicate_key' : 'missing_target';
  return {
    status: resolveConflictStatus(conflictStrategy),
    conflictReason,
    shouldRecordHistory: true,
    shouldLogConflict: priorConflictReason !== conflictReason,
    errorCategory: isDuplicateKey ? 'duplicate_key' : 'missing_target',
  };
}
