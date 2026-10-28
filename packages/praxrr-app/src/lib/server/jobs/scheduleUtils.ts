import { Cron } from 'croner';
import { parseUTC } from '$shared/utils/dates.ts';
import { logger } from '$logger/logger.ts';

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

export const BACKUP_SCHEDULE_KEYWORDS = ['hourly', 'daily', 'weekly', 'monthly'] as const;

/**
 * Valid backup schedules: the named keywords plus the two cron expressions the Backup settings
 * select offers (every 6h / every 12h at minute 0). Strict allowlist so nothing else reaches
 * calculateNextRunFromSchedule's +1h fallback (ISO dates, never-matching crons, six-field
 * seconds patterns). BackupSettings.svelte offers exactly these values.
 */
export const VALID_BACKUP_SCHEDULES = ['hourly', 'daily', 'weekly', 'monthly', '0 */6 * * *', '0 */12 * * *'] as const;

export function isValidBackupSchedule(schedule: string): boolean {
  return (VALID_BACKUP_SCHEDULES as readonly string[]).includes(schedule);
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
    // Next Sunday 00:00 local time, strictly after now. A fixed calendar point (matching the
    // daily/monthly midnight anchoring) so two computations in the same week agree instead of
    // drifting a full 7 days apart.
    const next = new Date(now);
    const daysUntilSunday = (7 - next.getDay()) % 7;
    next.setDate(next.getDate() + (daysUntilSunday === 0 ? 7 : daysUntilSunday));
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
    cron.stop();
    if (nextRun) return nextRun.toISOString();
  } catch {
    // fall through to the bounded fallback below
  }

  // Unparseable or never-matching schedule: fall back to +1h instead of throwing during
  // startup scheduling, but surface it — this is a persisted settings value the user must fix.
  void logger.warn('Backup schedule is not parseable; falling back to 1 hour', {
    source: 'JobSchedule',
    meta: { schedule },
  });
  const fallback = new Date(now);
  fallback.setHours(fallback.getHours() + 1);
  return fallback.toISOString();
}
