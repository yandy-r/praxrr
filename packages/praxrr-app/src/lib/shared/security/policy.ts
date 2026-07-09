/**
 * Security Posture scoring policy (issue #28).
 *
 * The shield-specific tunable math: band thresholds, band derivation, and the critical band-cap that
 * prevents strong sub-scores from averaging a wide-open front door into a green band. The 0–100 clamp
 * and the weighted rollup come from the shared `$shared/scoring/rollup.ts` primitive (also used by
 * config-health) — re-exported here so this module is the single import surface for the engine.
 */

import { clamp0100, rollUp } from '$shared/scoring/rollup.ts';
import type { CheckResult, SecurityCheckId, ShieldBand } from './types.ts';

export { clamp0100, rollUp };

/** Score at/above which a deployment is "hardened". */
export const HARDENED_THRESHOLD = 85;
/** Score at/above which a deployment is "guarded" (below it is "exposed"). */
export const GUARDED_THRESHOLD = 60;

/**
 * Band for a rolled-up score. `anyScored` distinguishes a genuine low score from "nothing could be
 * evaluated": when every check was skipped (all null), the report is `unknown`, never a misleading 0.
 * In practice `control_plane_auth` always scores, so `unknown` is effectively unreachable.
 */
export function shieldBandFor(score: number, anyScored: boolean): ShieldBand {
  if (!anyScored) return 'unknown';
  if (score >= HARDENED_THRESHOLD) return 'hardened';
  if (score >= GUARDED_THRESHOLD) return 'guarded';
  return 'exposed';
}

/** Restrictiveness rank — a LOWER rank is a worse (more restrictive) band. `unknown` sits at the bottom. */
const BAND_RANK: Record<ShieldBand, number> = { unknown: 0, exposed: 1, guarded: 2, hardened: 3 };

/**
 * Lower the rolled band to the WORST cap declared by any check whose status is `action` (a live
 * danger). The numeric score is untouched and still displayed; this only prevents false confidence
 * (e.g. AUTH=off on a public bind can never surface as `hardened`/`guarded` because strong transport
 * and credentials averaged the number up). Returns the (possibly-lowered) band and the check that
 * lowered it, or `null` when no cap applied.
 */
export function capBand(
  rolledBand: ShieldBand,
  checks: readonly CheckResult[]
): { band: ShieldBand; cappedBy: { checkId: SecurityCheckId; label: string } | null } {
  let band = rolledBand;
  let cappedBy: { checkId: SecurityCheckId; label: string } | null = null;

  for (const check of checks) {
    if (check.status !== 'action' || check.bandCapWhenAction === null) continue;
    if (BAND_RANK[check.bandCapWhenAction] < BAND_RANK[band]) {
      band = check.bandCapWhenAction;
      cappedBy = { checkId: check.id, label: check.label };
    }
  }

  return { band, cappedBy };
}
