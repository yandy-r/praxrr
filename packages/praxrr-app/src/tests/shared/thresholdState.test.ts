import { assertEquals } from '@std/assert';
import { resolveThresholdState } from '../../lib/shared/pcd/threshold.ts';

Deno.test('resolveThresholdState: below minimum', () => {
  assertEquals(resolveThresholdState(-10, 0, 100), 'below');
  assertEquals(resolveThresholdState(49, 50, 100), 'below');
});

Deno.test('resolveThresholdState: accepted between thresholds', () => {
  assertEquals(resolveThresholdState(50, 50, 100), 'accepted');
  assertEquals(resolveThresholdState(75, 50, 100), 'accepted');
  assertEquals(resolveThresholdState(99, 50, 100), 'accepted');
});

Deno.test('resolveThresholdState: upgrade reached at or above upgradeUntil', () => {
  assertEquals(resolveThresholdState(100, 50, 100), 'upgrade-reached');
  assertEquals(resolveThresholdState(150, 50, 100), 'upgrade-reached');
});

Deno.test('resolveThresholdState: equal-boundary semantics', () => {
  // total === minimum is accepted (inclusive lower bound)
  assertEquals(resolveThresholdState(0, 0, 10), 'accepted');
  // total === upgradeUntil is upgrade-reached (inclusive)
  assertEquals(resolveThresholdState(10, 0, 10), 'upgrade-reached');
});

Deno.test('resolveThresholdState: degenerate upgradeUntil <= minimum', () => {
  // upgrade-reached is checked after below; a total at/above min that also
  // clears a lower upgradeUntil resolves to upgrade-reached
  assertEquals(resolveThresholdState(50, 50, 10), 'upgrade-reached');
  // below minimum still wins
  assertEquals(resolveThresholdState(5, 50, 10), 'below');
});
