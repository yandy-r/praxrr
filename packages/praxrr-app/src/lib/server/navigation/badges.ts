/**
 * Cheap nav attention badges (YAN-589), attached to the resolved shell by `resolveRootLayoutData`.
 *
 * Counts come from stored data only (no Arr calls) and are cached in-process for a few seconds so
 * every layout load stays cheap. Any failure yields no badges: badges must never break the layout.
 */

import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { driftStatusQueries } from '$db/queries/driftStatus.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { driftNeedsAttention } from '$lib/server/dashboard/attention.ts';
import {
  getConflictCountsByDatabase,
  invalidateConflictCounts,
  onConflictCountsInvalidated,
} from '$pcd/conflicts/counts.ts';
import { resolveDriftSuppression } from '$sync/drift/suppression.ts';
import { isSyncPreviewArrType } from '$sync/preview/types.ts';
import type { NavBadge, NavShell } from '$shared/navigation/types.ts';

export const NAV_BADGE_CACHE_TTL_MS = 3_000;

export interface NavBadgeCounts {
  driftAttention: number;
  conflicts: number;
}

let cache: { counts: NavBadgeCounts; at: number } | null = null;

/** Test seam: drop the cached counts. */
export function resetNavBadgeCacheForTest(): void {
  cache = null;
}

// PCD compiles invalidate only the conflict-count cache (pcd cannot import this module without a
// cycle); chain the badge cache off that so it never outlives the counts it was built from.
onConflictCountsInvalidated(() => {
  cache = null;
});

/**
 * Drop every cache feeding the nav badges (badge counts + conflict counts). Call after a mutation
 * that changes them: conflict align/override, drift acknowledge/snooze. PCD compiles that write
 * op-history rows invalidate the conflict counts directly, which also clears the badge cache.
 */
export function invalidateNavBadges(): void {
  cache = null;
  invalidateConflictCounts();
}

/** Returns the counts plus whether every part was computed successfully (failures are not cached). */
function computeCounts(): { counts: NavBadgeCounts; ok: boolean } {
  let ok = true;
  let driftAttention = 0;
  try {
    const enabledIds = new Set(
      arrInstancesQueries
        .getEnabled()
        .filter((instance) => isSyncPreviewArrType(instance.type))
        .map((instance) => instance.id)
    );
    const nowMs = Date.now();
    for (const row of driftStatusQueries.getAllForSummary()) {
      if (!enabledIds.has(row.arrInstanceId)) continue;
      // Same predicate as the dashboard card flag / `attention.driftInstances`.
      if (driftNeedsAttention({ status: row.status, suppression: resolveDriftSuppression(row, nowMs).state })) {
        driftAttention += 1;
      }
    }
  } catch {
    ok = false;
    driftAttention = 0;
  }

  let conflicts = 0;
  try {
    const databaseIds = new Set(databaseInstancesQueries.getAll().map((database) => database.id));
    for (const [databaseId, count] of getConflictCountsByDatabase()) {
      if (databaseIds.has(databaseId)) conflicts += count;
    }
  } catch {
    ok = false;
    conflicts = 0;
  }

  return { counts: { driftAttention, conflicts }, ok };
}

export function getNavBadgeCounts(now: number = Date.now()): NavBadgeCounts {
  if (cache && now - cache.at < NAV_BADGE_CACHE_TTL_MS) {
    return cache.counts;
  }
  const { counts, ok } = computeCounts();
  if (ok) cache = { counts, at: now };
  return counts;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Badge for a nav item id, or undefined when there is nothing to flag. */
export function resolveNavBadge(itemId: string, counts: NavBadgeCounts): NavBadge | undefined {
  if (itemId === 'overview.drift' && counts.driftAttention > 0) {
    return {
      count: counts.driftAttention,
      tone: 'warning',
      label: `${plural(counts.driftAttention, 'instance needs', 'instances need')} drift attention`,
    };
  }
  if (itemId === 'overview.databases' && counts.conflicts > 0) {
    return {
      count: counts.conflicts,
      tone: 'danger',
      label: plural(counts.conflicts, 'conflict', 'conflicts'),
    };
  }
  return undefined;
}

/** Return a shell copy with badges attached; the input shell is not mutated (and never throws). */
export function attachNavBadges(shell: NavShell): NavShell {
  try {
    const counts = getNavBadgeCounts();
    if (counts.driftAttention === 0 && counts.conflicts === 0) return shell;
    return {
      ...shell,
      groups: shell.groups.map((group) => ({
        ...group,
        items: group.items.map((item) => {
          const badge = resolveNavBadge(item.id, counts);
          return badge ? { ...item, badge } : item;
        }),
      })),
    };
  } catch {
    return shell;
  }
}
