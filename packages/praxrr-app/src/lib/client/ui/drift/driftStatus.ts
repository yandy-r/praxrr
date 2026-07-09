import type { DriftSummaryStatus } from '$sync/drift/responses.ts';

/**
 * Shared presentation mapping for a drift instance status — the single source of truth for
 * the status label and `Badge` variant used by both the `/drift` dashboard and the
 * `/drift/[instanceId]` detail view.
 */
export type DriftBadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

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
