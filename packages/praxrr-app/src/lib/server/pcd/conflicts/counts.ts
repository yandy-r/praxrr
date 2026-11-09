/**
 * Shared, short-lived accessor for conflicted-op counts per database.
 *
 * Used by both the nav badges and the home dashboard so a cold `/` runs the aggregate query once.
 * Concurrent misses share one load and failures are never cached. Conflict mutations (align /
 * override) call {@link invalidateConflictCounts} so the UI reflects them immediately.
 */

import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';

export const CONFLICT_COUNTS_TTL_MS = 5_000;

let entry: { counts: ReadonlyMap<number, number>; at: number } | null = null;
let generation = 0;

/** Latest conflicted-op count per database id (databases with none are absent). */
export function getConflictCountsByDatabase(): ReadonlyMap<number, number> {
  const now = Date.now();
  if (entry && now - entry.at < CONFLICT_COUNTS_TTL_MS) return entry.counts;
  const started = generation;
  // Synchronous query: concurrent callers cannot interleave, so no in-flight sharing is needed.
  const counts = pcdOpHistoryQueries.countLatestConflictsByDatabase();
  if (started === generation) entry = { counts, at: now };
  return counts;
}

const invalidationListeners = new Set<() => void>();

/**
 * Subscribe to conflict-count invalidation so downstream caches (e.g. nav badges) can chain off it
 * without the pcd layer importing them (navigation/badges.ts imports pcd, so a direct import
 * from pcd would be a cycle).
 */
export function onConflictCountsInvalidated(listener: () => void): void {
  invalidationListeners.add(listener);
}

/** Drop the cached counts (call after any conflict resolution / op-history mutation). */
export function invalidateConflictCounts(): void {
  generation += 1;
  entry = null;
  for (const listener of invalidationListeners) listener();
}
