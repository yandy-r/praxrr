/**
 * Config Health scoring policy (issue #22).
 *
 * The only tunable math in the engine: clamp a raw number to a 0–100 sub-score, derive the health
 * band, and roll a set of weighted sub-scores up to a single 0–100 total. All arithmetic is integer
 * (`Math.round`); the per-criterion contributions sum EXACTLY to the total (residual assigned to the
 * largest-weight criterion), an invariant pinned by a test — mirroring the goals `policy.ts` guarantee.
 */

import type { CriterionId, HealthBand } from './types.ts';

/** Score at/above which a unit is "healthy". */
export const HEALTHY_THRESHOLD = 85;
/** Score at/above which a unit needs "attention" (below it is "needs-review"). */
export const ATTENTION_THRESHOLD = 60;

/** Clamp any raw number to an integer 0–100 sub-score. */
export function clamp0100(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

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

/** One scored criterion entering the rollup (nulls are filtered out before this). */
export interface WeightedScore {
  readonly id: CriterionId;
  readonly score: number;
  readonly weight: number;
}

/** The rollup outcome: the 0–100 total and each criterion's exact integer contribution to it. */
export interface RollupResult {
  readonly overall: number;
  readonly contributions: ReadonlyMap<CriterionId, number>;
}

/**
 * Weighted rollup to 0–100. `overall = round(Σ score·weight / Σ weight)` over the scored criteria;
 * each `contribution = round(score·weight / Σ weight)`; the rounding residual (`overall − Σ
 * contributions`) is added to the largest-weight criterion so contributions sum EXACTLY to `overall`.
 *
 * Zero-weight edge case: if every scored criterion has weight 0 (or the list would divide by zero),
 * all scored criteria are weighted equally so a configured-but-zeroed weight set still produces a
 * meaningful mean rather than a divide-by-zero.
 */
export function rollUp(scored: readonly WeightedScore[]): RollupResult {
  const contributions = new Map<CriterionId, number>();
  if (scored.length === 0) {
    return { overall: 0, contributions };
  }

  const totalWeight = scored.reduce((sum, s) => sum + Math.max(0, s.weight), 0);
  // Fall back to equal weights when the configured weights collapse to zero.
  const effective = totalWeight > 0 ? scored.map((s) => ({ ...s, w: Math.max(0, s.weight) })) : scored.map((s) => ({ ...s, w: 1 }));
  const effectiveTotal = effective.reduce((sum, s) => sum + s.w, 0);

  const overall = Math.round(effective.reduce((sum, s) => sum + s.score * s.w, 0) / effectiveTotal);

  let contributionSum = 0;
  for (const s of effective) {
    const contribution = Math.round((s.score * s.w) / effectiveTotal);
    contributions.set(s.id, contribution);
    contributionSum += contribution;
  }

  // Assign the rounding residual to the largest-weight (ties → first) criterion so Σ === overall.
  const residual = overall - contributionSum;
  if (residual !== 0) {
    let target = effective[0];
    for (const s of effective) {
      if (s.w > target.w) target = s;
    }
    contributions.set(target.id, (contributions.get(target.id) ?? 0) + residual);
  }

  return { overall, contributions };
}
