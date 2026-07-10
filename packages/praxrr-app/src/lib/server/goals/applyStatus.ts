/**
 * Single source of truth for the `GoalApplyStatus` operator surface (issue #236).
 *
 * Every wire surface — the apply/reconcile responses, `GET /goals/apply/status`, and the binding
 * response — builds its status through {@link buildApplyStatus} so the reported `scoringChanged`,
 * `bindingStatus`, and `recovery` action can never drift between them. Recovery is `reconcile` for any
 * non-succeeded outcome and `none` once terminal.
 */

import type { components } from '$api/v1.d.ts';
import type { QualityGoalApplyJournalRow } from '$db/queries/qualityGoalApplyJournal.ts';

type GoalApplyStatus = components['schemas']['GoalApplyStatus'];
type GoalApplyFailure = components['schemas']['GoalApplyFailure'];
type GoalRecoveryAction = components['schemas']['GoalRecoveryAction'];

/** The safe recovery action for a failed/pending apply: re-drive the recorded intent idempotently. */
export const RECONCILE_RECOVERY: GoalRecoveryAction = {
  action: 'reconcile',
  endpoint: '/api/v1/goals/reconcile'
};

/** No recovery needed — the apply reached its confirmed terminal state. */
export const NONE_RECOVERY: GoalRecoveryAction = { action: 'none', endpoint: null };

export interface ApplyStatusFields {
  applyId: number;
  status: GoalApplyStatus['status'];
  /** Whether scoring reached (or may have reached) its intended terminal state via a write this attempt. */
  scoringChanged: boolean;
  bindingPersisted: boolean;
  failureStage: 'scoring' | 'binding' | null;
  failureReason: string | null;
  intentFingerprint: string;
  startedAt: string;
  settledAt: string | null;
}

/** Build a `GoalApplyStatus` from normalized fields — the one place `bindingStatus`/`recovery` are derived. */
export function buildApplyStatus(fields: ApplyStatusFields): GoalApplyStatus {
  const bindingStatus: GoalApplyStatus['bindingStatus'] = fields.bindingPersisted
    ? 'written'
    : fields.status === 'pending'
      ? 'pending'
      : 'failed';

  return {
    applyId: fields.applyId,
    status: fields.status,
    scoringChanged: fields.scoringChanged,
    bindingStatus,
    failureStage: fields.failureStage,
    failureReason: fields.failureReason,
    intentFingerprint: fields.intentFingerprint,
    startedAt: fields.startedAt,
    settledAt: fields.settledAt,
    recovery: fields.status === 'succeeded' ? NONE_RECOVERY : RECONCILE_RECOVERY
  };
}

export interface ApplyFailureFields {
  applyId: number;
  message: string;
  /** Whether scoring reached (or may have reached) its intended terminal state before the failure. */
  scoringChanged: boolean;
  failureStage: 'scoring' | 'binding';
  intentFingerprint: string;
  startedAt: string;
}

/** Build the structured `GoalApplyFailure` body (message + reported outcome + reconcile action) for a failed apply/reconcile. */
export function buildApplyFailure(fields: ApplyFailureFields): GoalApplyFailure {
  return {
    message: fields.message,
    applyStatus: buildApplyStatus({
      applyId: fields.applyId,
      status: 'failed',
      scoringChanged: fields.scoringChanged,
      bindingPersisted: false,
      failureStage: fields.failureStage,
      failureReason: fields.message,
      intentFingerprint: fields.intentFingerprint,
      startedAt: fields.startedAt,
      settledAt: new Date().toISOString()
    })
  };
}

/** Map a persisted journal row to its `GoalApplyStatus` — used by the status GET and binding response. */
export function mapJournalRowToApplyStatus(row: QualityGoalApplyJournalRow): GoalApplyStatus {
  return buildApplyStatus({
    applyId: row.id,
    status: row.status,
    scoringChanged: row.scoring_persisted === 1,
    bindingPersisted: row.binding_persisted === 1,
    failureStage: row.failure_stage,
    failureReason: row.failure_reason,
    intentFingerprint: row.intent_fingerprint,
    startedAt: row.started_at,
    settledAt: row.settled_at
  });
}
