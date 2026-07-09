/**
 * Cross-source status normalization for the timeline (issue #27).
 *
 * Each event source has its own status/lifecycle vocabulary. Per the Cross-Arr Semantic
 * Validation policy we never assume they share meaning: the mapping into the normalized
 * {@link TimelineStatus} domain is defined here, once, per source, and reused by both the SQL
 * feed (via {@link canaryStatusCaseSql}) and the response mapper. This keeps the projected
 * `status` column (used for the badge) and the `status` filter comparing the same normalized
 * value.
 */

import type { TimelineBadge, TimelineStatus } from './types.ts';

/** Normalized status -> badge variant. This is the colour contract for a timeline row. */
export const TIMELINE_STATUS_BADGE: Record<TimelineStatus, TimelineBadge> = {
  success: 'success',
  partial: 'warning',
  failed: 'danger',
  skipped: 'neutral',
  pending: 'info',
  info: 'neutral',
};

export function statusBadge(status: TimelineStatus): TimelineBadge {
  return TIMELINE_STATUS_BADGE[status] ?? 'neutral';
}

/**
 * Canary rollout lifecycle state -> normalized status. The rollout state machine
 * (canary_rollouts.status) is the "how did this rollout go" signal, distinct from the canary
 * instance's own sync outcome (canary_status). A rollout still in flight is `pending`.
 */
export const CANARY_STATE_STATUS: Record<string, TimelineStatus> = {
  completed: 'success',
  failed: 'failed',
  aborted: 'skipped',
  canary_running: 'pending',
  awaiting_confirmation: 'pending',
  rolling_out: 'pending',
};

/**
 * SQL CASE expression normalizing a canary lifecycle column into the {@link TimelineStatus}
 * domain, built from {@link CANARY_STATE_STATUS} so the projection and the WHERE filter can
 * never drift. `col` must be a trusted column reference (e.g. `cr.status`), never user input.
 */
export function canaryStatusCaseSql(col: string): string {
  const whenClauses = Object.entries(CANARY_STATE_STATUS)
    .map(([state, status]) => `WHEN '${state}' THEN '${status}'`)
    .join(' ');
  return `CASE ${col} ${whenClauses} ELSE 'pending' END`;
}
