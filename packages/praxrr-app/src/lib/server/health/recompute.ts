/**
 * Config Health recompute-and-persist (issue #224).
 *
 * Backs the on-demand `POST /api/v1/config-health/{instanceId}/recompute` route. It reuses the SAME
 * live scorer (`scoreInstance` → `computeHealthReport`) and the SAME persist query
 * (`configHealthSnapshotsQueries.insert`) as the scheduled snapshot sweep, so on-demand and scheduled
 * snapshots can never diverge in schema or engine version. It returns a discriminated outcome so the
 * route can map the "no fresh snapshot" causes to distinct status codes.
 *
 * MUST NEVER THROW: the route maps failures via the discriminated outcome, not exceptions. On an
 * insert failure it logs and returns `{ kind: 'error' }` (→ 500). The module-private in-flight `Set`
 * additionally bounds concurrent on-demand recomputes for the same instance (→ 409).
 *
 * NOTE: a degraded/unreachable instance is NOT an error. Scoring does no live Arr I/O — a missing
 * signal degrades to band `unknown` inside `computeHealthReport`, never a throw — so such an instance
 * still yields a scoreable report and an `ok` outcome (identical to the GET detail route). `error` is
 * reachable only from the snapshot INSERT failing.
 *
 * Enabled-gating is a CALLER responsibility: the route rejects disabled instances (400). Like the
 * scheduled sweep (which pre-filters `getEnabled()`), this helper deliberately does not re-check
 * `enabled`, so the persisted trend never gains a point for a disabled instance.
 */

import { logger } from '$logger/logger.ts';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import { configHealthSnapshotsQueries } from '$db/queries/configHealthSnapshots.ts';
import type { HealthReport } from '$shared/health/index.ts';
import { scoreInstance as defaultScoreInstance } from './service.ts';

const SOURCE = 'ConfigHealthRecompute';

/** Instances with an in-flight recompute; prevents a double score + double snapshot-insert race. */
const inFlight = new Set<number>();

/**
 * Discriminated result so the route can tell the "no fresh snapshot" causes apart: an instance already
 * being recomputed (→ 409), an unknown or not-sync-capable instance (→ 404), or an unexpected
 * persistence error (→ 500).
 */
export type RecomputeOutcome =
  | { readonly kind: 'ok'; readonly report: HealthReport }
  | { readonly kind: 'skipped' }
  | { readonly kind: 'in_flight' }
  | { readonly kind: 'error' };

/** Overridable seam so tests can drive the outcome without a real gather/score pass. */
export interface RecomputeDeps {
  scoreInstance: (instanceId: number) => Promise<HealthReport | null>;
}

/**
 * Scores one instance live and appends the report to `config_health_snapshots`. Never throws. An
 * already-in-flight instance returns `{ kind: 'in_flight' }`; an unknown/not-sync-capable instance
 * returns `{ kind: 'skipped' }`; a snapshot-insert failure returns `{ kind: 'error' }`.
 */
export async function recomputeAndPersistInstance(
  instance: ArrInstance,
  deps: Partial<RecomputeDeps> = {}
): Promise<RecomputeOutcome> {
  if (inFlight.has(instance.id)) {
    return { kind: 'in_flight' };
  }
  inFlight.add(instance.id);

  const scoreInstance = deps.scoreInstance ?? defaultScoreInstance;

  try {
    const report = await scoreInstance(instance.id);
    if (!report) {
      return { kind: 'skipped' };
    }
    configHealthSnapshotsQueries.insert(report);
    return { kind: 'ok', report };
  } catch (error) {
    await logger.error('Config health recompute-and-persist failed', {
      source: SOURCE,
      meta: {
        instanceId: instance.id,
        instanceName: instance.name,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return { kind: 'error' };
  } finally {
    inFlight.delete(instance.id);
  }
}
