import { Cron } from 'croner';
import { parseUTC } from '$shared/utils/dates.ts';

/**
 * Upper bound (1 year) for every minute-based schedule interval. Route validators and table
 * CHECKs reject larger values; the helpers below also clamp so a legacy/out-of-range persisted
 * value can never overflow Date arithmetic and throw during job scheduling.
 */
export const MAX_SCHEDULE_INTERVAL_MINUTES = 525_600;

/** User-facing rejection message for an out-of-range `syncStrategy` (TRaSH sources and PCDs). */
export const SYNC_STRATEGY_RANGE_ERROR = `syncStrategy must be an integer between 0 and ${MAX_SCHEDULE_INTERVAL_MINUTES}`;

/** True when `value` is an integer minute interval in [min, MAX_SCHEDULE_INTERVAL_MINUTES]. */
export function isValidScheduleIntervalMinutes(value: unknown, min = 0): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= MAX_SCHEDULE_INTERVAL_MINUTES;
}

const MS_PER_MINUTE = 60_000;
// ECMAScript's maximum representable Date (±8.64e15 ms from the epoch).
const MAX_DATE_MS = 8.64e15;

/**
 * Add minutes to `base`, clamped into [0, MAX_SCHEDULE_INTERVAL_MINUTES] (non-finite → the cap) and
 * to the maximum representable Date, so this can never produce an invalid Date and throw.
 */
function addScheduleMinutes(base: Date, scheduleMinutes: number): string {
  const minutes = Number.isFinite(scheduleMinutes)
    ? Math.min(Math.max(scheduleMinutes, 0), MAX_SCHEDULE_INTERVAL_MINUTES)
    : MAX_SCHEDULE_INTERVAL_MINUTES;
  const nextMs = base.getTime() + minutes * MS_PER_MINUTE;
  return new Date(Math.min(nextMs, MAX_DATE_MS)).toISOString();
}

export function calculateNextRunFromMinutes(lastRunAt: string | null, scheduleMinutes: number): string {
  if (!lastRunAt) {
    return new Date().toISOString();
  }
  const base = parseUTC(lastRunAt);
  if (!base || Number.isNaN(base.getTime())) {
    return new Date().toISOString();
  }
  return addScheduleMinutes(base, scheduleMinutes);
}

export function calculateCooldownUntil(lastRunAt: string | null, scheduleMinutes: number): string | null {
  if (!lastRunAt) return null;
  const base = parseUTC(lastRunAt);
  if (!base || Number.isNaN(base.getTime())) return null;
  return addScheduleMinutes(base, scheduleMinutes);
}

export function calculateNextRunFromSchedule(schedule: string): string {
  const now = new Date();

  if (schedule === 'daily') {
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
    return next.toISOString();
  }
  if (schedule === 'hourly') {
    const next = new Date(now);
    next.setHours(next.getHours() + 1, 0, 0, 0);
    return next.toISOString();
  }
  if (schedule === 'weekly') {
    const next = new Date(now);
    next.setDate(next.getDate() + 7);
    next.setHours(0, 0, 0, 0);
    return next.toISOString();
  }
  if (schedule === 'monthly') {
    const next = new Date(now);
    next.setMonth(next.getMonth() + 1, 1);
    next.setHours(0, 0, 0, 0);
    return next.toISOString();
  }

  try {
    const cron = new Cron(schedule);
    const nextRun = cron.nextRun();
    if (nextRun) return nextRun.toISOString();
  } catch {
    // fall through
  }

  const fallback = new Date(now);
  fallback.setHours(fallback.getHours() + 1);
  return fallback.toISOString();
}
