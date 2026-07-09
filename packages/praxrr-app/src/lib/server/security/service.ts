/**
 * Security Posture service (issue #28).
 *
 * The thin orchestration seam between the gatherer and the pure engine. `computeShield` powers the
 * summary route. Read-only — it computes a report and never persists (there is no snapshot/settings
 * store for this feature; posture is computed on demand).
 */

import { computeShieldReport, type ShieldReport } from '$shared/security/index.ts';
import { buildPostureInputs } from './gather.ts';

/** Materialize the current deployment's facts and score them into a live {@link ShieldReport}. */
export function computeShield(): ShieldReport {
  return computeShieldReport(buildPostureInputs());
}
