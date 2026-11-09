import type { DashboardAttention, DashboardInstanceCard } from '$shared/dashboard/types.ts';

const DEGRADED_DRIFT_STATUSES: ReadonlySet<string> = new Set(['drifted', 'unreachable', 'unauthorized', 'error']);

/**
 * Whether a stored drift state warrants attention: a degraded status that is NOT acknowledged or
 * snoozed. Single source of truth for the card flag, `attention.driftInstances` and the nav badge.
 */
export function driftNeedsAttention(drift: { status: string; suppression: string }): boolean {
  return (
    DEGRADED_DRIFT_STATUSES.has(drift.status) && drift.suppression !== 'acknowledged' && drift.suppression !== 'snoozed'
  );
}

export function healthNeedsAttention(band: string | null | undefined): boolean {
  return band === 'attention' || band === 'needs-review';
}

export function syncNeedsAttention(status: string | null | undefined): boolean {
  return status === 'failed' || status === 'partial';
}

export function computeAttention(instances: readonly DashboardInstanceCard[]): DashboardAttention {
  return {
    driftInstances: instances.filter((card) => driftNeedsAttention(card.drift)).length,
    healthInstances: instances.filter((card) => healthNeedsAttention(card.health?.band)).length,
    failedSyncInstances: instances.filter((card) => syncNeedsAttention(card.lastSync?.status)).length,
  };
}
