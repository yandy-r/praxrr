import { assert, assertEquals } from '@std/assert';
import {
  calculateCooldownUntil,
  calculateNextRunFromMinutes,
  calculateNextRunFromSchedule,
  isValidBackupSchedule,
  MAX_SCHEDULE_INTERVAL_MINUTES,
  VALID_BACKUP_SCHEDULES,
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

// ============================================================================
// Backup schedules (YAN-453/454): strict allowlist (M1) matching the Backup
// settings select, plus TZ-independent next-run assertions (M2).
// ============================================================================

Deno.test('isValidBackupSchedule accepts only the strict allowlist', () => {
  for (const valid of ['hourly', 'daily', 'weekly', 'monthly', '0 */6 * * *', '0 */12 * * *']) {
    assertEquals(isValidBackupSchedule(valid), true, `${valid} should be valid`);
  }
  // Everything else is rejected, including other croner-parseable expressions:
  // '0 0 * * 0' (weekly cron), '2020-01-01T00:00:00' (ISO date), '0 0 31 2 *'
  // (never matches), '* * * * * *' (six-field seconds pattern).
  for (const invalid of [
    '*/6 hours',
    '*/12 hours',
    'not a cron',
    '',
    '   ',
    '0 0 * * 0',
    '2020-01-01T00:00:00',
    '0 0 31 2 *',
    '* * * * * *',
    '0 0 * * *',
  ]) {
    assertEquals(isValidBackupSchedule(invalid), false, `${invalid} should be invalid`);
  }
});

Deno.test('VALID_BACKUP_SCHEDULES matches the BackupSettings select options', () => {
  assertEquals([...VALID_BACKUP_SCHEDULES], ['hourly', 'daily', 'weekly', 'monthly', '0 */6 * * *', '0 */12 * * *']);
});

Deno.test('6h/12h cron schedules yield 6/12-hour-aligned next runs', () => {
  const next6 = new Date(calculateNextRunFromSchedule('0 */6 * * *'));
  assertEquals(next6.getHours() % 6, 0, 'next run must land on a 6-hour boundary');
  assertEquals(next6.getMinutes(), 0);
  assert(next6.getTime() > Date.now() && next6.getTime() - Date.now() <= 6 * 3_600_000);

  const next12 = new Date(calculateNextRunFromSchedule('0 */12 * * *'));
  assertEquals(next12.getHours() % 12, 0, 'next run must land on a 12-hour boundary');
  assertEquals(next12.getMinutes(), 0);
  assert(next12.getTime() > Date.now() && next12.getTime() - Date.now() <= 12 * 3_600_000);
});

Deno.test('weekly backup schedule anchors on the next Sunday 00:00 local, stable within a week', () => {
  const first = new Date(calculateNextRunFromSchedule('weekly'));

  assertEquals(first.getDay(), 0, 'weekly next run must be a Sunday');
  assertEquals(first.getHours(), 0);
  assertEquals(first.getMinutes(), 0);
  assert(first.getTime() > Date.now(), 'must be strictly in the future');
  // Calendar-field bound (1..7 days ahead) instead of a raw ms offset, so this
  // holds across DST transitions.
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const firstMidnight = new Date(first.getFullYear(), first.getMonth(), first.getDate());
  const daysAhead = Math.round((firstMidnight.getTime() - todayMidnight.getTime()) / 86_400_000);
  assert(daysAhead >= 1 && daysAhead <= 7, `weekly next run must be 1-7 days ahead, got ${daysAhead}`);

  // Same week (the day after the computed Sunday, still before the following one) must land
  // on exactly the next Sunday, not drift by another arbitrary 7-day offset. Compare by
  // calendar fields (getDay/getHours/date), not a millisecond offset, so DST weeks pass.
  const expectedNext = new Date(first);
  expectedNext.setDate(expectedNext.getDate() + 7);
  expectedNext.setHours(0, 0, 0, 0);

  // Fake Date honours explicit constructor arguments; only the no-arg call and
  // Date.now() see the frozen clock (one day after the computed Sunday).
  const RealDate = Date;
  const fakeNow = first.getTime() + 86_400_000;
  class FakeDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        super(fakeNow);
      } else {
        super(...(args as [string]));
      }
    }
    static override now(): number {
      return fakeNow;
    }
  }
  globalThis.Date = FakeDate as unknown as DateConstructor;
  let second: Date;
  try {
    const secondRun = calculateNextRunFromSchedule('weekly');
    globalThis.Date = RealDate;
    second = new RealDate(secondRun);
  } finally {
    globalThis.Date = RealDate;
  }
  assertEquals(second.getDay(), 0, 'mid-week recompute must land on a Sunday');
  assertEquals(second.getHours(), 0, 'mid-week recompute must land on local midnight');
  assertEquals(second.getMinutes(), 0);
  assertEquals(second.getTime(), expectedNext.getTime(), 'mid-week recompute must land on the next Sunday');
});

Deno.test('unparseable schedule keeps the bounded +1h fallback instead of throwing', () => {
  const before = Date.now();
  const fallback = new Date(calculateNextRunFromSchedule('*/6 hours'));
  assert(fallback.getTime() > before && fallback.getTime() <= Date.now() + 3_600_000);
});
