/**
 * Home dashboard (`/`) data builder (YAN-589).
 *
 * Every source is isolated: a failure degrades that section (null / empty / zeros) and is logged
 * at warn level; `buildHomeDashboard` never throws. Only cheap, stored data is read — config
 * health uses the latest stored snapshot (never `scoreFleet`), and the security headline reuses
 * the 60s shield cache.
 */

import { canaryRolloutQueries } from '$db/queries/canaryRollouts.ts';
import { cachedShield } from '$lib/server/security/shieldCache.ts';
import type { SessionRequestContext } from '$shared/security/index.ts';
import type { DashboardCanaryRollout, DashboardSource, HomeDashboardData } from '$shared/dashboard/types.ts';
import { computeAttention } from './attention.ts';
import { getParserAvailable } from './parser.ts';
import { summarizeConflicts, type ConflictSummary } from './conflicts.ts';
import { buildInstanceSections, type InstanceSections } from './instances.ts';
import { degrade, withDeadline } from './safe.ts';

/** Hard cap per slow source (the parser client retries; posture may do DNS lookups). */
const SLOW_SOURCE_DEADLINE_MS = 2_000;
const CANARY_SCAN_LIMIT = 50;

const ACTIVE_CANARY_STATUSES = new Set<DashboardCanaryRollout['status']>([
  'canary_running',
  'awaiting_confirmation',
  'rolling_out',
]);

const EMPTY_CONFLICTS: ConflictSummary = { total: 0, databases: [], databaseCount: 0 };

function listActiveCanary(): DashboardCanaryRollout[] {
  const active: DashboardCanaryRollout[] = [];
  for (const rollout of canaryRolloutQueries.listRecent(CANARY_SCAN_LIMIT, 0)) {
    if (!ACTIVE_CANARY_STATUSES.has(rollout.status as DashboardCanaryRollout['status'])) continue;
    active.push({
      id: rollout.id,
      arrType: rollout.arrType,
      status: rollout.status as DashboardCanaryRollout['status'],
      canaryInstanceName: rollout.canaryInstanceName,
      startedAt: rollout.startedAt,
      href: `/canary/${rollout.id}`,
    });
  }
  return active;
}

export async function buildHomeDashboard(event?: SessionRequestContext): Promise<HomeDashboardData> {
  const [sections, conflicts, canary, security, parser] = await Promise.all([
    degrade<InstanceSections>('instances', EMPTY_SECTIONS, buildInstanceSections),
    degrade('conflicts', EMPTY_CONFLICTS, summarizeConflicts),
    degrade<DashboardCanaryRollout[]>('canary', [], listActiveCanary),
    degrade<HomeDashboardData['security']>(
      'security',
      null,
      withDeadline(SLOW_SOURCE_DEADLINE_MS, async () => {
        const shield = await cachedShield(event);
        return { score: shield.score, band: shield.band };
      })
    ),
    // A timeout/unhealthy parser is a real "unavailable" result, not a degraded source.
    withDeadline(SLOW_SOURCE_DEADLINE_MS, () => getParserAvailable())().catch(() => false),
  ]);

  const degraded = new Set<DashboardSource>(sections.value.degraded);
  if (sections.failed) degraded.add('instances');
  if (conflicts.failed) degraded.add('conflicts');
  if (canary.failed) degraded.add('canary');
  if (security.failed) degraded.add('security');

  return {
    generatedAt: new Date().toISOString(),
    degraded: [...degraded],
    attention: computeAttention(sections.value.instances),
    instances: sections.value.instances,
    drift: sections.value.drift,
    conflicts: { total: conflicts.value.total, databases: conflicts.value.databases },
    canary: canary.value,
    recentSyncs: sections.value.recentSyncs,
    security: security.value,
    parser: { available: parser },
    databaseCount: conflicts.value.databaseCount,
  };
}

const EMPTY_SECTIONS: InstanceSections = {
  degraded: [],
  instances: [],
  drift: { instances: 0, inSync: 0, drifted: 0, unreachable: 0, unauthorized: 0, error: 0, neverChecked: 0 },
  recentSyncs: [],
};
