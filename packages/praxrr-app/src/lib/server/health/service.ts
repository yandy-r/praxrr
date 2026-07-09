/**
 * Config Health service (issue #22).
 *
 * The thin orchestration seam between the gatherer and the pure engine. `scoreInstance` powers the
 * detail route; `scoreFleet` powers the summary route and the snapshot job. Read-only — it computes
 * reports and never persists (the snapshot job owns writes). Never lets one instance abort a fleet.
 */

import { logger } from '$logger/logger.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { isSyncPreviewArrType } from '$sync/preview/types.ts';
import { computeHealthReport, type HealthReport } from '$shared/health/index.ts';
import { buildHealthInputs } from './gather.ts';

const SOURCE = 'ConfigHealthService';

/** Score one instance live, or `null` when it is unknown or not sync-capable. */
export async function scoreInstance(instanceId: number): Promise<HealthReport | null> {
  const instance = arrInstancesQueries.getById(instanceId);
  if (!instance || !isSyncPreviewArrType(instance.type)) {
    return null;
  }
  const inputs = await buildHealthInputs(instance);
  return computeHealthReport(inputs);
}

/** Score every enabled, sync-capable instance. A failing instance is logged and skipped. */
export async function scoreFleet(): Promise<HealthReport[]> {
  const instances = arrInstancesQueries.getEnabled().filter((instance) => isSyncPreviewArrType(instance.type));
  const reports: HealthReport[] = [];
  for (const instance of instances) {
    try {
      reports.push(computeHealthReport(await buildHealthInputs(instance)));
    } catch (error) {
      await logger.error('Config health: failed to score instance in fleet sweep', {
        source: SOURCE,
        meta: { instanceId: instance.id, error: error instanceof Error ? error.message : String(error) }
      });
    }
  }
  return reports;
}
