import type { CanaryOutcomeStatus, CanaryRolloutStatus } from '$sync/canary/types.ts';

/**
 * Shared presentation mapping for canary rollout / outcome statuses — the single
 * source of truth for the status label and `Badge` variant used by both the
 * `/canary` list and the `/canary/[id]` detail view. Mirrors
 * `$ui/sync-history/syncHistoryStatus.ts`.
 */
export type CanaryBadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

export const CANARY_ROLLOUT_STATUS_LABEL: Record<CanaryRolloutStatus, string> = {
  canary_running: 'Canary Running',
  awaiting_confirmation: 'Awaiting Confirmation',
  rolling_out: 'Rolling Out',
  completed: 'Completed',
  aborted: 'Aborted',
  failed: 'Failed',
};

export function canaryRolloutStatusVariant(status: CanaryRolloutStatus): CanaryBadgeVariant {
  switch (status) {
    case 'completed':
      return 'success';
    case 'awaiting_confirmation':
      return 'warning';
    case 'aborted':
    case 'failed':
      return 'danger';
    case 'canary_running':
    case 'rolling_out':
      return 'neutral';
  }
}

export const CANARY_OUTCOME_STATUS_LABEL: Record<CanaryOutcomeStatus, string> = {
  success: 'Success',
  partial: 'Partial',
  failed: 'Failed',
  skipped: 'Skipped',
};

export function canaryOutcomeStatusVariant(status: CanaryOutcomeStatus): CanaryBadgeVariant {
  switch (status) {
    case 'success':
      return 'success';
    case 'partial':
      return 'warning';
    case 'failed':
      return 'danger';
    case 'skipped':
      return 'neutral';
  }
}
