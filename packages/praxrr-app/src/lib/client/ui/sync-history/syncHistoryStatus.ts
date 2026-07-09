import type { SyncOperationStatus } from '$sync/syncHistory/types.ts';

/**
 * Shared presentation mapping for a sync-history run status — the single source of
 * truth for the status label and `Badge` variant used by both the `/sync-history`
 * list and the `/sync-history/[id]` detail view. Mirrors `$ui/drift/driftStatus.ts`.
 */
export type SyncHistoryBadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

export const SYNC_HISTORY_STATUS_LABEL: Record<SyncOperationStatus, string> = {
  success: 'Success',
  partial: 'Partial',
  failed: 'Failed',
  skipped: 'Skipped',
};

export function syncHistoryStatusVariant(status: SyncOperationStatus): SyncHistoryBadgeVariant {
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
