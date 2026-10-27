/**
 * Incoming-upstream preview DTOs (YAN-570). Wire shapes mirror the `IncomingPreview`,
 * `PredictedConflict`, `PredictedError` and `IncomingCommit` OpenAPI schemas;
 * sections/summary reuse the rollback preview types so `SnapshotDiff` props stay identical.
 */

import type { ConflictStrategy } from '$pcd/conflicts/autoAlign/types.ts';
import type { RollbackSection, RollbackSummary } from '../snapshots/rollback/types.ts';

export type { ConflictStrategy, RollbackSection, RollbackSummary };

export interface IncomingCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  authorEmail: string;
  date: string;
  files: string[];
}

export type PredictedConflictKind = 'conflict' | 'aligned';
export type PredictedConflictStatus = 'conflicted' | 'conflicted_pending' | 'dropped';

export interface PredictedConflict {
  opId: number;
  entityType: string | null;
  entityName: string | null;
  operation: 'create' | 'update' | 'delete' | null;
  kind: PredictedConflictKind;
  predictedStatus: PredictedConflictStatus;
  /** guard_mismatch | duplicate_key | missing_target | aligned */
  conflictReason: string;
  /** Value-guard apply decision (for example `rowcount_zero_conflict`); null for SQL-error conflicts. */
  decision: string | null;
  autoAlignRule: string | null;
  strategy: ConflictStrategy;
}

export interface PredictedError {
  opId: number;
  error: string;
}

export type IncomingPreviewUnavailableReason = 'local_source';

export interface IncomingPreview {
  databaseId: number;
  available: boolean;
  unavailableReason: IncomingPreviewUnavailableReason | null;
  branch: string | null;
  hasUpdates: boolean;
  commitsBehind: number;
  commitsAhead: number;
  commits: IncomingCommit[];
  conflictStrategy: ConflictStrategy;
  sections: RollbackSection[];
  summary: RollbackSummary;
  predictedConflicts: PredictedConflict[];
  predictedErrors: PredictedError[];
  currentStateHash: string | null;
  currentHead: string | null;
  incomingHead: string | null;
}

export type IncomingPreviewErrorCode = 'sync_in_progress' | 'preview_stale' | 'fetch_failed' | 'incoming_unavailable';

/** Typed failure mapped to an HTTP status/code by the route. */
export class IncomingPreviewError extends Error {
  readonly code: IncomingPreviewErrorCode;

  constructor(code: IncomingPreviewErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'IncomingPreviewError';
    this.code = code;
  }
}

export function incomingPreviewErrorStatus(code: IncomingPreviewErrorCode): number {
  return code === 'sync_in_progress' || code === 'preview_stale' ? 409 : 502;
}
