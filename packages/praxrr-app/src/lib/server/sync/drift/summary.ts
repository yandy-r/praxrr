/**
 * Fleet drift summary rollup.
 *
 * Extracted from the inline body of `routes/api/v1/drift/summary/+server.ts` so the drift route AND
 * the MCP `get_drift_status` tool / `praxrr://drift/summary` resource share one implementation.
 *
 * Returns the settings-free CORE only (`generatedAt`, `totals`, `instances`). The scheduler config
 * (`settings`/`nextRunAt`) stays in the route because it needs the drift settings singleton + the
 * job queue — a scheduler coupling irrelevant to the per-instance rollup.
 */

import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { driftStatusQueries } from '$db/queries/driftStatus.ts';
import { isSyncPreviewArrType } from '$sync/preview/types.ts';
import { toInstanceSummary, type DriftInstanceSummary } from '$sync/drift/responses.ts';

export interface DriftSummaryTotals {
  instances: number;
  inSync: number;
  drifted: number;
  unreachable: number;
  unauthorized: number;
  error: number;
  neverChecked: number;
}

export interface DriftSummaryCore {
  generatedAt: string;
  totals: DriftSummaryTotals;
  instances: DriftInstanceSummary[];
}

/** Latest drift status for every enabled, sync-capable Arr instance, plus aggregate totals. */
export function buildDriftSummary(): DriftSummaryCore {
  const instances = arrInstancesQueries.getEnabled().filter((instance) => isSyncPreviewArrType(instance.type));

  const rowsById = new Map(driftStatusQueries.getAllForSummary().map((row) => [row.arrInstanceId, row]));

  const summaries: DriftInstanceSummary[] = instances.map((instance) =>
    toInstanceSummary(instance, rowsById.get(instance.id))
  );

  const totals: DriftSummaryTotals = {
    instances: summaries.length,
    inSync: summaries.filter((summary) => summary.status === 'in-sync').length,
    drifted: summaries.filter((summary) => summary.status === 'drifted').length,
    unreachable: summaries.filter((summary) => summary.status === 'unreachable').length,
    unauthorized: summaries.filter((summary) => summary.status === 'unauthorized').length,
    error: summaries.filter((summary) => summary.status === 'error').length,
    neverChecked: summaries.filter((summary) => summary.status === 'never-checked').length,
  };

  return { generatedAt: new Date().toISOString(), totals, instances: summaries };
}
