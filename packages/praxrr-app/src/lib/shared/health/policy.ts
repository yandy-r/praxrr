/**
 * Config Health scoring policy (issue #22).
 *
 * The health-specific tunable math: the band thresholds and the band derivation. The clamp and the
 * weighted rollup now live in the shared `$shared/scoring/rollup.ts` primitive (extracted for #28 so
 * config-health and security-posture share one implementation); they are re-exported here so this
 * module's public surface — and every existing importer — is unchanged. All arithmetic stays integer
 * (`Math.round`); the per-criterion contributions sum EXACTLY to the total (residual assigned to the
 * largest-weight criterion), an invariant pinned by a test — mirroring the goals `policy.ts` guarantee.
 */

import {
  clamp0100,
  rollUp,
  type RollupResult as ScoringRollupResult,
  type WeightedScore as ScoringWeightedScore,
} from '$shared/scoring/rollup.ts';
import type { CriterionId, HealthBand } from './types.ts';

/** Re-exported from the shared scoring primitive so the health policy surface is unchanged. */
export { clamp0100, rollUp };

/** One scored criterion entering the rollup (nulls are filtered out before this). */
export type WeightedScore = ScoringWeightedScore<CriterionId>;

/** The rollup outcome: the 0–100 total and each criterion's exact integer contribution to it. */
export type RollupResult = ScoringRollupResult<CriterionId>;

/** Score at/above which a unit is "healthy". */
export const HEALTHY_THRESHOLD = 85;
/** Score at/above which a unit needs "attention" (below it is "needs-review"). */
export const ATTENTION_THRESHOLD = 60;

/**
 * Band for a rolled-up score. `anyScored` distinguishes a genuine low score from "nothing could be
 * evaluated": when every enabled criterion was skipped (all null), the unit is `unknown`, never a
 * misleading 0 → `needs-review`.
 */
export function bandFor(score: number, anyScored: boolean): HealthBand {
  if (!anyScored) return 'unknown';
  if (score >= HEALTHY_THRESHOLD) return 'healthy';
  if (score >= ATTENTION_THRESHOLD) return 'attention';
  return 'needs-review';
}
