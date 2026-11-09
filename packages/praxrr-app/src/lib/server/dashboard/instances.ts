import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { configHealthSnapshotsQueries } from '$db/queries/configHealthSnapshots.ts';
import { syncHistoryQueries } from '$db/queries/syncHistory.ts';
import { buildDriftSummary } from '$sync/drift/summary.ts';
import type { DriftInstanceSummary } from '$sync/drift/responses.ts';
import { isSyncPreviewArrType, type SyncPreviewArrType } from '$sync/preview/types.ts';
import type {
  DashboardArrType,
  DashboardSource,
  DashboardDriftTotals,
  DashboardInstanceCard,
  DashboardInstanceDrift,
  DashboardInstanceHealth,
  DashboardInstanceLastSync,
  DashboardRecentSync,
} from '$shared/dashboard/types.ts';
import { degrade } from './safe.ts';
import { driftNeedsAttention, healthNeedsAttention, syncNeedsAttention } from './attention.ts';

const ZERO_DRIFT_TOTALS: DashboardDriftTotals = {
  instances: 0,
  inSync: 0,
  drifted: 0,
  unreachable: 0,
  unauthorized: 0,
  error: 0,
  neverChecked: 0,
};

const NEVER_CHECKED: DashboardInstanceDrift = {
  status: 'never-checked',
  changeCount: 0,
  suppression: 'none',
  checkedAt: null,
};

function toDriftCard(summary: DriftInstanceSummary | undefined): DashboardInstanceDrift {
  if (!summary) return NEVER_CHECKED;
  const { drifted, missing, unmanaged, prune } = summary.counts;
  return {
    status: summary.status,
    changeCount: drifted + missing + unmanaged + prune,
    suppression: summary.suppression,
    checkedAt: summary.checkedAt,
  };
}

export interface InstanceSections {
  /** Sources that failed while building these sections. */
  degraded: DashboardSource[];
  instances: DashboardInstanceCard[];
  drift: DashboardDriftTotals;
  recentSyncs: DashboardRecentSync[];
}

export function buildInstanceLinks(id: number): DashboardInstanceCard['links'] {
  return {
    instance: `/arr/${id}`,
    previewSync: `/arr/${id}/sync`,
    drift: `/drift/${id}`,
    health: `/config-health/${id}`,
    syncHistory: `/sync-history?instanceId=${id}`,
  };
}

export async function buildInstanceSections(): Promise<InstanceSections> {
  const degraded = new Set<DashboardSource>();
  const track = <T>(source: DashboardSource, result: { value: T; failed: boolean }): T => {
    if (result.failed) degraded.add(source);
    return result.value;
  };

  const enabled = track(
    'instances',
    await degrade('instances', [] as ReturnType<typeof arrInstancesQueries.getEnabled>, () =>
      arrInstancesQueries.getEnabled().filter((instance) => isSyncPreviewArrType(instance.type))
    )
  );

  const driftCore = track('drift', await degrade('drift', null, () => buildDriftSummary()));
  const driftById = new Map((driftCore?.instances ?? []).map((summary) => [summary.instanceId, summary]));

  const healthById = track(
    'health',
    await degrade('health', new Map<number, DashboardInstanceHealth>(), () => {
      const map = new Map<number, DashboardInstanceHealth>();
      for (const row of configHealthSnapshotsQueries.getLatestPerInstance()) {
        map.set(row.arrInstanceId, { score: row.overallScore, band: row.band, generatedAt: row.generatedAt });
      }
      return map;
    })
  );

  const instances: DashboardInstanceCard[] = [];
  for (const instance of enabled) {
    const lastSync = track(
      'lastSync',
      await degrade<DashboardInstanceLastSync | null>('lastSync', null, () => {
        const row = syncHistoryQueries.search({ instanceId: instance.id }, { limit: 1, offset: 0 })[0];
        return row
          ? { historyId: row.id, status: row.status, startedAt: row.startedAt, finishedAt: row.finishedAt }
          : null;
      })
    );
    const drift = toDriftCard(driftById.get(instance.id));
    const health = healthById.get(instance.id) ?? null;
    const needsAttention =
      driftNeedsAttention(drift) || healthNeedsAttention(health?.band) || syncNeedsAttention(lastSync?.status);

    instances.push({
      id: instance.id,
      name: instance.name,
      arrType: instance.type as SyncPreviewArrType as DashboardArrType,
      health,
      drift,
      lastSync,
      needsAttention,
      links: buildInstanceLinks(instance.id),
    });
  }

  const recentSyncs = track(
    'recentSyncs',
    await degrade<DashboardRecentSync[]>('recentSyncs', [], () =>
      syncHistoryQueries.search({}, { limit: 5, offset: 0 }).map((row) => ({
        historyId: row.id,
        instanceId: row.arrInstanceId,
        instanceName: row.instanceName,
        arrType: row.arrType,
        status: row.status,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        href: `/sync-history/${row.id}`,
      }))
    )
  );

  return {
    degraded: [...degraded],
    instances,
    drift: driftCore?.totals ?? ZERO_DRIFT_TOTALS,
    recentSyncs,
  };
}
