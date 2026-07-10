import type { SyncEntityAction, SyncEntityOutcomeStatus } from '$sync/types.ts';

/**
 * Presentation vocabulary for a CONFIRMED per-entity apply outcome (issue #232).
 *
 * Deliberately separate from the planned-preview "Planned create/update" wording
 * (`SyncPreviewEntityDiff` / `SyncHistoryDiff` ACTION_META) so a confirmed result is
 * never mistaken for planned intent. The label composes the attempted action with the
 * terminal status; the badge variant is driven by the status alone.
 */
export type SyncOutcomeBadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

export function syncOutcomeLabel(action: SyncEntityAction, status: SyncEntityOutcomeStatus): string {
  if (status === 'failed') {
    return 'Failed';
  }
  if (status === 'skipped') {
    return 'Skipped';
  }
  switch (action) {
    case 'create':
      return 'Created';
    case 'update':
      return 'Updated';
    case 'delete':
      return 'Deleted';
  }
}

export function syncOutcomeVariant(status: SyncEntityOutcomeStatus): SyncOutcomeBadgeVariant {
  switch (status) {
    case 'success':
      return 'success';
    case 'skipped':
      return 'neutral';
    case 'failed':
      return 'danger';
  }
}
