import { assert, assertEquals } from '@std/assert';
import {
  calculateCooldownUntil,
  calculateNextRunFromMinutes,
  MAX_SCHEDULE_INTERVAL_MINUTES,
} from '$jobs/scheduleUtils.ts';

const BASE = '2026-01-01T00:00:00.000Z';
const BASE_PLUS_MAX = new Date(Date.parse(BASE) + MAX_SCHEDULE_INTERVAL_MINUTES * 60_000).toISOString();

Deno.test('calculateNextRunFromMinutes adds in-range minutes to the base', () => {
  assertEquals(calculateNextRunFromMinutes(BASE, 60), '2026-01-01T01:00:00.000Z');
  assertEquals(calculateNextRunFromMinutes(BASE, MAX_SCHEDULE_INTERVAL_MINUTES), BASE_PLUS_MAX);
});

Deno.test('calculateNextRunFromMinutes clamps overflowing minutes to the cap instead of throwing', () => {
  assertEquals(calculateNextRunFromMinutes(BASE, 200_000_000_000), BASE_PLUS_MAX);
  assertEquals(calculateNextRunFromMinutes(BASE, Number.MAX_SAFE_INTEGER), BASE_PLUS_MAX);
});

Deno.test('calculateNextRunFromMinutes treats non-finite minutes as the cap', () => {
  assertEquals(calculateNextRunFromMinutes(BASE, Number.NaN), BASE_PLUS_MAX);
  assertEquals(calculateNextRunFromMinutes(BASE, Number.POSITIVE_INFINITY), BASE_PLUS_MAX);
  assertEquals(calculateNextRunFromMinutes(BASE, Number.NEGATIVE_INFINITY), BASE_PLUS_MAX);
});

Deno.test('calculateNextRunFromMinutes clamps negative minutes to zero', () => {
  assertEquals(calculateNextRunFromMinutes(BASE, -30), BASE);
});

Deno.test('calculateCooldownUntil clamps overflowing and non-finite minutes instead of throwing', () => {
  assertEquals(calculateCooldownUntil(BASE, 200_000_000_000), BASE_PLUS_MAX);
  assertEquals(calculateCooldownUntil(BASE, Number.NaN), BASE_PLUS_MAX);
  assertEquals(calculateCooldownUntil(BASE, Number.POSITIVE_INFINITY), BASE_PLUS_MAX);
  assertEquals(calculateCooldownUntil(BASE, -30), BASE);
  assertEquals(calculateCooldownUntil(BASE, 60), '2026-01-01T01:00:00.000Z');
  assertEquals(calculateCooldownUntil(null, 60), null);
});

Deno.test('schedule helpers treat an unparseable lastRunAt like a missing one instead of throwing', () => {
  const before = Date.now();
  const nextRun = calculateNextRunFromMinutes('not-a-timestamp', 60);
  const nextRunMs = Date.parse(nextRun);
  assert(nextRunMs >= before && nextRunMs <= Date.now(), `expected ~now, got ${nextRun}`);

  assertEquals(calculateCooldownUntil('not-a-timestamp', 60), null);
});
