/**
 * Generic weighted rollup primitive.
 *
 * The shared, id-parameterized core extracted from the config-health scoring policy (issue #22) so
 * the security-posture engine (issue #28) reuses the SAME battle-tested weighted-mean-with-exact-
 * contributions math rather than copying it. Pure: integer arithmetic only, no I/O, no `Date`,
 * no `Math.random`. The per-item contributions always sum EXACTLY to the rolled-up total (the
 * rounding residual is folded into the largest-weight item), an invariant pinned by unit tests.
 *
 * Consumers keep their own domain policy (band thresholds, catalogs) local; only the rollup and the
 * 0–100 clamp live here. `$shared/health/policy.ts` re-exports these to preserve its public surface.
 */

/** Clamp any raw number to an integer 0–100 sub-score. */
export function clamp0100(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** One scored unit entering the rollup (nulls are filtered out by the caller before this). */
export interface WeightedScore<Id extends string = string> {
  readonly id: Id;
  readonly score: number;
  readonly weight: number;
}

/** The rollup outcome: the 0–100 total and each unit's exact integer contribution to it. */
export interface RollupResult<Id extends string = string> {
  readonly overall: number;
  readonly contributions: ReadonlyMap<Id, number>;
}

/**
 * Weighted rollup to 0–100. `overall = round(Σ score·weight / Σ weight)` over the scored units;
 * each `contribution = round(score·weight / Σ weight)`; the rounding residual (`overall − Σ
 * contributions`) is added to the largest-weight unit so contributions sum EXACTLY to `overall`.
 *
 * Zero-weight edge case: if every scored unit has weight 0 (or the list would divide by zero), all
 * scored units are weighted equally so a configured-but-zeroed weight set still produces a
 * meaningful mean rather than a divide-by-zero.
 */
export function rollUp<Id extends string>(scored: readonly WeightedScore<Id>[]): RollupResult<Id> {
  const contributions = new Map<Id, number>();
  if (scored.length === 0) {
    return { overall: 0, contributions };
  }

  const totalWeight = scored.reduce((sum, s) => sum + Math.max(0, s.weight), 0);
  // Fall back to equal weights when the configured weights collapse to zero.
  const effective =
    totalWeight > 0 ? scored.map((s) => ({ ...s, w: Math.max(0, s.weight) })) : scored.map((s) => ({ ...s, w: 1 }));
  const effectiveTotal = effective.reduce((sum, s) => sum + s.w, 0);

  const overall = Math.round(effective.reduce((sum, s) => sum + s.score * s.w, 0) / effectiveTotal);

  let contributionSum = 0;
  for (const s of effective) {
    const contribution = Math.round((s.score * s.w) / effectiveTotal);
    contributions.set(s.id, contribution);
    contributionSum += contribution;
  }

  // Assign the rounding residual to the largest-weight (ties → first) unit so Σ === overall.
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
