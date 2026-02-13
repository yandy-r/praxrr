import { Cron } from 'croner';
import { parseUTC } from '$shared/utils/dates.ts';

export function calculateNextRunFromMinutes(lastRunAt: string | null, scheduleMinutes: number): string {
  if (!lastRunAt) {
    return new Date().toISOString();
  }
  const base = parseUTC(lastRunAt);
  if (!base) {
    return new Date().toISOString();
  }
  const next = new Date(base);
  next.setMinutes(next.getMinutes() + scheduleMinutes);
  return next.toISOString();
}

export function calculateCooldownUntil(lastRunAt: string | null, scheduleMinutes: number): string | null {
  if (!lastRunAt) return null;
  const base = parseUTC(lastRunAt);
  if (!base) return null;
  const next = new Date(base);
  next.setMinutes(next.getMinutes() + scheduleMinutes);
  return next.toISOString();
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
