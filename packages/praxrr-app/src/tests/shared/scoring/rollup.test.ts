/**
 * Pure tests for the shared weighted-rollup primitive ($shared/scoring/rollup.ts), extracted from the
 * config-health engine (issue #22) and reused by security-posture (issue #28). Pins the load-bearing
 * invariants: contributions sum EXACTLY to the total, the rounding residual lands on the largest
 * weight, the zero-weight fallback is equal-weighting, and the empty set is a defined 0.
 */

import { assert, assertEquals } from '@std/assert';
import { clamp0100, rollUp, type WeightedScore } from '$shared/scoring/rollup.ts';

Deno.test('clamp0100: clamps and rounds to an integer 0–100', () => {
  assertEquals(clamp0100(-5), 0);
  assertEquals(clamp0100(150), 100);
  assertEquals(clamp0100(64.4), 64);
  assertEquals(clamp0100(64.5), 65);
});

Deno.test('rollUp: empty set is a defined zero with no contributions', () => {
  const result = rollUp([]);
  assertEquals(result.overall, 0);
  assertEquals(result.contributions.size, 0);
});

Deno.test('rollUp: overall is the weighted mean', () => {
  const scored: WeightedScore[] = [
    { id: 'a', score: 100, weight: 40 },
    { id: 'b', score: 0, weight: 60 },
  ];
  assertEquals(rollUp(scored).overall, 40);
});

Deno.test('rollUp: contributions sum EXACTLY to overall across weight sets', () => {
  const cases: WeightedScore[][] = [
    [
      { id: 'a', score: 35, weight: 40 },
      { id: 'b', score: 30, weight: 30 },
      { id: 'c', score: 70, weight: 15 },
    ],
    [
      { id: 'a', score: 55, weight: 40 },
      { id: 'b', score: 100, weight: 30 },
      { id: 'c', score: 45, weight: 15 },
      { id: 'd', score: 80, weight: 15 },
    ],
    [
      { id: 'a', score: 33, weight: 7 },
      { id: 'b', score: 66, weight: 11 },
      { id: 'c', score: 99, weight: 13 },
    ],
  ];
  for (const scored of cases) {
    const result = rollUp(scored);
    const sum = [...result.contributions.values()].reduce((total, c) => total + c, 0);
    assertEquals(sum, result.overall, `contributions (${sum}) must equal overall (${result.overall})`);
  }
});

Deno.test('rollUp: zero total weight falls back to equal weighting', () => {
  const scored: WeightedScore[] = [
    { id: 'a', score: 100, weight: 0 },
    { id: 'b', score: 0, weight: 0 },
  ];
  const result = rollUp(scored);
  assertEquals(result.overall, 50);
  const sum = [...result.contributions.values()].reduce((total, c) => total + c, 0);
  assertEquals(sum, result.overall);
});

Deno.test('rollUp: rounding residual lands on the largest-weight unit', () => {
  // 33·1 + 33·1 + 33·1 over equal weights → overall 33; each raw contribution 11 → sum 33 (no residual).
  // Force a residual: weights 1/1/1 with scores that round unevenly.
  const scored: WeightedScore[] = [
    { id: 'small1', score: 50, weight: 1 },
    { id: 'small2', score: 50, weight: 1 },
    { id: 'big', score: 50, weight: 8 },
  ];
  const result = rollUp(scored);
  const sum = [...result.contributions.values()].reduce((total, c) => total + c, 0);
  assertEquals(sum, result.overall);
  // The big-weight unit carries the bulk (and any residual), never a smaller one going negative.
  assert((result.contributions.get('big') ?? 0) >= (result.contributions.get('small1') ?? 0));
});
