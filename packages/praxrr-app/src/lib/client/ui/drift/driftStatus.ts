import type { DriftSummaryStatus } from '$sync/drift/responses.ts';
import type {
  DriftRemediationMode,
  DriftRemediationStatus,
  DriftRemediationTrigger,
  DriftSuppressionState,
} from '$sync/drift/types.ts';

/**
 * Shared presentation mapping for a drift instance status — the single source of truth for
 * the status label and `Badge` variant used by both the `/drift` dashboard and the
 * `/drift/[instanceId]` detail view.
 */
export type DriftBadgeVariant = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

export const DRIFT_STATUS_LABEL: Record<DriftSummaryStatus, string> = {
  'in-sync': 'In sync',
  drifted: 'Drifted',
  unreachable: 'Unreachable',
  unauthorized: 'Unauthorized',
  error: 'Error',
  'never-checked': 'Never checked',
};

export function driftStatusVariant(status: DriftSummaryStatus): DriftBadgeVariant {
  switch (status) {
    case 'in-sync':
      return 'success';
    case 'drifted':
      return 'warning';
    case 'unreachable':
    case 'unauthorized':
    case 'error':
      return 'danger';
    case 'never-checked':
      return 'neutral';
  }
}

/** Badge label for an active suppression overlay; `none` renders no badge. */
export const DRIFT_SUPPRESSION_LABEL: Record<DriftSuppressionState, string> = {
  none: 'Not suppressed',
  acknowledged: 'Acknowledged',
  snoozed: 'Snoozed',
  partially_acknowledged: 'Partially acknowledged',
};

export function driftSuppressionVariant(state: DriftSuppressionState): DriftBadgeVariant {
  switch (state) {
    case 'none':
      return 'neutral';
    case 'acknowledged':
    case 'partially_acknowledged':
      return 'info';
    case 'snoozed':
      return 'neutral';
  }
}

export const DRIFT_REMEDIATION_MODE_LABEL: Record<DriftRemediationMode, string> = {
  off: 'Off',
  notify: 'Notify',
  auto: 'Auto',
};

/** Option copy for the remediation-mode picker on the drift detail page. */
export const DRIFT_REMEDIATION_MODE_DESCRIPTION: Record<DriftRemediationMode, string> = {
  off: 'No remediation. Drift notifications still fire as usual.',
  notify: 'Drift notifications suggest which sections to reconcile. Nothing is written.',
  auto: 'Praxrr reconciles allowed sections automatically through a reviewed preview.',
};

export const DRIFT_REMEDIATION_TRIGGER_LABEL: Record<DriftRemediationTrigger, string> = {
  reconcile: 'Manual reconcile',
  auto: 'Auto-remediation',
};

export const DRIFT_REMEDIATION_STATUS_LABEL: Record<DriftRemediationStatus, string> = {
  success: 'Succeeded',
  partial: 'Partially applied',
  failed: 'Failed',
  skipped: 'Skipped',
  held_canary: 'Held for Canary',
};

export function driftRemediationStatusVariant(status: DriftRemediationStatus): DriftBadgeVariant {
  switch (status) {
    case 'success':
      return 'success';
    case 'partial':
    case 'held_canary':
      return 'warning';
    case 'failed':
      return 'danger';
    case 'skipped':
      return 'neutral';
  }
}
