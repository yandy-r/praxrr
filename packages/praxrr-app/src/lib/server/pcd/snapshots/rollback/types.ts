/**
 * Rollback / Point-in-Time Restore DTOs and typed errors (issue #16).
 *
 * The rollback preview is PCD-to-PCD and database-scoped: it never references an Arr
 * instance. Diff direction is `diffToFieldChanges(currentPCD, snapshotPCD)`, so a
 * `FieldChange.current` is the current PCD desired-state and `FieldChange.desired` is the
 * snapshot restore-target state (NOT live Arr). UI labels these "Current" vs "After restore".
 */

import type { ArrAppType } from '$shared/pcd/types.ts';
import type { EntityChange } from '$sync/preview/types.ts';

/**
 * A group of entity changes for one resolved-config family (entity type, and arrType for
 * per-arr families). `entityType` in each `EntityChange` is namespaced `${entityType}:${arrType}`
 * for per-arr families so identical names across arrs never collide.
 */
export interface RollbackSection {
  title: string;
  entityType: string;
  arrType: ArrAppType | null;
  changes: EntityChange[];
}

export interface RollbackSummary {
  totalCreates: number;
  totalUpdates: number;
  totalDeletes: number;
  totalUnchanged: number;
}

/**
 * Mandatory preview of what restoring a snapshot would change in the PCD desired state.
 *
 * When `reconstructable` is false the snapshot cannot be safely restored (legacy snapshot
 * without a fingerprint, or the reconstructed op set fails fingerprint verification); in
 * that case `sections` is empty and `reason` explains why.
 */
export interface RollbackPreview {
  databaseId: number;
  snapshotId: number;
  reconstructable: boolean;
  reason: string | null;
  /** Live published-op fingerprint at preview time; echoed back as the execute from-guard. */
  currentStateHash: string | null;
  /** The snapshot's stored restore-target fingerprint. */
  snapshotStateHash: string | null;
  opsWrittenSince: number;
  sections: RollbackSection[];
  summary: RollbackSummary;
}

export interface RollbackResult {
  rollbackId: number;
  snapshotId: number;
  databaseId: number;
  status: 'success' | 'failed';
  opsUndone: number;
  opsReactivated: number;
  preRollbackSnapshotId: number | null;
  targetStateHash: string | null;
  postVerified: boolean;
  error: string | null;
  createdAt: string;
}

/** The requested snapshot cannot be reconstructed/verified — restore refuses (fail-closed). */
export class RollbackUnverifiableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RollbackUnverifiableError';
  }
}

/** The live PCD state changed since the preview was generated (from-state value-guard). */
export class RollbackStaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RollbackStaleError';
  }
}

/** The restore applied but the recompiled state did not match the snapshot fingerprint. */
export class RollbackPostVerifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RollbackPostVerifyError';
  }
}

export function isRollbackUnverifiableError(error: unknown): error is RollbackUnverifiableError {
  return error instanceof RollbackUnverifiableError;
}

export function isRollbackStaleError(error: unknown): error is RollbackStaleError {
  return error instanceof RollbackStaleError;
}

export function isRollbackPostVerifyError(error: unknown): error is RollbackPostVerifyError {
  return error instanceof RollbackPostVerifyError;
}
